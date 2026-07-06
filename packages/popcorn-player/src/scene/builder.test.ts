import { test, expect } from 'bun:test';
import { parse } from '@popcorn/parser';
import { buildSceneGraph } from './builder';
import { getShapeBounds } from './transform';
import { getPropHandler } from '../animation/registry';
import { AnimationScheduler } from '../animation/scheduler';
import { resetNodeToBase } from './types';
import type { TextData, CircleData, PolystarData } from './types';
import { hitTest } from '../runtime/hit-test';

const build = (src: string) => buildSceneGraph(parse(src));

// --- text --------------------------------------------------------------------

test('text: props mapped with defaults', () => {
  const t = build('#t { type: text; content: "Hi"; x: 20px; y: 30px; font-size: 24px; text-anchor: middle; }').children[0];
  expect(t.type).toBe('text');
  const sd = t.shapeData as TextData;
  expect(sd).toEqual({ type: 'text', x: 20, y: 30, content: 'Hi', fontSize: 24, fontFamily: 'sans-serif', fontWeight: 'normal', anchor: 'middle' });
});

test('text: font-family / numeric font-weight', () => {
  const t = build('#t { type: text; content: "x"; font-family: "Georgia"; font-weight: 700; }').children[0];
  const sd = t.shapeData as TextData;
  expect(sd.fontFamily).toBe('Georgia');
  expect(sd.fontWeight).toBe('700');
});

test('text: headless bounds estimate is sane (0.6 * fontSize * len)', () => {
  const t = build('#t { type: text; content: "AB"; x: 100px; y: 100px; font-size: 20px; }').children[0];
  const b = getShapeBounds(t);
  // no DOM under bun -> estimate path
  expect(b.width).toBeCloseTo(0.6 * 20 * 2, 5);
  expect(b.height).toBe(20);
  expect(b).toMatchObject({ x: 100, y: 80 }); // anchor start, baseline alphabetic
});

test('text: font-size animates via registry and invalidates measured bounds', () => {
  const t = build('#t { type: text; content: "AB"; font-size: 20px; }').children[0];
  getShapeBounds(t);                       // populate cache, clears dirty flag
  expect(t.textBoundsDirty).toBe(false);

  getPropHandler('font-size')!.apply(t, 40);
  expect((t.shapeData as TextData).fontSize).toBe(40);
  expect(t.textBoundsDirty).toBe(true);
  expect(getShapeBounds(t).width).toBeCloseTo(0.6 * 40 * 2, 5); // remeasured
});

test('text: hit-test against estimated bounds', () => {
  const root = build('#t { type: text; content: "AB"; x: 100px; y: 100px; font-size: 20px; }');
  root.children[0].interactive = true;
  expect(hitTest(root, { x: 110, y: 90 })).toBe(root.children[0]); // inside
  expect(hitTest(root, { x: 300, y: 300 })).toBeNull();            // outside
});

// --- symbols (@define / use) -------------------------------------------------

const SYMBOL_SRC = `
@keyframes grow { from { r: 5px; } to { r: 50px; } }
@define spark {
  type: circle; r: 5px; fill: #fbbf24; animation: grow 1s linear;
  > #tail { type: rect; width: 4px; }
}
#s1 { use: spark; cx: 10px; }
#s2 { use: spark; cx: 100px; fill: #000000; }
`;

test('use: instantiates a symbol; use-site declarations override', () => {
  const root = build(SYMBOL_SRC);
  const [s1, s2] = root.children;
  expect(s1.type).toBe('circle');
  expect((s1.shapeData as CircleData).cx).toBe(10);
  expect((s2.shapeData as CircleData).cx).toBe(100);
  expect(s1.fill).toBe('#fbbf24');   // from definition
  expect(s2.fill).toBe('#000000');   // use-site override wins
});

test('use: definition children are cloned with namespaced ids', () => {
  const [s1, s2] = build(SYMBOL_SRC).children;
  expect(s1.children[0].id).toBe('s1.tail');
  expect(s2.children[0].id).toBe('s2.tail');
  expect(s1.children[0]).not.toBe(s2.children[0]); // distinct nodes
});

