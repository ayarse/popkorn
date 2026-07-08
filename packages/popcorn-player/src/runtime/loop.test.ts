import { test, expect } from 'bun:test';
import type { Renderer } from '../renderer/interface';
import type { Color, PathCommand, GradientData, ResolvedClip, TrimDescriptor, Matrix3x3 } from '../renderer/types';
import { IDENTITY_MATRIX } from '../renderer/types';
import type { StrokeLineCap, TextAnchor, FillRule, MaskMode } from '../scene/types';
import { createSceneNode, snapshotNode } from '../scene/types';
import { RenderLoop } from './loop';

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
