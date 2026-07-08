import { test, expect } from 'bun:test';
import type { Renderer } from '../renderer/interface';
import type { Color, PathCommand, GradientData, ResolvedClip, TrimDescriptor, Matrix3x3 } from '../renderer/types';
import { IDENTITY_MATRIX } from '../renderer/types';
import type { StrokeLineCap, TextAnchor, FillRule, MaskMode } from '../scene/types';
import { createSceneNode, snapshotNode } from '../scene/types';
import type { AnimationInstance, SceneNode } from '../scene/types';
import { RenderLoop } from './loop';

// A dot whose opacity ramps 0 -> 1 over one 3s iteration, forever. sceneDuration
// is that single iteration (3000). The recording renderer captures the sampled
// opacity as the first (only) setOpacity call per frame.
function fadingDot(): SceneNode {
  const node = createSceneNode('dot', 'circle');
  node.shapeData = { type: 'circle', cx: 0, cy: 0, r: 10 };
  node.opacity = 0;
  node.base = snapshotNode(node);
  const fade: AnimationInstance = {
    name: 'fade',
    duration: 3000,
    timingFunction: 'linear',
    iterationCount: Infinity,
    direction: 'normal',
    delay: 0,
    fillMode: 'forwards',
    keyframes: [
      { offset: 0, properties: { opacity: 0 } },
      { offset: 1, properties: { opacity: 1 } },
    ],
  };
  node.animations = [fade];
  return node;
}

// Minimal no-op renderer that records setOpacity calls (in draw order) and
// counts frames (beginFrame calls) so tests can assert that a repaint happened.
function createRecordingRenderer(): Renderer & { opacities: number[]; frames: number } {
  return {
    opacities: [],
    frames: 0,
    clear() {},
    beginFrame() { this.frames++; },
    endFrame() {},
    drawRect() {},
    drawCircle() {},
    drawEllipse() {},
    drawPath(_c: PathCommand[]) {},
    drawText() {},
    drawImage() {},
    clip(_c: ResolvedClip) {},
    compositeMask(_m: MaskMode, drawContent: () => void, drawMask: () => void) {
      drawContent();
      drawMask();
    },
    setFill(_c: Color | null) {},
    setFillGradient(_g: GradientData | null) {},
    setStroke(_c: Color | null, _w: number) {},
    setStrokeGradient(_g: GradientData | null) {},
    setStrokeLineCap(_c: StrokeLineCap) {},
    setStrokeLineJoin() {},
    setStrokeMiterLimit() {},
    setTrim(_t: TrimDescriptor | null) {},
    setDash() {},
    setFillRule(_r: FillRule) {},
    setPaintOrder() {},
    setOpacity(opacity: number) {
      this.opacities.push(opacity);
    },
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    setTransform(_m: Matrix3x3) {},
    getWidth() { return 100; },
    getHeight() { return 100; },
  };
}

test('render walk: group opacity cascades multiplicatively to children', () => {
  const parent = createSceneNode('parent', 'group');
  parent.opacity = 0.5;
  parent.base = snapshotNode(parent);

  const child = createSceneNode('child', 'circle');
  child.shapeData = { type: 'circle', cx: 0, cy: 0, r: 10 };
  child.opacity = 0.6;
  child.base = snapshotNode(child);
  child.parent = parent;
  parent.children.push(child);

  const renderer = createRecordingRenderer();
  const loop = new RenderLoop(renderer);
  loop.setScene(parent);
  loop.seek(0); // resolves + draws one frame while stopped

  // Parent draws at its own opacity (0.5); child's effective opacity is the
  // product of the inherited parent alpha and its own opacity (0.5 * 0.6).
  expect(renderer.opacities[0]).toBeCloseTo(0.5, 6);
  expect(renderer.opacities[1]).toBeCloseTo(0.3, 6);
});

// Regression: seek(t) must repaint synchronously even while paused-and-running.
// A paused loop keeps its rAF alive for interaction, but a backgrounded tab
// throttles rAF to nothing, so seek can't defer the repaint to the next frame —
// the displayed frame would stay stale (invariant 4: seek is a pure function of
// time, and that includes what's on the canvas).
test('seek repaints synchronously while paused (does not wait for the next rAF)', () => {
  // Stub rAF so start() can flip the loop to "running" without ever delivering a
  // real frame afterwards — modelling a throttled/backgrounded tab.
  const g = globalThis as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number };
  const prevRaf = g.requestAnimationFrame;
  g.requestAnimationFrame = () => 0; // schedule, but never call back

  try {
    const node = createSceneNode('dot', 'circle');
    node.shapeData = { type: 'circle', cx: 0, cy: 0, r: 10 };
    node.base = snapshotNode(node);

    const renderer = createRecordingRenderer();
    const loop = new RenderLoop(renderer);
    loop.setScene(node);
    loop.start();   // one synchronous frame, then a rAF that never fires
    loop.pause();   // frozen, but still "running"
    expect(loop.paused).toBe(true);
    expect(loop.running).toBe(true);

    const before = renderer.frames;
    loop.seek(500);
    // Exactly one repaint happened right now, without any rAF tick.
    expect(renderer.frames).toBe(before + 1);
    expect(loop.currentTime).toBe(500);
  } finally {
    g.requestAnimationFrame = prevRaf;
  }
});

// Loop OFF: past the scene duration the timeline holds at the end of one full
// pass ("play once and stop") — an infinite animation must NOT keep cycling.
// (Paused first, mirroring the demo's scrub flow, so currentTime is exact rather
// than free-running by wall clock.)
test('loop off: time past duration clamps to sceneDuration', () => {
  const renderer = createRecordingRenderer();
  const loop = new RenderLoop(renderer);
  loop.setScene(fadingDot()); // sceneDuration = 3000, loop defaults off
  loop.pause();

  loop.seek(3000);
  const opacityAtEnd = renderer.opacities.at(-1)!;
  expect(loop.currentTime).toBe(3000);

  // Seek well past the end: currentTime and the sampled frame both hold at 3000
  // (not a later point on the still-cycling infinite ramp).
  loop.seek(9000);
  expect(loop.currentTime).toBe(3000);
  expect(renderer.opacities.at(-1)!).toBe(opacityAtEnd);

  // Idempotent (invariant 4): seeking further past the end gives the same frame.
  loop.seek(12000);
  expect(loop.currentTime).toBe(3000);
  expect(renderer.opacities.at(-1)!).toBe(opacityAtEnd);
});

// Loop ON: past the duration the timeline wraps back into [0, duration) so the
// animation keeps cycling. (Not paused — the wrap only runs on a live timeline.)
test('loop on: time past duration wraps', () => {
  const renderer = createRecordingRenderer();
  const loop = new RenderLoop(renderer);
  loop.setScene(fadingDot());
  loop.setLoop(true);

  loop.seek(4000); // 4000 % 3000 = 1000 -> one third through the ramp
  expect(loop.currentTime).toBeCloseTo(1000, 0);
  expect(renderer.opacities.at(-1)!).toBeCloseTo(1000 / 3000, 3);

  // Turning loop back off then seeking past the end freezes at the duration.
  loop.setLoop(false);
  loop.pause();
  loop.seek(8000);
  expect(loop.currentTime).toBe(3000);
});
