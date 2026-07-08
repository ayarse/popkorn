import { test, expect } from 'bun:test';
import { parse } from '@popcorn/parser';
import { buildSceneGraph } from './builder';
import { getShapeBounds } from './transform';
import { getPropHandler } from '../animation/registry';
import { AnimationScheduler } from '../animation/scheduler';
import { resetNodeToBase } from './types';
import type { TextData, CircleData, PolystarData, ImageData } from './types';
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

// --- steps() / step-start easing --------------------------------------------

test('steps() parses in shorthand, longhand, and per-keyframe', () => {
  const src = `
@keyframes k {
  from { opacity: 0; animation-timing-function: steps(3, jump-start); }
  to { opacity: 1; }
}
#a { type: rect; width: 10px; animation: k 1s steps(4, jump-none); }
#b { type: rect; width: 10px; animation-name: k; animation-timing-function: step-start; }
`;
  const [a, b] = build(src).children;
  expect(a.animations[0].timingFunction).toEqual({ type: 'steps', count: 4, position: 'jump-none' });
  expect(a.animations[0].keyframes[0].easing).toEqual({ type: 'steps', count: 3, position: 'jump-start' });
  expect(b.animations[0].timingFunction).toBe('step-start');
});

test('linear() parses and distributes missing inputs per CSS L2', () => {
  const src = `
@keyframes k { from { opacity: 0; } to { opacity: 1; } }
#a { type: rect; width: 10px; animation: k 1s linear(0, 0.25, 1); }
#b { type: rect; width: 10px; animation: k 1s linear(0, 0.5 25% 75%, 1); }
`;
  const [a, b] = build(src).children;
  const ea = a.animations[0].timingFunction;
  expect(ea).toEqual({
    type: 'linear',
    points: [
      { input: 0, output: 0 },
      { input: 0.5, output: 0.25 }, // missing input distributed to the midpoint
      { input: 1, output: 1 },
    ],
  });
  // Two-percentage stop expands to two points sharing the output (flat segment).
  const eb = b.animations[0].timingFunction;
  expect(eb).toEqual({
    type: 'linear',
    points: [
      { input: 0, output: 0 },
      { input: 0.25, output: 0.5 },
      { input: 0.75, output: 0.5 },
      { input: 1, output: 1 },
    ],
  });
});

// --- polystar (star / polygon) ----------------------------------------------

test('star: declarations populate PolystarData', () => {
  const src = `#s {
    type: star; sides: 6; outer-radius: 80px; inner-radius: 40px;
    rotation: 15deg; cx: 100px; cy: 100px; outer-roundness: 25%; fill: #f00;
  }`;
  const [node] = build(src).children;
  expect(node.type).toBe('star');
  const sd = node.shapeData as PolystarData;
  expect(sd).toMatchObject({
    type: 'star', sides: 6, outerRadius: 80, innerRadius: 40,
    rotation: 15, cx: 100, cy: 100, outerRoundness: 25,
  });
});

test('polygon: inner-radius is ignored (polygon has none)', () => {
  const [node] = build('#p { type: polygon; sides: 5; outer-radius: 50px; inner-radius: 99px; }').children;
  expect((node.shapeData as PolystarData).innerRadius).toBe(0);
});

