import { expect, test } from "bun:test";
import { parse } from "./parser";
import { serialize } from "./serializer";

// Write-in-only CSS alias sugar: aliases are rewritten to canonical properties
// at parse time; the AST/serializer only ever speak canonical names.

// [property, value] pairs of a rule's declarations, for order-agnostic checks.
const props = (src: string): [string, string][] =>
  parse(src).rules[0].declarations.map((d) => [
    d.property,
    JSON.stringify(d.value),
  ]);

const propNames = (src: string): string[] =>
  parse(src).rules[0].declarations.map((d) => d.property);

// Rejected alias forms now surface as parse diagnostics (not console.warn).
const diags = (src: string): string[] =>
  parse(src).diagnostics.map((d) => d.message);

test("left -> x, top -> y", () => {
  expect(props("#b { left: 10px; top: 20px; }")).toEqual([
    ["x", JSON.stringify({ type: "length", value: 10, unit: "px" })],
    ["y", JSON.stringify({ type: "length", value: 20, unit: "px" })],
  ]);
});

test("color -> fill, background -> fill on shape nodes", () => {
  expect(propNames("#t { color: #fff; }")).toEqual(["fill"]);
  expect(propNames("#s { background: #123456; }")).toEqual(["fill"]);
});

test(":root background keeps its stage-color meaning", () => {
  // background is rewritten to fill, but extractCanvas reads it back as the stage color.
  expect(parse(":root { background: #ff0000; }").canvas?.background).toBe(
    "#ff0000",
  );
});

test("border-radius: <r> -> rx + ry", () => {
  expect(propNames("#b { border-radius: 8px; }")).toEqual(["rx", "ry"]);
  expect(parse("#b { border-radius: 8px; }").rules[0].declarations[0]).toEqual({
    type: "declaration",
    property: "rx",
    value: { type: "length", value: 8, unit: "px" },
  });
});

test("border: <w> solid <color> -> stroke-width + stroke", () => {
  expect(props("#b { border: 2px solid #00ff00; }")).toEqual([
    ["stroke-width", JSON.stringify({ type: "length", value: 2, unit: "px" })],
    ["stroke", JSON.stringify({ type: "color", value: "#00ff00" })],
  ]);
});

test("border: named color -> stroke", () => {
  expect(propNames("#b { border: 3px solid red; }")).toEqual([
    "stroke-width",
    "stroke",
  ]);
});

test("border: none clears the stroke", () => {
  expect(parse("#b { border: none; }").rules[0].declarations).toEqual([
    {
      type: "declaration",
      property: "stroke-width",
      value: { type: "number", value: 0 },
    },
  ]);
});

test("aliases work inside @keyframes (animate via canonical props)", () => {
  const kf = parse(
    "@keyframes grow { from { border-radius: 0px; } to { border-radius: 20px; } }",
  ).keyframes[0];
  expect(kf.blocks[0].declarations.map((d) => d.property)).toEqual([
    "rx",
    "ry",
  ]);
  expect(kf.blocks[1].declarations.map((d) => d.property)).toEqual([
    "rx",
    "ry",
  ]);
});

test("aliases work inside &:hover blocks", () => {
  const state = parse("#b { &:hover { left: 5px; border: 1px solid #fff; } }")
    .rules[0].states[0];
  expect(state.declarations.map((d) => d.property)).toEqual([
    "x",
    "stroke-width",
    "stroke",
  ]);
});

test("aliases work inside @define bodies", () => {
  const def = parse("@define chip { top: 4px; color: #abc; }").definitions[0];
  expect(def.declarations.map((d) => d.property)).toEqual(["y", "fill"]);
});

test("serializer emits canonical names, never alias spellings", () => {
  const out = serialize(
    parse("#b { left: 10px; border-radius: 4px; color: #fff; }"),
  );
  expect(out).toContain("x:");
  expect(out).toContain("rx:");
  expect(out).toContain("ry:");
  expect(out).toContain("fill:");
  expect(out).not.toContain("left");
  expect(out).not.toContain("border-radius");
  expect(out).not.toMatch(/\bcolor:/);
});

test("right/bottom warn and are dropped (no containing box)", () => {
  expect(propNames("#b { right: 10px; bottom: 20px; }")).toEqual([]);
  const warns = diags("#b { right: 10px; bottom: 20px; }");
  expect(warns.length).toBe(2);
  expect(warns[0]).toContain("containing box");
});

test("multi-value border-radius warns, suggests type: path", () => {
  expect(propNames("#b { border-radius: 10px 20px; }")).toEqual([]);
  const warns = diags("#b { border-radius: 10px 20px; }");
  expect(warns.some((w) => w.includes("border-radius"))).toBe(true);
  expect(
    parse("#b { border-radius: 10px 20px; }").diagnostics[0].hint,
  ).toContain("type: path");
});

test("non-solid border style warns", () => {
  expect(propNames("#b { border: 2px dashed #fff; }")).toEqual([]);
  expect(diags("#b { border: 2px dashed #fff; }")[0]).toContain("dashed");
});

test("box-model properties warn: no box model", () => {
  for (const p of ["padding", "margin", "display", "position"]) {
    expect(propNames(`#b { ${p}: 4px; }`)).toEqual([]);
    expect(diags(`#b { ${p}: 4px; }`)[0]).toContain("no box model");
  }
});
