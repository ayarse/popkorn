import { test, expect } from 'bun:test';
import { parse } from '@popcorn/parser';
import { buildSceneGraph } from './builder';
import { getShapeBounds } from './transform';
import { getPropHandler } from '../animation/registry';
import { AnimationScheduler } from '../animation/scheduler';
import { resetNodeToBase } from './types';
import type { TextData, CircleData } from './types';
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
