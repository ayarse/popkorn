import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CalcNumeric, Value } from "@popkorn/parser";
import {
  calcConstant,
  evalCalc,
  isCalcValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isNumberValue,
  isVariableRefValue,
  parse,
} from "@popkorn/parser";
import { buildSceneGraph } from "../scene/builder";
import type { SceneNode } from "../scene/types";
import { createVariableResolver } from "./variables";

// Parse a single `cx:` declaration into its Value (a reactive calc()).
const cxValue = (decl: string) =>
  parse(`#s { cx: ${decl}; }`).rules[0].declarations[0].value;

// --- Reference interpreter (mirrors the pre-compilation calcLeaf) ------------
//
// The compiler must be bit-for-bit identical to the tree-walking interpreter it
// replaced. This reference resolves leaves against a plain environment via the
// parser's own `evalCalc`, independent of the compiled path, so the assertions
// below pin parity for good.
interface Env {
  vars: Map<string, Value>;
  input: (path: string) => number;
}

function refLeaf(v: Value, env: Env): CalcNumeric | null {
  if (isCalcValue(v)) return evalCalc(v.expr, (x) => refLeaf(x, env));
  if (isFunctionValue(v) && v.name === "input") {
    const arg = v.args[0];
    const path = arg && isKeywordValue(arg) ? arg.value : null;
    return { value: path ? env.input(path) : 0, unit: "" };
  }
  if (isVariableRefValue(v)) {
    const def = env.vars.get(v.name);
    if (def !== undefined) return refLeaf(def, env);
    return v.fallback ? refLeaf(v.fallback, env) : { value: 0, unit: "" };
  }
  if (isNumberValue(v)) return { value: v.value, unit: "" };
  if (isLengthValue(v)) return { value: v.value, unit: v.unit };
  if (isKeywordValue(v)) {
    if (v.value === "true") return { value: 1, unit: "" };
    if (v.value === "false") return { value: 0, unit: "" };
    return calcConstant(v.value);
  }
  return null;
}

function refNumeric(v: Value, env: Env): number {
  if (!isCalcValue(v)) return 0;
  const n = evalCalc(v.expr, (x) => refLeaf(x, env));
  return n ? n.value : 0;
}

// --- Focused unit / edge coverage --------------------------------------------

test("compiled calc matches the interpreter across units, fallback, constants", () => {
  const cases: { src: string; vars?: [string, string][]; expected: number }[] =
    [
      // px/unitless mix (folds to a length)
      {
        src: "calc(var(--i) * 10px + 5px)",
        vars: [["--i", "3"]],
        expected: 35,
      },
      // nested calc
      {
        src: "calc((var(--a) + 1) * (2 + 3))",
        vars: [["--a", "4"]],
        expected: 25,
      },
      // var() fallback (undefined name → fallback used)
      { src: "calc(var(--missing, 7) + 1)", expected: 8 },
      // keyword true/false coerce to 1/0
      { src: "calc(var(--on) * 100)", vars: [["--on", "true"]], expected: 100 },
      { src: "calc(var(--on) * 100)", vars: [["--on", "false"]], expected: 0 },
      // calc constants pi/e
      { src: "calc(pi * 2)", expected: Math.PI * 2 },
      { src: "calc(1 + e)", expected: 1 + Math.E },
      // an unsupported constant is unresolvable (calcConstant → null) → 0
      { src: "calc(infinity)", expected: 0 },
      // input()
      { src: "calc(input(cursor.x) / 2 + 5)", expected: 55 }, // cursor.x = 100
      // trig on a var-driven value keeps radians
      {
        src: "calc(sin(var(--r)) + cos(0))",
        vars: [["--r", "0"]],
        expected: 1,
      },
      // unit conflict → interpreter returns null → resolveNumeric 0
      {
        src: "calc(var(--px) + var(--deg))",
        vars: [
          ["--px", "10px"],
          ["--deg", "5deg"],
        ],
        expected: 0,
      },
    ];

  const varValue = (raw: string) =>
    parse(`#s { x: ${raw}; }`).rules[0].declarations[0].value;

  for (const c of cases) {
    const value = cxValue(c.src);
    const defs = (c.vars ?? []).map(([name, raw]) => ({
      name,
      value: varValue(raw),
    }));

    const r = createVariableResolver();
    r.setVariables(defs);
    r.updateInputState({
      cursor: { x: 100, y: 0, isDown: false, pressed: false },
      scroll: { x: 0, y: 0, progress: 0 },
      time: 0,
    });

    const env: Env = {
      vars: new Map(defs.map((d) => [d.name, d.value])),
      input: (p) => (p === "cursor.x" ? 100 : 0),
    };

    // Compiled path and the independent interpreter reference must agree, and
    // both must equal the hand-computed expectation.
    expect(r.resolveNumeric(value)).toBeCloseTo(c.expected, 12);
    expect(refNumeric(value, env)).toBeCloseTo(c.expected, 12);
  }
});

// --- Scene 22: end-to-end parity against the interpreter ---------------------

test("scene 22 compiled cx/cy match the interpreter to ~1e-9 over time", () => {
  const src = readFileSync(
    new URL(
      "../../../../examples/popkorn/22-p5-particle-field.css",
      import.meta.url,
    ),
    "utf8",
  );
  const sheet = parse(src);
  const root = buildSceneGraph(sheet);
  const resolver = createVariableResolver();
  resolver.setVariables(sheet.variables);

  const env: Env = {
    vars: new Map(sheet.variables.map((v) => [v.name, v.value])),
    input: (p) => (p === "time" ? envTime : 0),
  };
  let envTime = 0;

  // A spread of nodes across the 5000 copies, each carrying its own
  // sibling-index()-folded cx/cy binding.
  const withBindings: SceneNode[] = [];
  (function walk(n: SceneNode) {
    if (n.bindings.some((b) => b.property === "cx")) withBindings.push(n);
    for (const c of n.children) walk(c);
  })(root);
  expect(withBindings.length).toBe(5000);
  const sample = [0, 1, 2, 137, 2500, 4999].map((i) => withBindings[i]);

  for (const timeMs of [0, 250, 1000, 4321.5]) {
    envTime = timeMs;
    resolver.updateInputState({
      cursor: { x: 0, y: 0, isDown: false, pressed: false },
      scroll: { x: 0, y: 0, progress: 0 },
      time: timeMs,
    });
    for (const node of sample) {
      for (const prop of ["cx", "cy"] as const) {
        const b = node.bindings.find((x) => x.property === prop);
        if (!b) continue;
        const got = resolver.resolveNumeric(b.value);
        const want = refNumeric(b.value, env);
        expect(Number.isFinite(got)).toBe(true);
        expect(Math.abs(got - want)).toBeLessThan(1e-9);
      }
    }
  }
});