test('star: animating outer-radius rebuilds via the registry (dirty flag)', () => {
  const src = `
@keyframes pulse { from { outer-radius: 10px; } to { outer-radius: 110px; } }
#s { type: star; sides: 5; outer-radius: 10px; inner-radius: 5px; animation: pulse 1s linear; }
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

// --- paint-order -------------------------------------------------------------

test('paint-order: parses stroke; defaults to normal', () => {
  const [a] = build('#a { type: path; d: "M0 0 L10 0 Z"; paint-order: stroke; }').children;
  expect(a.paintOrder).toBe('stroke');
  const [b] = build('#b { type: path; d: "M0 0 L10 0 Z"; }').children;
  expect(b.paintOrder).toBe('normal');
});

// --- multi-path clip (Lottie mask add-mode) ----------------------------------

test('clip-path: multiple path() values union into one command list', () => {
  const [g] = build(
    "#g { type: group; clip-path: path('M0 0 L10 0 L10 10 Z') path('M20 20 L30 20 L30 30 Z'); }"
  ).children;
  expect(g.clipPath?.type).toBe('path');
  if (g.clipPath?.type === 'path') {
    // Two triangles -> two M commands in the concatenated list.
    expect(g.clipPath.commands.filter((c) => c.type === 'M')).toHaveLength(2);
  }
});

test('clip-path: @keyframes morph the clip commands via the registry', () => {
  const [g] = build(`
    @keyframes reveal {
      from { clip-path: path('M0 0 L10 0 L10 10 L0 10 Z'); }
      to   { clip-path: path('M0 0 L20 0 L20 10 L0 10 Z'); }
    }
    #g { type: group; clip-path: path('M0 0 L10 0 L10 10 L0 10 Z');
         animation: reveal 1s linear; }
  `).children;

  // Base = first keyframe (unclipped author state).
  expect(g.clipPath?.type).toBe('path');
  const handler = getPropHandler('clip-path');
  expect(handler?.kind).toBe('path');

  const sched = new AnimationScheduler();
  resetNodeToBase(g);
  sched.sampleNode(g, 500); // midway through the 1s animation
  // The second point's x lerps 10 -> 20, so at t=0.5 it sits at 15.
  if (g.clipPath?.type === 'path') {
    const line = g.clipPath.commands.find((c) => c.type === 'L') as { x: number };
    expect(line.x).toBeCloseTo(15, 5);
  }

  // A fresh reset restores the authored base (10), proving the morph never
  // corrupts the base snapshot.
  resetNodeToBase(g);
  if (g.clipPath?.type === 'path') {
    const line = g.clipPath.commands.find((c) => c.type === 'L') as { x: number };
    expect(line.x).toBeCloseTo(10, 5);
  }
});

// --- track masks ------------------------------------------------------------

const MASK_SRC = `
#content { type: rect; x: 0px; y: 0px; width: 50px; height: 50px; fill: #f00; mask: #mask alpha; }
#mask { type: circle; cx: 25px; cy: 25px; r: 25px; fill: #fff; }
`;

test('mask: resolves the source by id, flags it, and links the mode', () => {
  const root = build(MASK_SRC);
  const [content, mask] = root.children;
  expect(content.mask?.source).toBe(mask);
  expect(content.mask?.mode).toBe('alpha');
  // The source is painted only as a mask, never on its own.
  expect(mask.isMaskSource).toBe(true);
  expect(content.isMaskSource).toBe(false);
});

test('mask: an unknown source id throws', () => {
  expect(() => build('#c { type: rect; width: 10px; mask: #nope alpha; }'))
    .toThrow(/mask on 'c' references unknown node '#nope'/);
});

test('mask: mode variants parse (luminance-invert)', () => {
  const root = build(`
    #c { type: rect; width: 10px; mask: #m luminance-invert; }
    #m { type: rect; width: 10px; }
  `);
  expect(root.children[0].mask?.mode).toBe('luminance-invert');
});

// --- image nodes -------------------------------------------------------------

test('image: props map with a default-0 box until natural size is known', () => {
  const [n] = build("#i { type: image; content: url('x.png'); }").children;
  expect(n.type).toBe('image');
  expect(n.shapeData as ImageData).toEqual({ type: 'image', x: 0, y: 0, width: 0, height: 0, src: 'x.png' });
});

test('image: x/y/width/height populate the box', () => {
  const [n] = build("#i { type: image; content: url('a.png'); x: 10px; y: 20px; width: 40px; height: 30px; }").children;
  expect(n.shapeData as ImageData).toEqual({ type: 'image', x: 10, y: 20, width: 40, height: 30, src: 'a.png' });
});
