import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import { getPropHandler } from "../animation/registry";
import { AnimationScheduler } from "../animation/scheduler";
import { hitTest } from "../runtime/hit-test";
import {
  applyStateStyles,
  createInteractionManager,
} from "../runtime/interaction";
import { createVariableResolver } from "../runtime/variables";
import { buildSceneGraph, extractTransform } from "./builder";
import { getShapeBounds } from "./transform";
import type {
  CircleData,
  EllipseData,
  ImageData,
  PathData,
  PolystarData,
  RectData,
  TextData,
} from "./types";
import { resetNodeToBase } from "./types";

const build = (src: string) => buildSceneGraph(parse(src));

// --- text --------------------------------------------------------------------

test("text: props mapped with defaults", () => {
  const t = build(
    '#t { type: text; content: "Hi"; x: 20px; y: 30px; font-size: 24px; text-anchor: middle; }',
  ).children[0];
  expect(t.type).toBe("text");
  const sd = t.shapeData as TextData;
  expect(sd).toEqual({
    type: "text",
    x: 20,
    y: 30,
    content: "Hi",
    fontSize: 24,
    fontFamily: "sans-serif",
    fontWeight: "normal",
    anchor: "middle",
    letterSpacing: 0,
    lineHeight: 0,
  });
});

test("text: shape props apply regardless of declaration order (font-size before type)", () => {
  // Regression: shapeData props guard on shapeData.type, which used to only be
  // materialized after the first declaration — so a shape prop in the first slot
  // was dropped while node-level fill still applied. Order must not matter.
  const t = build(
    '#t { font-size: 40px; content: "AB"; type: text; fill: #ff0000; }',
  ).children[0];
  const sd = t.shapeData as TextData;
  expect(sd.fontSize).toBe(40);
  expect(sd.content).toBe("AB");
  expect(t.fill).toBe("#ff0000");
});

test("text: font-family / numeric font-weight", () => {
  const t = build(
    '#t { type: text; content: "x"; font-family: "Georgia"; font-weight: 700; }',
  ).children[0];
  const sd = t.shapeData as TextData;
  expect(sd.fontFamily).toBe("Georgia");
  expect(sd.fontWeight).toBe("700");
});

test("text: headless bounds estimate is sane (0.6 * fontSize * len)", () => {
  const t = build(
    '#t { type: text; content: "AB"; x: 100px; y: 100px; font-size: 20px; }',
  ).children[0];
  const b = getShapeBounds(t);
  // no DOM under bun -> estimate path
  expect(b.width).toBeCloseTo(0.6 * 20 * 2, 5);
  expect(b.height).toBe(20);
  expect(b).toMatchObject({ x: 100, y: 80 }); // anchor start, baseline alphabetic
});

test("text: font-size animates via registry and invalidates measured bounds", () => {
  const t = build('#t { type: text; content: "AB"; font-size: 20px; }')
    .children[0];
  getShapeBounds(t); // populate cache, clears dirty flag
  expect(t.textBoundsDirty).toBe(false);

  getPropHandler("font-size")!.apply(t, 40);
  expect((t.shapeData as TextData).fontSize).toBe(40);
  expect(t.textBoundsDirty).toBe(true);
  expect(getShapeBounds(t).width).toBeCloseTo(0.6 * 40 * 2, 5); // remeasured
});

test("text: hit-test against estimated bounds", () => {
  const root = build(
    '#t { type: text; content: "AB"; x: 100px; y: 100px; font-size: 20px; }',
  );
  root.children[0].interactive = true;
  expect(hitTest(root, { x: 110, y: 90 })).toBe(root.children[0]); // inside
  expect(hitTest(root, { x: 300, y: 300 })).toBeNull(); // outside
});

// --- hit-test bubbling + pointer-events --------------------------------------
// DOM/SVG-style bubbling: a shape whose geometry contains the point credits its
// nearest interactive ancestor-or-self. This replaces the old "only a directly-
// interactive shape is ever hit, groups never" behavior — those semantics are
// asserted below on purpose.

test("bubbling: interactive group is hit (and flips to :hover) when a descendant shape is hovered", () => {
  // The group itself has no geometry; the old hit-test could never hit it. Now a
  // hover over its child rect bubbles up and drives the group's &:hover.
  const src = `#g { type: group; &:hover { opacity: 0.5; }
    > #c { type: rect; x: 0; y: 0; width: 40px; height: 40px; fill: #000; } }`;
  const root = build(src);
  const g = root.children[0];
  expect(g.type).toBe("group");
  expect(g.interactive).toBe(true);

  // Point inside the child rect, which has no interactive ancestor but the group.
  expect(hitTest(root, { x: 10, y: 10 })).toBe(g);

  const mgr = createInteractionManager();
  mgr.setScene(root);
  mgr.update({ cursor: { x: 10, y: 10, isDown: false } }, 0);
  expect(g.interactionState).toBe("hover");
});

test("bubbling: child geometry poking outside the parent bubbles to the interactive parent", () => {
  // Parent rect is (0,0)-(50,50); the child overhangs to (80,80). A point in the
  // overhang is outside the parent's own outline but still hits the parent.
  const src = `#p { type: rect; x: 0; y: 0; width: 50px; height: 50px; &:hover { opacity: 0.5; }
    > #c { type: rect; x: 40px; y: 40px; width: 40px; height: 40px; fill: #000; } }`;
  const p = build(src).children[0];
  expect(hitTest(p, { x: 70, y: 70 })).toBe(p); // overhang region -> parent
  expect(hitTest(p, { x: 5, y: 5 })).toBe(p); // parent's own geometry -> parent
  expect(hitTest(p, { x: 200, y: 200 })).toBeNull(); // outside both
});

test("bubbling: a directly-interactive child beats an interactive ancestor inside the child geometry", () => {
  // Both parent and child are interactive; nearest wins. Inside the child -> the
  // child (deeper paint depth); in the parent-only region -> the parent.
  const src = `#p { type: rect; x: 0; y: 0; width: 100px; height: 100px; &:hover { opacity: 0.5; }
    > #c { type: rect; x: 20px; y: 20px; width: 20px; height: 20px; &:hover { opacity: 0.5; } } }`;
  const p = build(src).children[0];
  const c = p.children[0];
  expect(hitTest(p, { x: 30, y: 30 })).toBe(c); // inside child -> nearest (child)
  expect(hitTest(p, { x: 5, y: 5 })).toBe(p); // parent-only -> parent
});

test("pointer-events: none excludes a child from the parent hover region and skips its subtree", () => {
  // The none child overhangs the interactive parent; its geometry neither hits
  // it nor bubbles to the parent.
  const overhang = `#p { type: rect; x: 0; y: 0; width: 50px; height: 50px; &:hover { opacity: 0.5; }
    > #c { type: rect; x: 40px; y: 40px; width: 40px; height: 40px; pointer-events: none; } }`;
  const p = build(overhang).children[0];
  expect(p.children[0].pointerEvents).toBe("none");
  expect(hitTest(p, { x: 70, y: 70 })).toBeNull(); // overhang no longer bubbles
  expect(hitTest(p, { x: 10, y: 10 })).toBe(p); // parent's own geometry still hits

  // A none subtree is skipped whole: an interactive descendant is not re-enabled.
  const subtree = `#g { type: group; pointer-events: none;
    > #c { type: rect; x: 0; y: 0; width: 40px; height: 40px; &:hover { opacity: 0.5; } } }`;
  const g = build(subtree).children[0];
  expect(hitTest(g, { x: 10, y: 10 })).toBeNull();
});

