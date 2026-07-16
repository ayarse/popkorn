import { expect, test } from "bun:test";
import type { VariableDefinition } from "@popkorn/parser";
import { parse } from "@popkorn/parser";
import { createVariableResolver } from "./variables";

// Extract the value of `cx` from a one-declaration rule — lets these tests
// build calc/min/max/clamp AST via the parser instead of by hand.
const cxValue = (decl: string) =>
  parse(`#s { cx: ${decl}; }`).rules[0].declarations[0].value;

// --- Host-writable variables -------------------------------------------------

test("setVariable overrides an authored variable", () => {
  const r = createVariableResolver();
  r.setVariables([{ name: "--energy", value: { type: "number", value: 0 } }]);

  expect(r.getVariable("--energy")).toBe(0);
  r.setVariable("--energy", 80);
  expect(r.getVariable("--energy")).toBe(80);
  // Resolved as a plain Value too (numeric bindings keep working).
  expect(r.resolveNumeric({ type: "variable", name: "--energy" })).toBe(80);
});

test("setVariable accepts the name with or without the -- prefix", () => {
  const r = createVariableResolver();
  r.setVariables([{ name: "--energy", value: { type: "number", value: 0 } }]);
  r.setVariable("energy", 42);
  expect(r.getVariable("energy")).toBe(42);
  expect(r.getVariable("--energy")).toBe(42);
});

test("getVariable returns undefined for unknown variables", () => {
  const r = createVariableResolver();
  r.setVariables([]);
  expect(r.getVariable("--nope")).toBeUndefined();
});

// --- var() fallback -----------------------------------------------------------

test("resolveVariable uses the defined value when the var is defined, ignoring fallback", () => {
  const r = createVariableResolver();
  r.setVariables([{ name: "--o", value: { type: "number", value: 1 } }]);
  expect(
    r.resolveNumeric({
      type: "variable",
      name: "--o",
      fallback: { type: "number", value: 99 },
    }),
  ).toBe(1);
});

test("resolveVariable uses the fallback when the var is undefined", () => {
  const r = createVariableResolver();
  r.setVariables([]);
  expect(
    r.resolveNumeric({
      type: "variable",
      name: "--missing",
      fallback: { type: "number", value: 0.5 },
    }),
  ).toBe(0.5);
});

test("undefined var without a fallback resolves to 0", () => {
  const r = createVariableResolver();
  r.setVariables([]);
  expect(r.resolveNumeric({ type: "variable", name: "--missing" })).toBe(0);
});

test("fallback can itself be a var() reference", () => {
  const r = createVariableResolver();
  r.setVariables([{ name: "--y", value: { type: "number", value: 7 } }]);
  expect(
    r.resolveNumeric({
      type: "variable",
      name: "--x",
      fallback: { type: "variable", name: "--y" },
    }),
  ).toBe(7);
});

// --- Boolean resolution ------------------------------------------------------

test("boolean variables resolve as booleans", () => {
  const r = createVariableResolver();
  r.setVariables([
    { name: "--pressed", value: { type: "keyword", value: "false" } },
  ]);

  expect(r.getVariable("--pressed")).toBe(false);
  r.setVariable("--pressed", true);
  expect(r.getVariable("--pressed")).toBe(true);
  // Boolean coerces to 1/0 in a numeric binding.
  expect(r.resolveNumeric({ type: "variable", name: "--pressed" })).toBe(1);
});

// --- Triggers ----------------------------------------------------------------

test("trigger fires true for one frame, then endFrame resets it", () => {
  const r = createVariableResolver();
  r.setVariables([
    { name: "--tap", value: { type: "keyword", value: "trigger" } },
  ]);

  // False until fired.
  expect(r.getVariable("--tap")).toBe(false);

  r.fire("--tap");
  expect(r.getVariable("--tap")).toBe(true);
  // Still true within the same frame (multiple reads).
  expect(r.getVariable("--tap")).toBe(true);

  r.endFrame();
  expect(r.getVariable("--tap")).toBe(false);
});

test("fire accepts the name without the -- prefix", () => {
  const r = createVariableResolver();
  r.setVariables([
    { name: "--tap", value: { type: "keyword", value: "trigger" } },
  ]);
  r.fire("tap");
  expect(r.getVariable("--tap")).toBe(true);
});

// --- Input paths -------------------------------------------------------------

test("unknown input path falls back to 0", () => {
  const r = createVariableResolver();
  const defs: VariableDefinition[] = [
    {
      name: "--x",
      value: {
        type: "function",
        name: "input",
        args: [{ type: "keyword", value: "bogus.path" }],
      },
    },
  ];
  r.setVariables(defs);
  expect(r.resolveNumeric({ type: "variable", name: "--x" })).toBe(0);
});

