import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import { createVariableResolver } from "../runtime/variables";
import { buildSceneGraph } from "./builder";
import type { CircleData } from "./types";

const build = (src: string) => buildSceneGraph(parse(src));

// A frozen random() lands in the node's base snapshot as a plain literal, so it
// reads straight off shapeData — no per-frame resolution involved.
const radiusOf = (src: string, id: string): number => {
  const root = build(src);
  const collect = (n: {
    id: string;
    shapeData: unknown;
    children: unknown[];
  }): number | null => {
    if (n.id === id) return (n.shapeData as CircleData).r;
    for (const c of n.children) {
      const r = collect(c as never);
      if (r !== null) return r;
    }
    return null;
  };
  const r = collect(root as never);
  if (r === null) throw new Error(`no node #${id}`);
  return r;
};

const radii = (src: string, ids: string[]) =>
  ids.map((id) => radiusOf(src, id));

test("random(): a fixed constant, identical across two builds of the same source", () => {
  const src = "#a { type: circle; r: random(10px, 100px); }";
  expect(radiusOf(src, "a")).toBe(radiusOf(src, "a"));
  // In range.
  const r = radiusOf(src, "a");
  expect(r).toBeGreaterThanOrEqual(10);
  expect(r).toBeLessThanOrEqual(100);
});

test("random(): default sharing — every use: instance gets the SAME roll", () => {
  const src = `
    @define dot { type: circle; r: random(10px, 100px); }
    #a { use: dot; }
    #b { use: dot; }
    #c { use: dot; }
  `;
  const [a, b, c] = radii(src, ["a", "b", "c"]);
  expect(a).toBe(b);
  expect(b).toBe(c);
});

test("random(per-element): each instance rolls independently", () => {
  const src = `
    @define dot { type: circle; r: random(per-element, 10px, 100px); }
    #a { use: dot; }
    #b { use: dot; }
    #c { use: dot; }
  `;
  const vals = radii(src, ["a", "b", "c"]);
  // Not all identical (an independent roll per node id).
  expect(new Set(vals).size).toBeGreaterThan(1);
  for (const v of vals) {
    expect(v).toBeGreaterThanOrEqual(10);
    expect(v).toBeLessThanOrEqual(100);
  }
});

test("random(--ident): shared roll correlates two properties on one element", () => {
  // Same ident + range => same roll, so cx and cy land on the same value.
  const src =
    "#a { type: circle; cx: random(--k, 0px, 500px); cy: random(--k, 0px, 500px); }";
  const a = build(src).children[0].shapeData as CircleData;
  expect(a.cx).toBe(a.cy);
});

test("random(by step): quantized to min + n·step and clamped ≤ max", () => {
  // Roll 200 independent per-element values; every one must sit on the grid.
  const rules = Array.from(
    { length: 200 },
    (_, i) => `#n${i} { use: dot; }`,
  ).join("\n");
  const src = `
    @define dot { type: circle; r: random(per-element, 0px, 100px, by 20px); }
    ${rules}
  `;
  const root = build(src);
  const seen = new Set<number>();
  for (const child of root.children) {
    const r = (child.shapeData as CircleData).r;
    seen.add(r);
    expect(r % 20).toBe(0);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(100);
  }
  // The grid has 6 buckets (0,20,…,100); 200 draws should cover several.
  expect(seen.size).toBeGreaterThan(2);
  for (const v of seen) expect([0, 20, 40, 60, 80, 100]).toContain(v);
});

test("random(): unitless min/max produces a plain number", () => {
  // opacity is a bare number channel; a random(0,1) there must resolve numeric.
  const src = "#a { type: circle; opacity: random(0, 1); }";
  const o = build(src).children[0].opacity;
  expect(o).toBeGreaterThanOrEqual(0);
  expect(o).toBeLessThanOrEqual(1);
});

test("random(): composes inside a static calc() operand", () => {
  const src = "#a { type: circle; r: calc(random(10px, 10px) + 5px); }";
  // A degenerate [10,10] range rolls exactly 10, so calc folds to 15.
  expect(radiusOf(src, "a")).toBe(15);
});

test("random(): frozen inside a reactive calc(), constant across frames", () => {
  // The random operand is baked at build; the var() stays live. Re-resolving the
  // binding twice with different var values must reuse the SAME random constant.
  const src =
    "#a { type: circle; r: calc(random(0px, 0px) + var(--t) + 3px); }";
  const node = build(src).children[0];
  const binding = node.bindings.find((b) => b.property === "r");
  if (!binding) throw new Error("expected a reactive binding for r");
  const resolver = createVariableResolver();
  resolver.setVariable("--t", 10);
  expect(resolver.resolveNumeric(binding.value)).toBe(13);
  resolver.setVariable("--t", 40);
  expect(resolver.resolveNumeric(binding.value)).toBe(43);
});
