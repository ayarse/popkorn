import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import { buildSceneGraph } from "./scene/builder";
import type { CircleData, SceneNode } from "./scene/types";

const build = (src: string) => buildSceneGraph(parse(src));
const ids = (n: SceneNode) => n.children.map((c) => c.id);
const byId = (n: SceneNode, id: string): SceneNode => {
  const found = n.children.find((c) => c.id === id);
  if (!found) throw new Error(`no child #${id} (have ${ids(n).join(", ")})`);
  return found;
};
const cx = (n: SceneNode) => (n.shapeData as CircleData).cx;
const cy = (n: SceneNode) => (n.shapeData as CircleData).cy;

// --- expansion count & order -------------------------------------------------

test("repeat stamps N consecutive siblings in document order", () => {
  const root = build(`
    #a { type: rect; width: 1px; }
    #field { type: circle; r: 5px; repeat: 3; }
    #z { type: rect; width: 1px; }
  `);
  expect(ids(root)).toEqual(["a", "field-1", "field-2", "field-3", "z"]);
  // Every copy carries the declared shape.
  for (const c of root.children.filter((c) => c.id.startsWith("field")))
    expect((c.shapeData as CircleData).r).toBe(5);
});

test("repeat: 1 ≡ absent — no suffix, single node keeps its id", () => {
  const root = build(`#solo { type: circle; r: 2px; repeat: 1; }`);
  expect(ids(root)).toEqual(["solo"]);
});

test("count folds a static calc()", () => {
  const root = build(`#c { type: rect; width: 1px; repeat: calc(2 + 2); }`);
  expect(ids(root)).toEqual(["c-1", "c-2", "c-3", "c-4"]);
});

// --- derived ids incl. descendant re-suffix ----------------------------------

test("descendants re-suffix under the copy id", () => {
  const root = build(`
    #field { type: group; repeat: 2;
      > #arm { type: rect; width: 2px;
        > #tip { type: circle; r: 1px; }
      }
    }
  `);
  const f2 = byId(root, "field-2");
  const arm2 = byId(f2, "arm-2");
  expect(arm2.id).toBe("arm-2");
  expect(byId(arm2, "tip-2").id).toBe("tip-2");
});

// --- sibling-index() / sibling-count() ---------------------------------------

test("sibling-index/count count ALL siblings, resolved per copy", () => {
  const root = build(`
    #row { type: group;
      > #bg { type: rect; width: 10px; }
      > #dot { type: circle; r: 2px; repeat: 3;
               cx: calc(sibling-index() * 10px);
               cy: calc(sibling-count() * 1px); }
    }
  `);
  const row = byId(root, "row");
  // bg is sibling 1; the three dots are siblings 2..4, of a total count 4.
  expect(cx(byId(row, "dot-1"))).toBe(20);
  expect(cx(byId(row, "dot-2"))).toBe(30);
  expect(cx(byId(row, "dot-3"))).toBe(40);
  expect(cy(byId(row, "dot-1"))).toBe(4);
});

test("sibling-index resolves inside an @keyframes bound to each copy", () => {
  const root = build(`
    #dot { type: circle; r: 2px; repeat: 3;
           animation: shift 1s linear; }
    @keyframes shift { to { cx: calc(sibling-index() * 100px); } }
  `);
  const at = (n: SceneNode) =>
    n.animations[0].keyframes.find((k) => k.offset === 1)!.properties.cx;
  expect(at(byId(root, "dot-1"))).toBe(100);
  expect(at(byId(root, "dot-2"))).toBe(200);
  expect(at(byId(root, "dot-3"))).toBe(300);
});

// --- per-copy override precedence --------------------------------------------

test("a later pure-property rule overrides one copy", () => {
  const root = build(`
    #dot { type: circle; r: 2px; fill: #000000; repeat: 3; }
    #dot-2 { fill: #ff0000; }
  `);
  expect(ids(root)).toEqual(["dot-1", "dot-2", "dot-3"]);
  expect(byId(root, "dot-1").fill).toBe("#000000");
  expect(byId(root, "dot-2").fill).toBe("#ff0000");
  expect(byId(root, "dot-3").fill).toBe("#000000");
});

// --- use: + repeat: composition ----------------------------------------------

test("use: composes with repeat: — each copy is a symbol instance", () => {
  const root = build(`
    @define dot { type: circle; r: 4px; fill: #00f;
      > #halo { type: circle; r: 8px; } }
    #field { use: dot; repeat: 3; }
  `);
  expect(ids(root)).toEqual(["field-1", "field-2", "field-3"]);
  const f2 = byId(root, "field-2");
  expect((f2.shapeData as CircleData).r).toBe(4);
  // Symbol child namespaced under the derived instance id, unique per copy.
  expect(f2.children[0].id).toBe("field-2.halo");
});

// --- nested repeat multiplicativity ------------------------------------------

test("nested repeat multiplies", () => {
  const root = build(`
    #outer { type: group; repeat: 2;
      > #inner { type: rect; width: 1px; repeat: 3; } }
  `);
  expect(ids(root)).toEqual(["outer-1", "outer-2"]);
  expect(ids(byId(root, "outer-1"))).toEqual([
    "inner-1-1",
    "inner-1-2",
    "inner-1-3",
  ]);
  expect(ids(byId(root, "outer-2"))).toEqual([
    "inner-2-1",
    "inner-2-2",
    "inner-2-3",
  ]);
});

// --- random(per-element) distinctness ----------------------------------------

test("random(per-element) rolls independently per copy", () => {
  const root = build(`
    #p { type: circle; r: 2px; repeat: 8;
         cx: random(per-element, 0px, 1000px); }
  `);
  const xs = root.children.map((c) => (c.shapeData as CircleData).cx);
  // Not all identical — each copy seeds off its distinct derived id.
  expect(new Set(xs).size).toBeGreaterThan(1);
});

// --- diagnostics -------------------------------------------------------------

test("repeat: 0 is a diagnostic", () => {
  expect(() => build(`#a { type: rect; width: 1px; repeat: 0; }`)).toThrow(
    /repeat/,
  );
});

test("negative repeat is a diagnostic", () => {
  expect(() => build(`#a { type: rect; width: 1px; repeat: -3; }`)).toThrow(
    /repeat/,
  );
});

test("non-integer repeat is a diagnostic", () => {
  expect(() => build(`#a { type: rect; width: 1px; repeat: 2.5; }`)).toThrow(
    /positive integer/,
  );
});

test("reactive repeat is a diagnostic", () => {
  expect(() =>
    build(`#a { type: rect; width: 1px; repeat: input(cursor.x); }`),
  ).toThrow(/reactive|static count/);
});

test("over-cap repeat is a diagnostic", () => {
  expect(() => build(`#a { type: rect; width: 1px; repeat: 10001; }`)).toThrow(
    /cap/,
  );
});

test("repeat inside @define is a diagnostic", () => {
  expect(() =>
    build(`
      @define d { type: circle; r: 2px; repeat: 3; }
      #x { use: d; }
    `),
  ).toThrow(/@define/);
});

test("a derived id colliding with a declared node is a diagnostic", () => {
  expect(() =>
    build(`
      #field { type: circle; r: 2px; repeat: 3; }
      #field-3 { type: rect; width: 9px; }
    `),
  ).toThrow(/collide|duplicate/);
});
