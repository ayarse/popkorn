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

// --- Vectorized (multi-lane) execution ---------------------------------------
//
// A `repeat:` group compiles to N programs of one structure, which run as one
// batched pass (calc-batch.ts). Every assertion below drives the SAME public
// path a scene does — resolveNumeric per node — with batching planned, and pins
// it against the independent interpreter reference.

interface Batched {
  nodes: SceneNode[];
  resolver: ReturnType<typeof createVariableResolver>;
  env: Env;
  batched: number;
  setTime: (ms: number) => void;
}

/** Build a scene, plan its calc batches, and hand back the per-node bindings. */
function batchedScene(src: string): Batched {
  const sheet = parse(src);
  const root = buildSceneGraph(sheet);
  const resolver = createVariableResolver();
  resolver.setVariables(sheet.variables);

  const nodes: SceneNode[] = [];
  (function walk(n: SceneNode) {
    if (n.bindings.length > 0) nodes.push(n);
    for (const c of n.children) walk(c);
  })(root);

  const batched = resolver.planCalcBatches(
    nodes.flatMap((n) => n.bindings.map((b) => b.value)),
  );

  let now = 0;
  const env: Env = {
    vars: new Map(sheet.variables.map((v) => [v.name, v.value])),
    input: (p) => (p === "time" ? now : 0),
  };
  return {
    nodes,
    resolver,
    env,
    batched,
    setTime: (ms) => {
      now = ms;
      resolver.updateInputState({
        cursor: { x: 0, y: 0, isDown: false, pressed: false },
        scroll: { x: 0, y: 0, progress: 0 },
        time: ms,
      });
    },
  };
}

/** Every binding of every node, batched path vs interpreter, at several times. */
function expectLaneParity(s: Batched, times: number[] = [0, 0.37, 3.5]): void {
  for (const t of times) {
    s.setTime(t);
    for (const node of s.nodes) {
      for (const b of node.bindings) {
        const got = s.resolver.resolveNumeric(b.value);
        const want = refNumeric(b.value, s.env);
        expect(Math.abs(got - want)).toBeLessThan(1e-9);
      }
    }
  }
}

test("batched lanes match the scalar interpreter across every math function", () => {
  // Each case is one lane-varying argument (sibling-index()) against the live
  // var(--t), so the batch takes the vector kernel rather than the scalar probe.
  const exprs = [
    "sin(sibling-index() / 3 * var(--t))",
    "cos(sibling-index() / 3 * var(--t))",
    "tan(sibling-index() / 3 * var(--t))",
    "sin(sibling-index() * 1deg * var(--t))",
    "cos(sibling-index() * 1grad * var(--t))",
    "tan(sibling-index() * 1turn * var(--t))",
    "asin(sibling-index() / 100 * var(--t))",
    "acos(sibling-index() / 100 * var(--t))",
    "atan(sibling-index() / 100 * var(--t))",
    "atan2(sibling-index() * var(--t), 3)",
    "sqrt(sibling-index() * var(--t))",
    "exp(sibling-index() / 20 * var(--t))",
    "log(sibling-index() * var(--t) + 1)",
    "log(sibling-index() * var(--t) + 1, 2)",
    "pow(sibling-index() * var(--t), 2)",
    "abs(sibling-index() * var(--t) - 5)",
    "sign(sibling-index() * var(--t) - 5)",
    "min(sibling-index() * var(--t), 4)",
    "max(sibling-index() * var(--t), 4, 2)",
    "clamp(1, sibling-index() * var(--t), 9)",
    "hypot(sibling-index() * var(--t), 3)",
    "hypot(sibling-index() * var(--t), 3, 4)",
    "mod(sibling-index() * var(--t), 5)",
    "rem(sibling-index() * var(--t), 5)",
    "round(sibling-index() * var(--t), 2)",
    "round(up, sibling-index() * var(--t), 2)",
  ];

  for (const expr of exprs) {
    const s = batchedScene(
      `:root { width: 100px; height: 100px; --t: input(time); }
       #f { type: circle; repeat: 16; r: 1px; cx: calc(${expr} * 1px); }`,
    );
    expect(s.batched).toBe(16);
    expectLaneParity(s);
  }
});