test("bubbling: an unpainted (fill: none) child still hits, crediting the interactive parent", () => {
  // Hit-testing is geometry-only, so a fill:none shape still hits (existing
  // quirk); bubbling inherits it — the parent's hover region includes the
  // invisible child geometry.
  const src = `#p { type: rect; x: 0; y: 0; width: 50px; height: 50px; &:hover { opacity: 0.5; }
    > #c { type: rect; x: 40px; y: 40px; width: 40px; height: 40px; fill: none; } }`;
  const p = build(src).children[0];
  expect(p.children[0].fill).toBeNull();
  expect(hitTest(p, { x: 70, y: 70 })).toBe(p);
});

// --- symbols (@define / use) -------------------------------------------------

test("circle: x/y (bounding-box top-left) convert to cx/cy", () => {
  const root = build(`#c { type: circle; x: 10px; y: 20px; r: 5px; }`);
  const c = root.children[0].shapeData as CircleData;
  expect(c.cx).toBe(15);
  expect(c.cy).toBe(25);
});

test("circle: left/top alias also converts (via parser expandAliases)", () => {
  const root = build(`#c { type: circle; left: 10px; top: 20px; r: 5px; }`);
  const c = root.children[0].shapeData as CircleData;
  expect(c.cx).toBe(15);
  expect(c.cy).toBe(25);
});

test("ellipse: x/y convert to cx/cy using rx/ry", () => {
  const root = build(
    `#e { type: ellipse; x: 10px; y: 20px; rx: 5px; ry: 8px; }`,
  );
  const e = root.children[0].shapeData as EllipseData;
  expect(e.cx).toBe(15);
  expect(e.cy).toBe(28);
});

test("circle: x/y conversion is declaration-order independent (r declared after x/y)", () => {
  const root = build(`#c { type: circle; x: 10px; y: 20px; r: 5px; }`);
  const reordered = build(`#c { type: circle; r: 5px; x: 10px; y: 20px; }`);
  const a = root.children[0].shapeData as CircleData;
  const b = reordered.children[0].shapeData as CircleData;
  expect(a.cx).toBe(b.cx);
  expect(a.cy).toBe(b.cy);
  expect(a.cx).toBe(15);
  expect(a.cy).toBe(25);
});

test("circle: explicit cx/cy wins over x/y regardless of order", () => {
  const before = build(
    `#c { type: circle; x: 10px; y: 20px; cx: 99px; cy: 98px; r: 5px; }`,
  );
  const after = build(
    `#c { type: circle; cx: 99px; cy: 98px; x: 10px; y: 20px; r: 5px; }`,
  );
  for (const root of [before, after]) {
    const c = root.children[0].shapeData as CircleData;
    expect(c.cx).toBe(99);
    expect(c.cy).toBe(98);
  }
});

const SYMBOL_SRC = `
@keyframes grow { from { r: 5px; } to { r: 50px; } }
@define spark {
  type: circle; r: 5px; fill: #fbbf24; animation: grow 1s linear;
  > #tail { type: rect; width: 4px; }
}
#s1 { use: spark; cx: 10px; }
#s2 { use: spark; cx: 100px; fill: #000000; }
`;

test("use: instantiates a symbol; use-site declarations override", () => {
  const root = build(SYMBOL_SRC);
  const [s1, s2] = root.children;
  expect(s1.type).toBe("circle");
  expect((s1.shapeData as CircleData).cx).toBe(10);
  expect((s2.shapeData as CircleData).cx).toBe(100);
  expect(s1.fill).toBe("#fbbf24"); // from definition
  expect(s2.fill).toBe("#000000"); // use-site override wins
});

test("use: definition children are cloned with namespaced ids", () => {
  const [s1, s2] = build(SYMBOL_SRC).children;
  expect(s1.children[0].id).toBe("s1.tail");
  expect(s2.children[0].id).toBe("s2.tail");
  expect(s1.children[0]).not.toBe(s2.children[0]); // distinct nodes
});