test("scroll.progress input reads the tracked value", () => {
  const r = createVariableResolver();
  r.setVariables([
    {
      name: "--p",
      value: {
        type: "function",
        name: "input",
        args: [{ type: "keyword", value: "scroll.progress" }],
      },
    },
  ]);
  // Default (headless) is 0.
  expect(r.resolveNumeric({ type: "variable", name: "--p" })).toBe(0);

  r.updateInputState({
    cursor: { x: 0, y: 0, isDown: false },
    scroll: { x: 0, y: 250, progress: 0.5 },
    time: 0,
  });
  expect(r.resolveNumeric({ type: "variable", name: "--p" })).toBe(0.5);
});

// --- calc() resolution -------------------------------------------------------

test("calc() resolves var() operands per frame", () => {
  const r = createVariableResolver();
  r.setVariables([{ name: "--i", value: { type: "number", value: 3 } }]);
  // calc(var(--i) * 10px + 5px) => 35px
  const calc = {
    type: "calc" as const,
    expr: {
      type: "calc-binary" as const,
      op: "+" as const,
      left: {
        type: "calc-binary" as const,
        op: "*" as const,
        left: {
          type: "calc-operand" as const,
          value: { type: "variable" as const, name: "--i" },
        },
        right: {
          type: "calc-operand" as const,
          value: { type: "length" as const, value: 10, unit: "px" as const },
        },
      },
      right: {
        type: "calc-operand" as const,
        value: { type: "length" as const, value: 5, unit: "px" as const },
      },
    },
  };
  expect(r.resolveNumeric(calc)).toBe(35);
  // A host override flows through the same calc on the next resolve.
  r.setVariable("--i", 4);
  expect(r.resolveNumeric(calc)).toBe(45);
});

test("calc() re-evaluates input() operands as input state changes", () => {
  const r = createVariableResolver();
  r.setVariables([]);
  // calc(input(cursor.x) / 2)
  const calc = {
    type: "calc" as const,
    expr: {
      type: "calc-binary" as const,
      op: "/" as const,
      left: {
        type: "calc-operand" as const,
        value: {
          type: "function" as const,
          name: "input",
          args: [{ type: "keyword" as const, value: "cursor.x" }],
        },
      },
      right: {
        type: "calc-operand" as const,
        value: { type: "number" as const, value: 2 },
      },
    },
  };
  expect(r.resolveNumeric(calc)).toBe(0);
  r.updateInputState({
    cursor: { x: 200, y: 0, isDown: false },
    scroll: { x: 0, y: 0, progress: 0 },
    time: 0,
  });
  expect(r.resolveNumeric(calc)).toBe(100);
});

test("clamp() re-evaluates over an input-driven value (incl. MIN>MAX edge)", () => {
  const r = createVariableResolver();
  r.setVariables([]);
  const v = cxValue("clamp(20px, input(cursor.x), 80px)");
  const setX = (x: number) =>
    r.updateInputState({
      cursor: { x, y: 0, isDown: false },
      scroll: { x: 0, y: 0, progress: 0 },
      time: 0,
    });
  setX(10);
  expect(r.resolveNumeric(v)).toBe(20); // below MIN → clamped up
  setX(50);
  expect(r.resolveNumeric(v)).toBe(50); // in range
  setX(200);
  expect(r.resolveNumeric(v)).toBe(80); // above MAX → clamped down

  // MIN > MAX: MIN always wins, regardless of the value.
  const inv = cxValue("clamp(80px, input(cursor.x), 20px)");
  setX(50);
  expect(r.resolveNumeric(inv)).toBe(80);
});

test("min()/max() with calc sums resolve reactively", () => {
  const r = createVariableResolver();
  r.setVariables([{ name: "--i", value: { type: "number", value: 3 } }]);
  // min(100px, var(--i) * 10px + 5px) => min(100, 35) => 35
  const v = cxValue("min(100px, var(--i) * 10px + 5px)");
  expect(r.resolveNumeric(v)).toBe(35);
  r.setVariable("--i", 12); // 125 vs 100 → 100
  expect(r.resolveNumeric(v)).toBe(100);
});

test("trig math re-evaluates over an input-driven value per frame", () => {
  const r = createVariableResolver();
  r.setVariables([]);
  // cx: calc(sin(input(time) / 1000) * 100) — a live sine sweep.
  const v = cxValue("calc(sin(input(time) / 1000) * 100)");
  const setTime = (time: number) =>
    r.updateInputState({
      cursor: { x: 0, y: 0, isDown: false },
      scroll: { x: 0, y: 0, progress: 0 },
      time,
    });
  setTime(0);
  expect(r.resolveNumeric(v)).toBeCloseTo(0, 6);
  setTime((Math.PI / 2) * 1000); // sin(π/2) = 1 → 100
  expect(r.resolveNumeric(v)).toBeCloseTo(100, 6);
  setTime(Math.PI * 1000); // sin(π) = 0 → 0
  expect(r.resolveNumeric(v)).toBeCloseTo(0, 6);
});