test("batched lanes degrade on a unit conflict exactly like the scalar path", () => {
  // Every lane's expression conflicts (px + deg): the whole slot is invalid, so
  // each binding resolves to 0 — the same degradation the interpreter makes.
  const s = batchedScene(
    `:root { width: 100px; height: 100px; --t: input(time); }
     #f { type: circle; repeat: 16; r: 1px;
          cx: calc(sibling-index() * var(--t) * 1px + sibling-index() * 1deg); }`,
  );
  expect(s.batched).toBe(16);
  s.setTime(2);
  for (const node of s.nodes) {
    expect(s.resolver.resolveNumeric(node.bindings[0].value)).toBe(0);
    expect(refNumeric(node.bindings[0].value, s.env)).toBe(0);
  }

  // A length-united batch still carries its unit through to the lane result.
  const px = batchedScene(
    `:root { width: 100px; height: 100px; --t: input(time); }
     #g { type: circle; repeat: 16; r: 1px;
          cx: calc(sibling-index() * 2px + var(--t) * 1px); }`,
  );
  expect(px.batched).toBe(16);
  px.setTime(4);
  px.nodes.forEach((node, i) => {
    expect(px.resolver.resolveNumeric(node.bindings[0].value)).toBeCloseTo(
      (i + 1) * 2 + 4,
      12,
    );
  });
});

test("a per-copy override keeps its copy on the scalar path", () => {
  // `#f-3`'s cx is a structurally different expression, so it can't join the
  // other 15 lanes; it must still resolve correctly (and so must they).
  const s = batchedScene(
    `:root { width: 100px; height: 100px; --t: input(time); }
     #f { type: circle; repeat: 16; r: 1px;
          cx: calc(sin(sibling-index() / 3 + var(--t)) * 10px + 50px); }
     #f-3 { cx: calc(sibling-index() * 2px + var(--t) * 100px); }`,
  );
  // 17 bindings (the overridden copy keeps both cx declarations, last wins):
  // the 16 structural peers batch, the override's program has none and stays
  // on the scalar path.
  const total = s.nodes.reduce((k, n) => k + n.bindings.length, 0);
  expect(total).toBe(17);
  expect(s.batched).toBe(16);
  expectLaneParity(s);

  // The override — scalar — is what the copy ends up with (later wins).
  s.setTime(0.5);
  const copy = s.nodes.find((n) => n.id === "f-3");
  expect(copy).toBeDefined();
  const cx = copy?.bindings.filter((b) => b.property === "cx") ?? [];
  expect(cx.length).toBe(2);
  expect(s.resolver.resolveNumeric(cx[1].value)).toBeCloseTo(3 * 2 + 50, 12);
});

// --- Scene 22: end-to-end parity against the interpreter ---------------------

test("scene 22 compiled cx/cy match the interpreter to ~1e-9 over time", () => {
  const src = readFileSync(
    new URL(
      "../../../../examples/popkorn/17-procedural--particle-field.css",
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

  // A spread of nodes across the repeat copies, each carrying its own
  // sibling-index()-folded cx/cy binding. Count comes from the scene source so
  // the test tracks the example's particle budget.
  const repeatCount = Number(src.match(/repeat: (\d+);/)?.[1]);
  const withBindings: SceneNode[] = [];
  (function walk(n: SceneNode) {
    if (n.bindings.some((b) => b.property === "cx")) withBindings.push(n);
    for (const c of n.children) walk(c);
  })(root);
  expect(withBindings.length).toBe(repeatCount);
  const sample = [0, 1, 2, 137, 2500, repeatCount - 1].map(
    (i) => withBindings[i],
  );

  // Batched: every clone's cx and cy is one lane of two multi-lane programs, so
  // the assertions below run the vectorized executor, not the scalar VM.
  const batched = resolver.planCalcBatches(
    withBindings.flatMap((n) => n.bindings.map((b) => b.value)),
  );
  expect(batched).toBe(repeatCount * 2);

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
