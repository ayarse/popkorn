import { expect, test } from "bun:test";
import type { VariableDefinition } from "@popkorn/parser";
import { createVariableResolver } from "./variables";

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