test('use: each instance animates independently', () => {
  const [s1, s2] = build(SYMBOL_SRC).children;
  expect(s1.animations).toHaveLength(1);
  expect(s2.animations).toHaveLength(1);

  const sched = new AnimationScheduler();
  resetNodeToBase(s1);
  sched.sampleNode(s1, 500); // halfway through grow: r -> ~27.5
  expect((s1.shapeData as CircleData).r).toBeGreaterThan(20);

  resetNodeToBase(s2); // s2 never sampled -> stays at its base r
  expect((s2.shapeData as CircleData).r).toBe(5);
});

test('use: unknown symbol name throws', () => {
  expect(() => build('#x { use: nope; }')).toThrow(/unknown symbol 'nope'/);
});

test('use: cyclic definitions throw', () => {
  const src = '@define a { use: b; } @define b { use: a; } #x { use: a; }';
  expect(() => build(src)).toThrow(/cyclic symbol definition/);
});

// --- animation shorthand: time-value ordering (no 1000ms sentinel) -----------

test('animation shorthand: 1s duration + nonzero delay parses exactly', () => {
  const src = `
@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }
#a { type: rect; width: 10px; animation: spin 1s linear 1 2s; }
`;
  const [node] = build(src).children;
  expect(node.animations).toHaveLength(1);
  // 1000ms is a legit author-reachable duration, not an "unset" sentinel; the
  // second time value must land in delay, not clobber duration.
  expect(node.animations[0].duration).toBe(1000);
  expect(node.animations[0].delay).toBe(2000);
});

// --- polystar (star / polygon) ----------------------------------------------

test('star: declarations populate PolystarData', () => {
  const src = `#s {
    type: star; points: 6; outer-radius: 80px; inner-radius: 40px;
    rotation: 15deg; cx: 100px; cy: 100px; outer-roundness: 25%; fill: #f00;
  }`;
  const [node] = build(src).children;
  expect(node.type).toBe('star');
  const sd = node.shapeData as PolystarData;
  expect(sd).toMatchObject({
    type: 'star', points: 6, outerRadius: 80, innerRadius: 40,
    rotation: 15, cx: 100, cy: 100, outerRoundness: 25,
  });
});

test('polygon: inner-radius is ignored (polygon has none)', () => {
  const [node] = build('#p { type: polygon; points: 5; outer-radius: 50px; inner-radius: 99px; }').children;
  expect((node.shapeData as PolystarData).innerRadius).toBe(0);
});

test('star: animating outer-radius rebuilds via the registry (dirty flag)', () => {
  const src = `
@keyframes pulse { from { outer-radius: 10px; } to { outer-radius: 110px; } }
#s { type: star; points: 5; outer-radius: 10px; inner-radius: 5px; animation: pulse 1s linear; }
`;
  const [node] = build(src).children;
  const sched = new AnimationScheduler();
  resetNodeToBase(node);
  sched.sampleNode(node, 500); // halfway: outer-radius -> ~60
  expect((node.shapeData as PolystarData).outerRadius).toBeCloseTo(60, 0);
  expect(node.polystarDirty).toBe(true); // registry apply flagged a rebuild
});

// --- stroke dashes -----------------------------------------------------------

test('stroke-dasharray + dashoffset parse; dashoffset animates', () => {
  const src = `
@keyframes march { from { stroke-dashoffset: 0px; } to { stroke-dashoffset: 20px; } }
#d { type: rect; width: 50px; height: 50px; stroke: #000; stroke-width: 2px;
     stroke-dasharray: 5px 3px 2px; stroke-dashoffset: 4px; animation: march 1s linear; }
`;
  const [node] = build(src).children;
  expect(node.strokeDashArray).toEqual([5, 3, 2]);
  expect(node.strokeDashOffset).toBe(4);

  const sched = new AnimationScheduler();
  resetNodeToBase(node);
  sched.sampleNode(node, 500); // halfway: dashoffset 0 -> 20 => 10
  expect(node.strokeDashOffset).toBeCloseTo(10, 5);
});

// --- fill-rule ---------------------------------------------------------------

test('fill-rule: parses evenodd; defaults to nonzero', () => {
  const [a] = build('#a { type: path; d: "M0 0 L10 0 L0 10 Z"; fill-rule: evenodd; }').children;
  expect(a.fillRule).toBe('evenodd');
  const [b] = build('#b { type: path; d: "M0 0 L10 0 L0 10 Z"; }').children;
  expect(b.fillRule).toBe('nonzero');
});
