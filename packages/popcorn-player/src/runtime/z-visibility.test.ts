import { test, expect } from 'bun:test';
import type { Renderer } from '../renderer/interface';
import type { Color, PathCommand, GradientData, ResolvedClip, TrimDescriptor, Matrix3x3 } from '../renderer/types';
import type { StrokeLineCap, TextAnchor, FillRule, MatteMode, SceneNode } from '../scene/types';
import { createSceneNode, snapshotNode } from '../scene/types';
import { RenderLoop } from './loop';
import { hitTest } from './hit-test';

// Recording renderer: captures the fill colour active at each shape draw, so a
// test can read back the exact paint order of leaf nodes.
function recordingRenderer(): Renderer & { drawn: string[] } {
  let fill: Color | null = null;
  const push = () => { if (fill) (r.drawn as string[]).push(String(fill)); };
  const r: Renderer & { drawn: string[] } = {
    drawn: [],
    clear() {}, beginFrame() {}, endFrame() {},
    drawRect() { push(); }, drawCircle() { push(); }, drawEllipse() { push(); },
    drawPath(_c: PathCommand[]) { push(); },
    drawText() {}, drawImage() {},
    clip(_c: ResolvedClip) {},
    compositeMatte(_m: MatteMode, c: () => void, m: () => void) { c(); m(); },
    setFill(c: Color | null) { fill = c; },
    setFillGradient(_g: GradientData | null) {},
    setStroke(_c: Color | null, _w: number) {},
    setStrokeGradient(_g: GradientData | null) {},
    setStrokeLineCap(_c: StrokeLineCap) {},
    setTrim(_t: TrimDescriptor | null) {},
    setDash() {},
    setFillRule(_r: FillRule) {},
    setPaintOrder() {},
    setOpacity() {},
    save() {}, restore() {},
    translate() {}, rotate() {}, scale() {}, transform() {}, setTransform(_m: Matrix3x3) {},
    getWidth() { return 100; }, getHeight() { return 100; },
  };
  return r;
}

function leaf(id: string, fill: string, z: number, x = 0): SceneNode {
  const n = createSceneNode(id, 'rect');
  n.shapeData = { type: 'rect', x, y: 0, width: 100, height: 100 };
  n.fill = fill;
  n.zIndex = z;
  n.interactive = true;
  n.base = snapshotNode(n);
  return n;
}

test('z-index: siblings paint in ascending z, document order breaks ties', () => {
  const parent = createSceneNode('p', 'group');
  parent.base = snapshotNode(parent);
  // Document order a,b,c,d; z-indexes shuffle them.
  const a = leaf('a', '#a1', 0);
  const b = leaf('b', '#b2', -1);
  const c = leaf('c', '#c3', 0); // ties with a at z=0 -> keep doc order after a
  const d = leaf('d', '#d4', 2);
  for (const n of [a, b, c, d]) { n.parent = parent; parent.children.push(n); }

  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(parent);
  loop.seek(0);

  // ascending z: b(-1), then z=0 ties a,c in doc order, then d(2).
  expect(r.drawn).toEqual(['#b2', '#a1', '#c3', '#d4']);
});

test('z-index: hit-testing picks the highest-z sibling at a shared point', () => {
  const parent = createSceneNode('p', 'group');
  parent.base = snapshotNode(parent);
  const back = leaf('back', '#back', 5);   // higher z = on top
  const front = leaf('front', '#front', -3);
  back.parent = parent; front.parent = parent;
  parent.children.push(back, front); // doc order would put front on top without z

  // Both cover the point; z-index must decide (back has higher z -> topmost).
  const hit = hitTest(parent, { x: 50, y: 50 });
  expect(hit?.id).toBe('back');
});

test('visibility: node outside [from,until) is skipped by render and hit-test', () => {
  const parent = createSceneNode('p', 'group');
  parent.base = snapshotNode(parent);
  const n = leaf('win', '#win', 0);
  n.visibleFrom = 1000; // ms
  n.visibleUntil = 2000;
  n.parent = parent; parent.children.push(n);

  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(parent);

  loop.seek(500);  // before window
  expect(r.drawn).toEqual([]);
  expect(hitTest(parent, { x: 50, y: 50 })).toBeNull();

  loop.seek(1500); // inside window
  expect(r.drawn).toEqual(['#win']);
  expect(hitTest(parent, { x: 50, y: 50 })?.id).toBe('win');

  loop.seek(2000); // at `until` is exclusive -> hidden again
  expect(hitTest(parent, { x: 50, y: 50 })).toBeNull();
});

test('visibility interacts with looping: a wrapped time re-reveals the node', () => {
  const parent = createSceneNode('p', 'group');
  parent.base = snapshotNode(parent);
  const n = leaf('win', '#win', 0);
  n.visibleFrom = 0;
  n.visibleUntil = 1000; // visible only in the first second of the loop
  // Give the scene a finite duration via an animation on the node so the loop
  // has something to wrap against.
  n.animations = [{
    keyframes: [
      { offset: 0, properties: { opacity: 1 } },
      { offset: 1, properties: { opacity: 1 } },
    ],
    delay: 0, duration: 3000, iterationCount: 1,
    direction: 'normal', fillMode: 'both', timingFunction: 'linear',
  } as any];
  n.parent = parent; parent.children.push(n);

  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setLoop(true);
  loop.setScene(parent);

  // t = 3500ms wraps to 500ms (< 1000) => visible again after the loop point.
  loop.seek(3500);
  expect(r.drawn).toEqual(['#win']);
});

test('visibility is evaluated in the node’s incoming (pre-time-offset) scope', () => {
  // A layer's visibility lives in its parent comp's timeline, so time-offset on
  // the SAME node must not shift its own window.
  const parent = createSceneNode('p', 'group');
  parent.base = snapshotNode(parent);
  const n = leaf('win', '#win', 0);
  n.visibleFrom = 500;
  n.visibleUntil = 1500;
  n.timeOffset = 500; // scopes its CONTENT only, not its own visibility
  n.parent = parent; parent.children.push(n);

  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(parent);

  loop.seek(1000); // within [500,1500) regardless of timeOffset
  expect(r.drawn).toEqual(['#win']);
});