test("use: each instance animates independently", () => {
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

test("use: unknown symbol name throws", () => {
  expect(() => build("#x { use: nope; }")).toThrow(/unknown symbol 'nope'/);
});

test("use: cyclic definitions throw", () => {
  const src = "@define a { use: b; } @define b { use: a; } #x { use: a; }";
  expect(() => build(src)).toThrow(/cyclic symbol definition/);
});

// --- animation shorthand: time-value ordering (no 1000ms sentinel) -----------

test("animation shorthand: 1s duration + nonzero delay parses exactly", () => {
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

test("steps() parses in shorthand, longhand, and per-keyframe", () => {
  const src = `
@keyframes k {
  from { opacity: 0; animation-timing-function: steps(3, jump-start); }
  to { opacity: 1; }
}
#a { type: rect; width: 10px; animation: k 1s steps(4, jump-none); }
#b { type: rect; width: 10px; animation-name: k; animation-timing-function: step-start; }
`;
  const [a, b] = build(src).children;
  expect(a.animations[0].timingFunction).toEqual({
    type: "steps",
    count: 4,
    position: "jump-none",
  });
  expect(a.animations[0].keyframes[0].easing).toEqual({
    type: "steps",
    count: 3,
    position: "jump-start",
  });
  expect(b.animations[0].timingFunction).toBe("step-start");
});

// --- var() easing (hoisted cubic-bezier custom property) --------------------

test("var() easing resolves identically to inline in shorthand/longhand/keyframe", () => {
  const inline = `cubic-bezier(0.25, 0.1, 0.25, 1)`;
  const src = `
:root { --e0: cubic-bezier(0.25, 0.1, 0.25, 1); }
@keyframes k {
  from { opacity: 0; animation-timing-function: var(--e0); }
  to { opacity: 1; }
}
@keyframes ki {
  from { opacity: 0; animation-timing-function: ${inline}; }
  to { opacity: 1; }
}
#hoisted { type: rect; width: 10px; animation: k 1s var(--e0); }
#long { type: rect; width: 10px; animation-name: k; animation-timing-function: var(--e0); }
#inline { type: rect; width: 10px; animation: ki 1s ${inline}; }
`;
  const [hoisted, long, inl] = build(src).children;
  const expected = {
    type: "cubic-bezier",
    x1: 0.25,
    y1: 0.1,
    x2: 0.25,
    y2: 1,
  };
  // Shorthand, longhand, and per-keyframe easing all resolve the var().
  expect(hoisted.animations[0].timingFunction).toEqual(expected);
  expect(long.animations[0].timingFunction).toEqual(expected);
  expect(hoisted.animations[0].keyframes[0].easing).toEqual(expected);
  // ...and match the inline form byte-for-byte.
  expect(hoisted.animations[0].timingFunction).toEqual(
    inl.animations[0].timingFunction,
  );
  expect(hoisted.animations[0].keyframes[0].easing).toEqual(
    inl.animations[0].keyframes[0].easing,
  );
});

// --- multi-selector keyframe blocks (`0%, 100% { ... }`) --------------------

test("keyframe block with a selector list applies at every listed offset", () => {
  // `0%, 100%` must produce keyframes at BOTH 0 and 1 (standard CSS); a loop
  // that shares its endpoints uses this idiom to return to its start value.
  const src = `
@keyframes k { 0%, 100% { r: 10px; } 50% { r: 20px; } }
#a { type: circle; r: 10px; animation: k 1s linear; }
`;
  const [node] = build(src).children;
  const kf = node.animations[0].keyframes;
  expect(kf.map((k) => k.offset)).toEqual([0, 0.5, 1]);
  expect(kf[0].properties.r).toBe(10);
  expect(kf[1].properties.r).toBe(20);
  expect(kf[2].properties.r).toBe(10); // the trailing 100% frame — dropped before the fix
});

test("linear() parses and distributes missing inputs per CSS L2", () => {
  const src = `
@keyframes k { from { opacity: 0; } to { opacity: 1; } }
#a { type: rect; width: 10px; animation: k 1s linear(0, 0.25, 1); }
#b { type: rect; width: 10px; animation: k 1s linear(0, 0.5 25% 75%, 1); }
`;
  const [a, b] = build(src).children;
  const ea = a.animations[0].timingFunction;
  expect(ea).toEqual({
    type: "linear",
    points: [
      { input: 0, output: 0 },
      { input: 0.5, output: 0.25 }, // missing input distributed to the midpoint
      { input: 1, output: 1 },
    ],
  });
  // Two-percentage stop expands to two points sharing the output (flat segment).
  const eb = b.animations[0].timingFunction;
  expect(eb).toEqual({
    type: "linear",
    points: [
      { input: 0, output: 0 },
      { input: 0.25, output: 0.5 },
      { input: 0.75, output: 0.5 },
      { input: 1, output: 1 },
    ],
  });
});

// --- individual transform properties (translate / rotate / scale) -----------

test("individual transform properties set base channels", () => {
  const src = `#a { type: rect; width: 10px; translate: 10px 20px; rotate: 45deg; scale: 2 3; }`;
  const [a] = build(src).children;
  expect(a.transform.translateX).toBe(10);
  expect(a.transform.translateY).toBe(20);
  expect(a.transform.rotate).toBe(45);
  expect(a.transform.scaleX).toBe(2);
  expect(a.transform.scaleY).toBe(3);
});

test("individual transform single-arg defaults (translate y=0, scale uniform)", () => {
  const src = `#a { type: rect; width: 10px; translate: 10px; scale: 2; }`;
  const [a] = build(src).children;
  expect(a.transform.translateY).toBe(0);
  expect(a.transform.scaleX).toBe(2);
  expect(a.transform.scaleY).toBe(2);
});

test("individual transform + transform: last declaration wins per channel", () => {
  const [a] = build(
    `#a { type: rect; width: 10px; transform: translateX(5px); translate: 40px 0; }`,
  ).children;
  expect(a.transform.translateX).toBe(40);
  const [b] = build(
    `#b { type: rect; width: 10px; translate: 40px 0; transform: translateX(5px); }`,
  ).children;
  expect(b.transform.translateX).toBe(5);
});

test("individual transform properties animate the same channels", () => {
  const src = `
@keyframes k { from { translate: 0 0; scale: 1; } to { translate: 100px 50px; scale: 2 3; } }
#a { type: rect; width: 10px; animation: k 1s linear; }
`;
  const [a] = build(src).children;
  const to = a.animations[0].keyframes[1].properties;
  expect(to.translateX).toBe(100);
  expect(to.translateY).toBe(50);
  expect(to.scaleX).toBe(2);
  expect(to.scaleY).toBe(3);
});

test("individual transform properties in :hover state block", () => {
  const src = `#a { type: rect; width: 10px; &:hover { translate: 5px 0; scale: 1.1; rotate: 10deg; } }`;
  const [a] = build(src).children;
  expect(a.hoverStyles?.transform?.translateX).toBe(5);
  expect(a.hoverStyles?.transform?.scaleX).toBe(1.1);
  expect(a.hoverStyles?.transform?.scaleY).toBe(1.1);
  expect(a.hoverStyles?.transform?.rotate).toBe(10);
});

// --- animation-composition --------------------------------------------------

test("animation-composition: add composes onto the value already written", () => {
  const src = `
@keyframes shift { from { transform: translateX(0); } to { transform: translateX(50px); } }
#a { type: rect; width: 10px; transform: translateX(100px); animation: shift 1s linear; animation-composition: add; }
`;
  const [a] = build(src).children;
  expect(a.animations[0].composition).toBe("add");
  const sched = new AnimationScheduler();
  resetNodeToBase(a);
  sched.sampleNode(a, 500); // progress 0.5 -> +25 on top of base 100
  expect(a.transform.translateX).toBe(125);
});

test("animation-composition: accumulate == add for plain numbers", () => {
  const src = `
@keyframes shift { from { transform: translateX(0); } to { transform: translateX(50px); } }
#a { type: rect; width: 10px; transform: translateX(100px); animation: shift 1s linear; animation-composition: accumulate; }
`;
  const [a] = build(src).children;
  const sched = new AnimationScheduler();
  resetNodeToBase(a);
  sched.sampleNode(a, 500);
  expect(a.transform.translateX).toBe(125);
});

test("animation-composition: replace (default) overwrites", () => {
  const src = `
@keyframes shift { from { transform: translateX(0); } to { transform: translateX(50px); } }
#a { type: rect; width: 10px; transform: translateX(100px); animation: shift 1s linear; }
`;
  const [a] = build(src).children;
  expect(a.animations[0].composition).toBe("replace");
  const sched = new AnimationScheduler();
  resetNodeToBase(a);
  sched.sampleNode(a, 500);
  expect(a.transform.translateX).toBe(25);
});

test("animation-composition is NOT part of the shorthand (shorthand resets it)", () => {
  const src = `
@keyframes shift { from { transform: translateX(0); } to { transform: translateX(50px); } }
#a { type: rect; width: 10px; animation-composition: add; animation: shift 1s linear; }
`;
  const [a] = build(src).children;
  expect(a.animations[0].composition).toBe("replace");
});

test("animation-composition: comma-list positional against animation-name", () => {
  const src = `
@keyframes shift { from { transform: translateX(0); } to { transform: translateX(50px); } }
@keyframes grow { from { transform: scale(1); } to { transform: scale(2); } }
#a { type: rect; width: 10px; animation: shift 1s linear, grow 1s linear; animation-composition: add, replace; }
`;
  const [a] = build(src).children;
  expect(a.animations[0].composition).toBe("add");
  expect(a.animations[1].composition).toBe("replace");
});

test("animation-composition: color falls back to replace", () => {
  const src = `
@keyframes fadeCol { from { fill: #000000; } to { fill: #ffffff; } }
#a { type: rect; width: 10px; fill: #ff0000; animation: fadeCol 1s linear; animation-composition: add; }
`;
  const [a] = build(src).children;
  const sched = new AnimationScheduler();
  resetNodeToBase(a);
  sched.sampleNode(a, 500); // mid grey, not "added" onto red
  expect(a.fill).toBe("rgb(128, 128, 128)");
});

// --- transitions -------------------------------------------------------------

test("transition shorthand parses (comma list, easing, delay)", () => {
  const [a] = build(
    `#a { type: rect; width: 10px; transition: fill 0.3s ease, transform 200ms linear 100ms; }`,
  ).children;
  expect(a.transitions).toEqual([
    { property: "fill", duration: 300, easing: "ease", delay: 0 },
    { property: "transform", duration: 200, easing: "linear", delay: 100 },
  ]);
});

test("transition longhands compose positionally; default property is all", () => {
  const [a] = build(
    `#a { type: rect; width: 10px; transition-property: opacity; transition-duration: 0.5s; transition-timing-function: ease-in; transition-delay: 0.1s; }`,
  ).children;
  expect(a.transitions).toEqual([
    { property: "opacity", duration: 500, easing: "ease-in", delay: 100 },
  ]);
  const [b] = build(
    `#b { type: rect; width: 10px; transition: 0.3s; }`,
  ).children;
  expect(b.transitions).toEqual([
    { property: "all", duration: 300, easing: "ease", delay: 0 },
  ]);
});

test("zero-duration transitions are dropped (instant)", () => {
  const [a] = build(
    `#a { type: rect; width: 10px; transition-property: fill; }`,
  ).children;
  expect(a.transitions).toEqual([]);
});

test("transition inside a state block is stored on that state", () => {
  const [a] = build(
    `#a { type: rect; width: 10px; &:hover { fill: #fff; transition: fill 0.2s; } }`,
  ).children;
  expect(a.hoverStyles?.transitions).toEqual([
    { property: "fill", duration: 200, easing: "ease", delay: 0 },
  ]);
});

test("transition tweens fill on hover enter over the duration", () => {
  const src = `#btn { type: rect; x: 0; y: 0; width: 100px; height: 100px; fill: #000000; transition: fill 300ms linear; &:hover { fill: #ffffff; } }`;
  const root = build(src);
  const btn = root.children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);

  const hover = { cursor: { x: 50, y: 50, isDown: false } };
  mgr.update(hover, 1000); // flip to hover at t=1000, snapshot from = #000

  const frame = (now: number) => {
    resetNodeToBase(btn);
    mgr.applyOverrides(btn, now);
    return btn.fill;
  };
  expect(frame(1000)).toBe("#000000"); // start (from snapshot, verbatim)
  expect(frame(1150)).toBe("rgb(128, 128, 128)"); // halfway
  expect(frame(1300)).toBe("#ffffff"); // done -> target snaps
});

test("transition tweens back on hover exit", () => {
  const src = `#btn { type: rect; x: 0; y: 0; width: 100px; height: 100px; fill: #000000; transition: fill 200ms linear; &:hover { fill: #ffffff; } }`;
  const root = build(src);
  const btn = root.children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  const frame = (now: number) => {
    resetNodeToBase(btn);
    mgr.applyOverrides(btn, now);
    return btn.fill;
  };

  mgr.update({ cursor: { x: 50, y: 50, isDown: false } }, 0);
  frame(200); // complete hover -> white
  mgr.update({ cursor: { x: 500, y: 500, isDown: false } }, 1000); // leave -> flip to normal, from = white
  expect(frame(1100)).toBe("rgb(128, 128, 128)"); // halfway back
  expect(frame(1200)).toBe("#000000"); // back to base
});

test("transform transition tweens scale on hover", () => {
  const src = `#btn { type: rect; x: 0; y: 0; width: 100px; height: 100px; fill: #000; transition: transform 100ms linear; &:hover { transform: scale(2); } }`;
  const root = build(src);
  const btn = root.children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  mgr.update({ cursor: { x: 50, y: 50, isDown: false } }, 0);
  resetNodeToBase(btn);
  mgr.applyOverrides(btn, 50); // halfway: scale 1 -> 2
  expect(btn.transform.scaleX).toBe(1.5);
  resetNodeToBase(btn);
  mgr.applyOverrides(btn, 100);
  expect(btn.transform.scaleX).toBe(2);
});

// stage 2: transitions tween ANY registry property, not just the legacy six.
test("transition eases a registry geometry prop (r) over its duration", () => {
  const src = `#c { type: circle; cx: 50px; cy: 50px; r: 10px; transition: r 200ms linear; &:hover { r: 30px; } }`;
  const root = build(src);
  const c = root.children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  const frame = (now: number) => {
    resetNodeToBase(c);
    mgr.applyOverrides(c, now);
    return (c.shapeData as CircleData).r;
  };
  mgr.update({ cursor: { x: 50, y: 50, isDown: false } }, 1000); // flip to hover, from r=10
  expect(frame(1000)).toBe(10); // start (from snapshot)
  const mid = frame(1100); // halfway
  expect(mid).toBeGreaterThan(10);
  expect(mid).toBeLessThan(30);
  expect(frame(1200)).toBe(30); // settles at target
});

// stage 2: object-valued endpoints that can't blend flip at the eased midpoint
// (CSS discrete-transition rule), NOT at settle time.
test("transition flips an unblendable paint (solid -> gradient) at the eased midpoint", () => {
  const src = `#c { type: circle; cx: 50px; cy: 50px; r: 40px; fill: #000000;
    transition: fill 200ms linear; &:hover { fill: linear-gradient(90deg, #ff0000 0%, #0000ff 100%); } }`;
  const root = build(src);
  const c = root.children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  mgr.update({ cursor: { x: 50, y: 50, isDown: false } }, 0); // flip to hover, from = solid #000
  // Before the eased midpoint: still the source solid, no gradient.
  resetNodeToBase(c);
  mgr.applyOverrides(c, 80); // e = 0.4
  expect(c.fill).toBe("#000000");
  expect(c.fillGradient).toBeNull();
  // After the midpoint: the target gradient wins and the solid is cleared.
  resetNodeToBase(c);
  mgr.applyOverrides(c, 120); // e = 0.6
  expect(c.fill).toBeNull();
  expect(c.fillGradient?.stops[0].color).toBe("#ff0000");
});

// stage 2: a state flip mid-tween eases back from the DISPLAYED value, not the
// target it was heading toward.
test("transition reversal eases back from the displayed value, not the target", () => {
  const src = `#c { type: circle; cx: 50px; cy: 50px; r: 10px; transition: r 200ms linear; &:hover { r: 30px; } }`;
  const root = build(src);
  const c = root.children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  const frame = (now: number) => {
    resetNodeToBase(c);
    mgr.applyOverrides(c, now);
    return (c.shapeData as CircleData).r;
  };
  mgr.update({ cursor: { x: 50, y: 50, isDown: false } }, 0); // hover enter, from r=10
  expect(frame(100)).toBe(20); // halfway in: displayed r = 20
  mgr.update({ cursor: { x: 500, y: 500, isDown: false } }, 100); // leave at midpoint, from = displayed 20
  const back = frame(150); // 50ms into the 200ms reverse
  expect(back).toBeGreaterThan(10);
  expect(back).toBeLessThan(20); // easing DOWN from 20 toward base, not up toward 30
  expect(frame(300)).toBe(10); // settles back at base
});

// --- state-child rules (`#p:hover > #c`) ------------------------------------

// A card whose hover state restyles a specific direct child (the icon).
const CARD = `#card {
  type: rect; x: 0; y: 0; width: 100px; height: 100px; fill: #111111;
  > #icon { type: rect; x: 40px; y: 40px; width: 20px; height: 20px; fill: #888888; }
  &:hover { fill: #2a2a4a; > #icon { fill: #ffffff; transform: rotate(15deg); } }
}`;
const OVER = { cursor: { x: 50, y: 50, isDown: false } };
const OUT = { cursor: { x: 500, y: 500, isDown: false } };

test("state-child: parent hover applies/unapplies the child override", () => {
  const root = build(CARD);
  const card = root.children[0];
  const icon = card.children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  const paint = (node: typeof card, now: number) => {
    resetNodeToBase(node);
    mgr.applyOverrides(node, now);
  };

  // Being targeted by an ancestor doesn't make the child hit-testable itself.
  expect(card.interactive).toBe(true);
  expect(icon.interactive).toBe(false);

  mgr.update(OVER, 0);
  paint(card, 0);
  paint(icon, 0);
  expect(card.fill).toBe("#2a2a4a");
  expect(icon.fill).toBe("#ffffff");
  expect(icon.transform.rotate).toBe(15); // transform delta composes on the child

  mgr.update(OUT, 100);
  paint(card, 100);
  paint(icon, 100);
  expect(card.fill).toBe("#111111");
  expect(icon.fill).toBe("#888888");
  expect(icon.transform.rotate).toBe(0);
});

test("state-child transition: own node-level transition wins over parent block", () => {
  const src = `#card {
    type: rect; x: 0; y: 0; width: 100px; height: 100px; fill: #111;
    > #icon { type: rect; x: 40px; y: 40px; width: 20px; height: 20px; transition: transform 100ms linear; }
    &:hover { transition: transform 999ms linear; > #icon { transform: rotate(20deg); } }
  }`;
  const root = build(src);
  const ic = root.children[0].children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  const paint = (now: number) => {
    resetNodeToBase(ic);
    mgr.applyOverrides(ic, now);
  };
  mgr.update(OVER, 0);
  paint(50);
  expect(ic.transform.rotate).toBe(10); // child's own 100ms curve (not the parent's 999ms)
  paint(100);
  expect(ic.transform.rotate).toBe(20);
});

test("state-child transition: falls back to the parent state block transition", () => {
  const src = `#card {
    type: rect; x: 0; y: 0; width: 100px; height: 100px; fill: #111;
    > #icon { type: rect; x: 40px; y: 40px; width: 20px; height: 20px; }
    &:hover { transition: transform 100ms linear; > #icon { transform: rotate(20deg); } }
  }`;
  const root = build(src);
  const ic = root.children[0].children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  const paint = (now: number) => {
    resetNodeToBase(ic);
    mgr.applyOverrides(ic, now);
  };
  mgr.update(OVER, 0);
  paint(50);
  expect(ic.transform.rotate).toBe(10); // parent block's 100ms governs the child
  paint(100);
  expect(ic.transform.rotate).toBe(20);
});

test("state-child: active falls back to hover overrides", () => {
  const src = `#card {
    type: rect; x: 0; y: 0; width: 100px; height: 100px; fill: #111;
    > #icon { type: rect; x: 40px; y: 40px; width: 20px; height: 20px; fill: #888888; }
    &:hover { > #icon { fill: #ffffff; } }
  }`;
  const root = build(src);
  const ic = root.children[0].children[0];
  const mgr = createInteractionManager();
  mgr.setScene(root);
  mgr.update({ cursor: { x: 50, y: 50, isDown: true } }, 0); // press over the card
  resetNodeToBase(ic);
  mgr.applyOverrides(ic, 0);
  expect(ic.fill).toBe("#ffffff"); // no &:active block -> child uses its hover override
});

// --- polystar (star / polygon) ----------------------------------------------

test("star: declarations populate PolystarData", () => {
  const src = `#s {
    type: star; sides: 6; outer-radius: 80px; inner-radius: 40px;
    rotation: 15deg; cx: 100px; cy: 100px; outer-roundness: 25%; fill: #f00;
  }`;
  const [node] = build(src).children;
  expect(node.type).toBe("star");
  const sd = node.shapeData as PolystarData;
  expect(sd).toMatchObject({
    type: "star",
    sides: 6,
    outerRadius: 80,
    innerRadius: 40,
    rotation: 15,
    cx: 100,
    cy: 100,
    outerRoundness: 25,
  });
});

test("polygon: inner-radius is ignored (polygon has none)", () => {
  const [node] = build(
    "#p { type: polygon; sides: 5; outer-radius: 50px; inner-radius: 99px; }",
  ).children;
  expect((node.shapeData as PolystarData).innerRadius).toBe(0);
});

test("star: animating outer-radius rebuilds via the registry (dirty flag)", () => {
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

test("stroke-dasharray + dashoffset parse; dashoffset animates", () => {
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

test("fill-rule: parses evenodd; defaults to nonzero", () => {
  const [a] = build(
    '#a { type: path; d: "M0 0 L10 0 L0 10 Z"; fill-rule: evenodd; }',
  ).children;
  expect(a.fillRule).toBe("evenodd");
  const [b] = build('#b { type: path; d: "M0 0 L10 0 L0 10 Z"; }').children;
  expect(b.fillRule).toBe("nonzero");
});

// --- paint-order -------------------------------------------------------------

test("paint-order: parses stroke; defaults to normal", () => {
  const [a] = build(
    '#a { type: path; d: "M0 0 L10 0 Z"; paint-order: stroke; }',
  ).children;
  expect(a.paintOrder).toBe("stroke");
  const [b] = build('#b { type: path; d: "M0 0 L10 0 Z"; }').children;
  expect(b.paintOrder).toBe("normal");
});

// --- multi-path clip (Lottie mask add-mode) ----------------------------------

test("clip-path: multiple path() values union into one command list", () => {
  const [g] = build(
    "#g { type: group; clip-path: path('M0 0 L10 0 L10 10 Z') path('M20 20 L30 20 L30 30 Z'); }",
  ).children;
  expect(g.clipPath?.type).toBe("path");
  if (g.clipPath?.type === "path") {
    // Two triangles -> two M commands in the concatenated list.
    expect(g.clipPath.commands.filter((c) => c.type === "M")).toHaveLength(2);
  }
});

test("clip-path: @keyframes morph the clip commands via the registry", () => {
  const [g] = build(`
    @keyframes reveal {
      from { clip-path: path('M0 0 L10 0 L10 10 L0 10 Z'); }
      to   { clip-path: path('M0 0 L20 0 L20 10 L0 10 Z'); }
    }
    #g { type: group; clip-path: path('M0 0 L10 0 L10 10 L0 10 Z');
         animation: reveal 1s linear; }
  `).children;

  // Base = first keyframe (unclipped author state).
  expect(g.clipPath?.type).toBe("path");
  const handler = getPropHandler("clip-path");
  expect(handler?.kind).toBe("path");

  const sched = new AnimationScheduler();
  resetNodeToBase(g);
  sched.sampleNode(g, 500); // midway through the 1s animation
  // The second point's x lerps 10 -> 20, so at t=0.5 it sits at 15.
  if (g.clipPath?.type === "path") {
    const line = g.clipPath.commands.find((c) => c.type === "L") as {
      x: number;
    };
    expect(line.x).toBeCloseTo(15, 5);
  }

  // A fresh reset restores the authored base (10), proving the morph never
  // corrupts the base snapshot.
  resetNodeToBase(g);
  if (g.clipPath?.type === "path") {
    const line = g.clipPath.commands.find((c) => c.type === "L") as {
      x: number;
    };
    expect(line.x).toBeCloseTo(10, 5);
  }
});

// --- filter ------------------------------------------------------------------

test("filter: parses blur + drop-shadow in order, color optional -> black", () => {
  const [a] = build(
    "#a { type: rect; filter: blur(8px) drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.5)); }",
  ).children;
  expect(a.filter).toEqual([
    { type: "blur", radius: 8 },
    { type: "drop-shadow", dx: 2, dy: 4, blur: 6, color: "rgba(0, 0, 0, 0.5)" },
  ]);
  // Color omitted -> defaults to black; blur length defaults to 0.
  const [b] = build(
    "#b { type: rect; filter: drop-shadow(3px 5px); }",
  ).children;
  expect(b.filter).toEqual([
    { type: "drop-shadow", dx: 3, dy: 5, blur: 0, color: "#000000" },
  ]);
});

test("filter: blur radius animates via the registry, base is preserved", () => {
  const [g] = build(`
    @keyframes soften { from { filter: blur(4px); } to { filter: blur(12px); } }
    #g { type: rect; filter: blur(4px); animation: soften 1s linear; }
  `).children;

  expect(getPropHandler("filter")?.kind).toBe("path");
  const sched = new AnimationScheduler();
  resetNodeToBase(g);
  sched.sampleNode(g, 500); // midway
  expect((g.filter?.[0] as { radius: number } | undefined)?.radius).toBeCloseTo(
    8,
    5,
  );

  // A fresh reset restores the authored base (4), proving the morph never
  // corrupts the base snapshot copy.
  resetNodeToBase(g);
  expect((g.filter?.[0] as { radius: number } | undefined)?.radius).toBeCloseTo(
    4,
    5,
  );
});

test("filter: parses color-adjust functions; percent -> fraction, hue-rotate deg", () => {
  const [a] = build(
    "#a { type: rect; filter: brightness(0.5) contrast(150%) grayscale(1) hue-rotate(90deg); }",
  ).children;
  expect(a.filter).toEqual([
    { type: "brightness", amount: 0.5 },
    { type: "contrast", amount: 1.5 },
    { type: "grayscale", amount: 1 },
    { type: "hue-rotate", amount: 90 },
  ]);
  // Omitted arg defaults: color-adjust -> 1, hue-rotate -> 0.
  const [b] = build(
    "#b { type: rect; filter: saturate() hue-rotate(); }",
  ).children;
  expect(b.filter).toEqual([
    { type: "saturate", amount: 1 },
    { type: "hue-rotate", amount: 0 },
  ]);
});

test("filter: whole list animates per-op when the function sequence matches", () => {
  const [g] = build(`
    @keyframes recolor {
      from { filter: brightness(1) drop-shadow(0px 0px 0px #000000); }
      to   { filter: brightness(2) drop-shadow(4px 4px 8px #ffffff); }
    }
    #g { type: rect; filter: brightness(1) drop-shadow(0px 0px 0px #000000);
         animation: recolor 1s linear; }
  `).children;

  const sched = new AnimationScheduler();
  resetNodeToBase(g);
  sched.sampleNode(g, 500); // midway
  expect(g.filter).toEqual([
    { type: "brightness", amount: 1.5 },
    { type: "drop-shadow", dx: 2, dy: 2, blur: 4, color: "rgb(128, 128, 128)" },
  ]);

  // Base snapshot survives the morph.
  resetNodeToBase(g);
  expect((g.filter?.[0] as { amount: number } | undefined)?.amount).toBe(1);
});

test("filter: mismatched function sequences replace (hold departing), not crash", () => {
  const [g] = build(`
    @keyframes swap {
      from { filter: blur(4px); }
      to   { filter: brightness(2); }
    }
    #g { type: rect; filter: blur(4px); animation: swap 1s linear; }
  `).children;

  const sched = new AnimationScheduler();
  resetNodeToBase(g);
  sched.sampleNode(g, 500); // midway holds the departing `from`
  expect(g.filter).toEqual([{ type: "blur", radius: 4 }]);
});

// --- track masks ------------------------------------------------------------

const MASK_SRC = `
#content { type: rect; x: 0px; y: 0px; width: 50px; height: 50px; fill: #f00; mask: #mask alpha; }
#mask { type: circle; cx: 25px; cy: 25px; r: 25px; fill: #fff; }
`;

test("mask: resolves the source by id, flags it, and links the mode", () => {
  const root = build(MASK_SRC);
  const [content, mask] = root.children;
  expect(content.mask?.source).toBe(mask);
  expect(content.mask?.mode).toBe("alpha");
  // The source is painted only as a mask, never on its own.
  expect(mask.isMaskSource).toBe(true);
  expect(content.isMaskSource).toBe(false);
});

test("mask: a hex-digit-only source id (#fade lexes as a color) still resolves", () => {
  const root = build(`
#content { type: rect; width: 50px; height: 50px; fill: #f00; mask: #fade luminance; }
#fade { type: rect; width: 50px; height: 50px; fill: #fff; }
`);
  const [content, fade] = root.children;
  expect(content.mask?.source).toBe(fade);
  expect(content.mask?.mode).toBe("luminance");
  expect(fade.isMaskSource).toBe(true);
});

test("mask: an unknown source id throws", () => {
  expect(() =>
    build("#c { type: rect; width: 10px; mask: #nope alpha; }"),
  ).toThrow(/mask on 'c' references unknown node '#nope'/);
});

test("mask: mode variants parse (luminance-invert)", () => {
  const root = build(`
    #c { type: rect; width: 10px; mask: #m luminance-invert; }
    #m { type: rect; width: 10px; }
  `);
  expect(root.children[0].mask?.mode).toBe("luminance-invert");
});

test("mask: content nested inside its own matte source is un-trapped so it renders", () => {
  // Lottie's track-matte-with-parenting (the fish Tail/Fins: content is BOTH
  // masked by AND transform-parented to its source). Naively the source is
  // isMaskSource and the render walk skips its whole subtree, so the nested
  // content never paints. buildSceneGraph must split the source into a plain
  // transform group holding a `-matte` sub-group (the real source).
  const src = `
    #src { type: group; transform: translate(30px, 40px);
      > #shape { type: rect; x: 0px; y: 0px; width: 50px; height: 50px; fill: #fff; }
      > #content { type: rect; x: 0px; y: 0px; width: 50px; height: 50px; fill: #f00; mask: #src alpha; }
    }`;
  const root = build(src);
  const srcNode = root.children[0];
  // #src is now a plain transform group (no longer the mask source).
  expect(srcNode.isMaskSource).toBe(false);
  expect(srcNode.transform.translateX).toBe(30); // its transform is preserved
  const [matte, content] = srcNode.children;
  // A `-matte` sub-group takes over as the mask source, holding the own shapes.
  expect(matte.id).toBe("src-matte");
  expect(matte.isMaskSource).toBe(true);
  expect(matte.children.map((c) => c.id)).toEqual(["shape"]);
  // The content stays parented to #src (transform intact) but now masks the
  // matte holder, so it's no longer inside the mask source's subtree.
  expect(content.id).toBe("content");
  expect(content.parent).toBe(srcNode);
  expect(content.mask?.source).toBe(matte);
});

// --- image nodes -------------------------------------------------------------

test("image: props map with a default-0 box until natural size is known", () => {
  const [n] = build("#i { type: image; content: url('x.png'); }").children;
  expect(n.type).toBe("image");
  expect(n.shapeData as ImageData).toEqual({
    type: "image",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    src: "x.png",
    viewBox: null,
  });
});

test("image: x/y/width/height populate the box", () => {
  const [n] = build(
    "#i { type: image; content: url('a.png'); x: 10px; y: 20px; width: 40px; height: 30px; }",
  ).children;
  expect(n.shapeData as ImageData).toEqual({
    type: "image",
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    src: "a.png",
    viewBox: null,
  });
});

// --- static :root var() resolution (path dedup) ------------------------------
// The Lottie converter hoists repeated path geometry into `:root { --pN: … }`
// and rewrites uses to `var(--pN)`. These must resolve at build time, in both
// static declarations and @keyframes, while reactive input() bindings survive.

test("var: static `d: var(--p)` resolves to a real command list", () => {
  const [n] = build(`
    :root { --p: 'M 0 0 L 10 0 L 10 10 Z'; }
    #p { type: path; d: var(--p); }
  `).children;
  const sd = n.shapeData as PathData;
  expect(sd.commands.length).toBeGreaterThan(0);
  expect(n.bindings).toHaveLength(0); // resolved statically, not a binding
});

test("var: `offset-path: var(--p)` builds a motion path", () => {
  const [n] = build(`
    :root { --p: path('M 0 0 L 100 0'); }
    #m { type: rect; width: 10px; height: 10px; offset-path: var(--p); }
  `).children;
  expect(n.offsetPath).toBeTruthy();
});

test("var: compound `clip-path: var(--a) var(--b)` resolves each path", () => {
  const [n] = build(`
    :root { --a: path('M0 0 H10 V10 H0 Z'); --b: path('M2 2 H8 V8 H2 Z'); }
    #c { type: rect; width: 10px; height: 10px; clip-path: var(--a) var(--b); }
  `).children;
  expect(n.clipPath?.type).toBe("path");
  expect(n.clipPath?.commands.length).toBeGreaterThan(0);
});

test("var: animated `d:` keyframes via var() morph carry commands, not empties", () => {
  const [n] = build(`
    :root { --a: 'M 0 0 L 10 0 L 10 10 Z'; --b: 'M 0 0 L 20 0 L 20 20 Z'; }
    @keyframes morph { 0% { d: var(--a); } 100% { d: var(--b); } }
    #p { type: path; d: var(--a); animation: morph 1s; }
  `).children;
  const kf = n.animations[0].keyframes;
  expect((kf[0].properties.d as unknown[]).length).toBeGreaterThan(0);
  expect((kf[kf.length - 1].properties.d as unknown[]).length).toBeGreaterThan(
    0,
  );
});

test("var: reactive input() binding is preserved, not statically resolved", () => {
  const [n] = build(`
    :root { --x: input(cursor.x); }
    #c { type: circle; r: 10px; cx: var(--x); }
  `).children;
  // A var() whose :root def is reactive stays a binding (numeric, per-frame).
  expect(n.bindings.some((b) => b.property === "cx")).toBe(true);
});

test("var: an unknown var() is left as-is and does not crash the build", () => {
  expect(() => build("#p { type: path; d: var(--missing); }")).not.toThrow();
});

// --- state-animation fill mode -----------------------------------------------

// A one-shot `:state()` animation should hold its end frame for as long as the
// state stays active (stateful-runtime convention), so it defaults to `both`
// rather than the node-level `forwards` — never the CSS `none` that snaps back.
test("state-animation fill mode defaults to `both`", () => {
  const root = build(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: idle; state idle {} }
    #dot { type: circle; r: 5; &:state(idle) { animation: slide 1s linear; } }
    @keyframes slide { 0% { cx: 0 } 100% { cx: 100 } }
  `);
  const dot = root.children.find((c) => c.id === "dot")!;
  expect(dot.stateStyles[0].animations[0].fillMode).toBe("both");
});

test("state-animation: an explicit longhand fill mode wins over the `both` default", () => {
  const root = build(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: idle; state idle {} }
    #dot { type: circle; r: 5;
      &:state(idle) { animation: slide 1s linear; animation-fill-mode: none; } }
    @keyframes slide { 0% { cx: 0 } 100% { cx: 100 } }
  `);
  const dot = root.children.find((c) => c.id === "dot")!;
  expect(dot.stateStyles[0].animations[0].fillMode).toBe("none");
});

test("state-animation: an explicit shorthand fill token wins over the `both` default", () => {
  const root = build(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: idle; state idle {} }
    #dot { type: circle; r: 5; &:state(idle) { animation: slide 1s linear forwards; } }
    @keyframes slide { 0% { cx: 0 } 100% { cx: 100 } }
  `);
  const dot = root.children.find((c) => c.id === "dot")!;
  expect(dot.stateStyles[0].animations[0].fillMode).toBe("forwards");
});

// The `both` default is scoped to :state() animations; node-level animations
// keep the codebase's `forwards` default.
test("base (node-level) animation keeps the `forwards` fill default", () => {
  const [node] = build(
    "@keyframes k { 0% { cx: 0 } 100% { cx: 10 } } #a { type: circle; r: 5; animation: k 1s linear; }",
  ).children;
  expect(node.animations[0].fillMode).toBe("forwards");
});

// --- state-block gradient paint ----------------------------------------------

// The lamp-toggle repro: a `:state()` block that swaps a base radial-gradient
// fill for a warmer one. The gradient must survive build (captured as
// structured GradientData, not silently dropped like a solid `fill` string) and
// win over the base gradient when the state applies.
test(":state() gradient fill is captured as structured GradientData", () => {
  const root = build(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: off; state off {} state on {} }
    #b { type: circle; cx: 50px; cy: 50px; r: 40px;
      fill: radial-gradient(circle 30px at 40px 40px, #101010 0%, #202020 100%);
      &:state(on) { fill: radial-gradient(circle 30px at 40px 40px, #fff6d8 0%, #ffb64a 100%); } }
  `);
  const b = root.children.find((c) => c.id === "b")!;
  const styles = b.stateStyles.find((s) => s.name === "on")!.styles;
  expect(styles.fillGradient?.type).toBe("radial-gradient");
  expect(styles.fillGradient?.stops[0].color).toBe("#fff6d8");
  expect(styles.fill).toBeUndefined(); // not miscaptured as a solid
});

test("applyStateStyles: a :state() gradient fill overrides the base gradient, deep-copied", () => {
  const root = build(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: off; state off {} state on {} }
    #b { type: circle; cx: 50px; cy: 50px; r: 40px;
      fill: radial-gradient(circle 30px at 40px 40px, #101010 0%, #202020 100%);
      &:state(on) { fill: radial-gradient(circle 30px at 40px 40px, #fff6d8 0%, #ffb64a 100%); } }
  `);
  const b = root.children.find((c) => c.id === "b")!;
  const entry = b.stateStyles.find((s) => s.name === "on")!;
  resetNodeToBase(b);
  expect(b.fillGradient?.stops[0].color).toBe("#101010"); // base dark gradient
  applyStateStyles(b, entry.styles);
  expect(b.fillGradient?.stops[0].color).toBe("#fff6d8"); // warm on-state gradient wins
  expect(b.fill).toBeNull();
  // The node must not alias the shared StateStyles gradient (a later in-place
  // interpolation would otherwise corrupt the authored state stops).
  expect(b.fillGradient).not.toBe(entry.styles.fillGradient);
});

// A solid `:state()` fill must clear a base GRADIENT, else the base gradient
// (which the renderer prefers over a solid) would keep winning.
test("applyStateStyles: a solid :state() fill clears a base gradient so the solid wins", () => {
  const root = build(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: off; state off {} state on {} }
    #b { type: circle; cx: 50px; cy: 50px; r: 40px;
      fill: radial-gradient(circle 30px at 40px 40px, #101010 0%, #202020 100%);
      &:state(on) { fill: #ff0000; } }
  `);
  const b = root.children.find((c) => c.id === "b")!;
  const entry = b.stateStyles.find((s) => s.name === "on")!;
  resetNodeToBase(b);
  applyStateStyles(b, entry.styles);
  expect(b.fill).toBe("#ff0000");
  expect(b.fillGradient).toBeNull();
});

// Non-regression: a plain solid :hover fill still applies (the fill/stroke
// capture was refactored through parsePaint; hover shares the same builder).
test("hover: a solid fill override still applies (no regression)", () => {
  const b = build(
    "#b { type: circle; cx: 50px; cy: 50px; r: 40px; fill: #222; &:hover { fill: #f00; } }",
  ).children[0];
  resetNodeToBase(b);
  applyStateStyles(b, b.hoverStyles!);
  expect(b.fill).toBe("#f00");
  expect(b.fillGradient).toBeNull();
});

// Hover gains gradient support for free on the instant-snap path (no transition
// tween declared), since it shares applyStateStyles with machine states.
test("hover: a gradient fill override applies on the instant-snap path", () => {
  const b = build(`
    #b { type: circle; cx: 50px; cy: 50px; r: 40px; fill: #222;
      &:hover { fill: radial-gradient(circle 30px at 40px 40px, #0f0 0%, #00f 100%); } }
  `).children[0];
  resetNodeToBase(b);
  applyStateStyles(b, b.hoverStyles!);
  expect(b.fillGradient?.stops[0].color).toBe("#0f0");
  expect(b.fill).toBeNull();
});

test("state block warns only on unknown props, not on registry props or transition", () => {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (m?: unknown) => {
    warns.push(String(m));
  };
  try {
    buildSceneGraph(
      parse(
        `#a { type: circle; r: 10; fill: red; &:hover { r: 20; fill: blue; opacity: 0.5; transition: fill 200ms; bogus: 3; } }`,
      ),
    );
  } finally {
    console.warn = orig;
  }
  // `r` is a registry prop → now overridable, no warn (this is what stage 1 closes).
  expect(warns.some((w) => w.includes("'r'"))).toBe(false);
  // fill/opacity are honored, transition is consumed by resolveTransitions → no warn.
  expect(
    warns.some(
      (w) =>
        w.includes("transition") ||
        w.includes("'fill'") ||
        w.includes("'opacity'"),
    ),
  ).toBe(false);
  // A genuinely unknown property still warns.
  expect(warns.some((w) => w.includes("Unknown property 'bogus'"))).toBe(true);
});

test("state override: :hover { r } snaps live geometry and reverts on base-reset", () => {
  const c = build("#a { type: circle; r: 10; &:hover { r: 20; } }").children[0];
  expect(c.hoverStyles?.overrides).toEqual({ r: 20 });

  applyStateStyles(c, c.hoverStyles!);
  expect((c.shapeData as CircleData).r).toBe(20);

  // Releasing the state = next frame's base-reset restores the authored radius.
  resetNodeToBase(c);
  expect((c.shapeData as CircleData).r).toBe(10);
});

test("state override: a geometry override marks polystar/outline caches stale", () => {
  const s = build(
    "#s { type: star; sides: 5; outer-radius: 40; inner-radius: 20; &:hover { outer-radius: 60; } }",
  ).children[0];
  s.polystarDirty = false;
  s.outlineLengthDirty = false;

  applyStateStyles(s, s.hoverStyles!);
  expect((s.shapeData as PolystarData).outerRadius).toBe(60);
  expect(s.polystarDirty).toBe(true);
  expect(s.outlineLengthDirty).toBe(true);
});

test("state override: trim-end normalizes a percentage to a 0..1 fraction", () => {
  const p = build(
    '#p { type: path; d: "M0 0 L100 0"; &:hover { trim-end: 50%; } }',
  ).children[0];
  expect(p.hoverStyles?.overrides).toEqual({ "trim-end": 0.5 });

  applyStateStyles(p, p.hoverStyles!);
  expect(p.trimEnd).toBe(0.5);
});

// Reactive transform channels: a var()/input() operand inside translate() must
// NOT bake at build time; it registers a per-frame binding the loop re-extracts.
test("transform: translate(var()) registers a reactive binding, follows input", () => {
  const src = `
    :root {
      --cursor-x: input(cursor.x);
      --dot-x: calc(var(--cursor-x) - 100);
    }
    #dot { type: circle; cx: 0px; cy: 0px; r: 10px;
      transform: translate(var(--dot-x), 5px); }
  `;
  const sheet = parse(src);
  const dot = buildSceneGraph(sheet).children[0];

  // Channel stays at the identity default — not baked to 0 by getNumericValue.
  expect(dot.transform.translateX).toBe(0);
  const binding = dot.bindings.find((b) => b.property === "transform");
  expect(binding).toBeDefined();

  // Drive it exactly as loop.applyBindings does: re-extract with a resolver
  // that reads live cursor input.
  const resolver = createVariableResolver();
  resolver.setVariables(sheet.variables);
  resolver.updateInputState({
    cursor: { x: 300, y: 0, isDown: false },
    scroll: { x: 0, y: 0, progress: 0 },
    time: 0,
  });
  const t = { ...dot.transform };
  extractTransform(
    binding!.value,
    (key, val) => {
      t[key] = val;
    },
    (v) => resolver.resolveNumeric(v),
  );
  expect(t.translateX).toBe(200); // 300 - 100
  expect(t.translateY).toBe(5); // static channel re-applied verbatim
});

// --- per-corner border-radius ------------------------------------------------

test("border-radius: single value stays uniform rx/ry (no cornerRadii)", () => {
  const [n] = build(
    "#b { type: rect; width: 20; height: 20; border-radius: 4; }",
  ).children;
  const sd = n.shapeData as RectData;
  expect(sd.rx).toBe(4);
  expect(sd.ry).toBe(4);
  expect(sd.cornerRadii).toBeUndefined();
});

test("border-radius: 4 values -> per-corner cornerRadii [tl,tr,br,bl]", () => {
  const [n] = build(
    "#b { type: rect; width: 40; height: 40; border-radius: 1 2 3 4; }",
  ).children;
  const sd = n.shapeData as RectData;
  expect(sd.cornerRadii).toEqual([1, 2, 3, 4]);
});

test("a single corner longhand seeds the tuple from uniform rx", () => {
  const [n] = build(
    "#b { type: rect; width: 40; height: 40; rx: 5; border-top-left-radius: 12; }",
  ).children;
  const sd = n.shapeData as RectData;
  expect(sd.cornerRadii).toEqual([12, 5, 5, 5]);
});

test("per-corner radius is animatable via the registry (dirties outline length)", () => {
  const [n] = build(
    "#b { type: rect; width: 40; height: 40; border-top-left-radius: 4; }",
  ).children;
  const handler = getPropHandler("border-top-left-radius")!;
  expect(handler.kind).toBe("number");
  n.outlineLengthDirty = false;
  handler.apply(n, 16);
  expect((n.shapeData as RectData).cornerRadii?.[0]).toBe(16);
  expect(n.outlineLengthDirty).toBe(true);
});

// --- box-shadow --------------------------------------------------------------

test("box-shadow: outer shadow parses to a drop-shadow FilterOp", () => {
  const [n] = build(
    "#b { type: rect; width: 10; height: 10; box-shadow: 4px 6px 8px #ff0000; }",
  ).children;
  expect(n.boxShadow).toEqual([
    {
      type: "drop-shadow",
      dx: 4,
      dy: 6,
      blur: 8,
      spread: 0,
      color: "#ff0000",
      inset: false,
    },
  ]);
});

test("box-shadow: inset + spread + multi (comma-separated)", () => {
  const [n] = build(
    "#b { type: rect; width: 20; height: 20; box-shadow: inset 1px 2px 3px 4px #000, 5px 6px #00f; }",
  ).children;
  expect(n.boxShadow).toEqual([
    {
      type: "drop-shadow",
      dx: 1,
      dy: 2,
      blur: 3,
      spread: 4,
      color: "#000",
      inset: true,
    },
    {
      type: "drop-shadow",
      dx: 5,
      dy: 6,
      blur: 0,
      spread: 0,
      color: "#00f",
      inset: false,
    },
  ]);
});

test("box-shadow: none clears it; animatable via the registry", () => {
  const [n] = build(
    "#b { type: rect; width: 10; height: 10; box-shadow: none; }",
  ).children;
  expect(n.boxShadow).toBeNull();
  expect(getPropHandler("box-shadow")!.kind).toBe("path");
});

// --- text-align / letter-spacing / line-height / multi-line ------------------

test("text-align maps onto the text-anchor semantics", () => {
  const a = (align: string) =>
    (
      build(`#t { type: text; content: "x"; text-align: ${align}; }`)
        .children[0].shapeData as TextData
    ).anchor;
  expect(a("left")).toBe("start");
  expect(a("start")).toBe("start");
  expect(a("center")).toBe("middle");
  expect(a("right")).toBe("end");
  expect(a("end")).toBe("end");
});

test("letter-spacing widens the measured box; animatable + dirties bounds", () => {
  const t = build(
    '#t { type: text; content: "AB"; font-size: 20px; letter-spacing: 4px; }',
  ).children[0];
  expect((t.shapeData as TextData).letterSpacing).toBe(4);
  // Estimate 0.6*20*2 = 24, plus one 4px gap between the two glyphs.
  expect(getShapeBounds(t).width).toBeCloseTo(24 + 4, 5);

  getPropHandler("letter-spacing")!.apply(t, 10);
  expect((t.shapeData as TextData).letterSpacing).toBe(10);
  expect(t.textBoundsDirty).toBe(true);
});

test("line-height: unitless multiplies font-size; px passes through", () => {
  const lh = (v: string) =>
    (
      build(
        `#t { type: text; content: "x"; font-size: 20px; line-height: ${v}; }`,
      ).children[0].shapeData as TextData
    ).lineHeight;
  expect(lh("1.5")).toBe(30); // 1.5 * 20
  expect(lh("28px")).toBe(28);
});

test("multi-line \\n stacks height by line-height", () => {
  const t = build(
    '#t { type: text; content: "a\\nb\\nc"; font-size: 20px; line-height: 30px; }',
  ).children[0];
  // 3 lines: (3-1)*30 + 20 first-line ascent = 80.
  expect(getShapeBounds(t).height).toBe(80);
});

// --- mix-blend-mode ----------------------------------------------------------

test("mix-blend-mode: a known keyword sets the node blend; a typo stays normal", () => {
  const blend = (v: string) =>
    build(`#b { type: rect; width: 10; height: 10; mix-blend-mode: ${v}; }`)
      .children[0].mixBlendMode;
  expect(blend("screen")).toBe("screen");
  expect(blend("color-dodge")).toBe("color-dodge");
  expect(blend("luminosity")).toBe("luminosity");
  expect(blend("nope")).toBe("normal"); // unknown -> ignored, stays normal
});
