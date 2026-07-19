import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getNumericValue, isRandomValue } from "./ast";
import { parse } from "./parser";
import { serialize } from "./serializer";

// Strip position metadata (source-offset spans + diagnostics) so structural
// assertions compare the AST *value*. Dedicated span round-trip tests below
// cover the offsets themselves.
function sansPos<T>(node: T): T {
  return JSON.parse(
    JSON.stringify(node, (k, v) =>
      k === "span" ||
      k === "valueSpan" ||
      k === "selectorSpan" ||
      k === "preludeSpan" ||
      k === "diagnostics"
        ? undefined
        : v,
    ),
  );
}

// One assertion per Value / node kind — together these pin down the whole AST contract.

test("id rule: dimension + color", () => {
  expect(sansPos(parse("#box { width: 100px; fill: #ff0000; }"))).toEqual({
    type: "stylesheet",
    keyframes: [],
    definitions: [],
    machines: [],
    variables: [],
    rules: [
      {
        type: "rule",
        selector: { type: "id", name: "box" },
        children: [],
        states: [],
        declarations: [
          {
            type: "declaration",
            property: "width",
            value: { type: "length", value: 100, unit: "px" },
          },
          {
            type: "declaration",
            property: "fill",
            value: { type: "color", value: "#ff0000" },
          },
        ],
      },
    ],
  });
});

test("class selector", () => {
  expect(parse(".circle { r: 50px; }").rules[0].selector).toEqual({
    type: "class",
    name: "circle",
  });
});

test("number / negative / percentage values", () => {
  const decls = parse("#s { opacity: 0.5; y: -10; a: 50%; }").rules[0]
    .declarations;
  expect(decls.map((d) => d.value)).toEqual([
    { type: "number", value: 0.5 },
    { type: "number", value: -10 },
    { type: "length", value: 50, unit: "%" },
  ]);
});

test("leading-dot number (.5 / -.5) parses like 0.5 (minifier output)", () => {
  const decls = parse("#s { opacity: .5; y: -.25; d: .167s; }").rules[0]
    .declarations;
  expect(decls.map((d) => d.value)).toEqual([
    { type: "number", value: 0.5 },
    { type: "number", value: -0.25 },
    { type: "length", value: 0.167, unit: "s" },
  ]);
});

test("stage config hoisted from :root", () => {
  const ast = parse(
    ":root { width: 800px; height: 600px; background: #1a1a2e; }",
  );
  expect(ast.canvas).toEqual({
    width: 800,
    height: 600,
    background: "#1a1a2e",
  });
  expect(ast.rules).toHaveLength(0);
});

test("stage background accepts a named color", () => {
  const ast = parse(":root { width: 800px; height: 600px; background: red; }");
  expect(ast.canvas).toEqual({ width: 800, height: 600, background: "red" });
});

test("stage background accepts rgb()/rgba()", () => {
  expect(
    parse(":root { background: rgb(26, 26, 46); }").canvas?.background,
  ).toBe("rgb(26, 26, 46)");
  expect(
    parse(":root { background: rgba(26, 26, 46, 0.5); }").canvas?.background,
  ).toBe("rgba(26, 26, 46, 0.5)");
});

test("stage overflow hoisted from :root (hidden/visible)", () => {
  expect(
    parse(":root { width: 800px; height: 600px; overflow: visible; }").canvas,
  ).toEqual({ width: 800, height: 600, overflow: "visible" });
  expect(
    parse(":root { width: 800px; height: 600px; overflow: hidden; }").canvas
      ?.overflow,
  ).toBe("hidden");
  // Absent -> undefined (the player defaults it to hidden).
  expect(
    parse(":root { width: 800px; height: 600px; }").canvas?.overflow,
  ).toBeUndefined();
});

test(":root with only custom properties leaves canvas unset", () => {
  const ast = parse(":root { --x: 5; }");
  expect(ast.canvas).toBeUndefined();
  expect(ast.variables).toHaveLength(1);
});

test(":root merges stage config and custom properties", () => {
  const ast = parse(":root { width: 400px; height: 300px; --accent: #f00; }");
  expect(ast.canvas).toEqual({ width: 400, height: 300 });
  expect(ast.variables).toEqual([
    { name: "--accent", value: { type: "color", value: "#f00" } },
  ]);
});

test("root variables + input() member expression", () => {
  expect(parse(":root { --cursor-x: input(cursor.x); }").variables).toEqual([
    {
      name: "--cursor-x",
      value: {
        type: "function",
        name: "input",
        args: [{ type: "keyword", value: "cursor.x" }],
      },
    },
  ]);
});

test("cursor: pointer parses as a keyword declaration", () => {
  const decl = parse("#btn { cursor: pointer; }").rules[0].declarations[0];
  expect(decl.property).toBe("cursor");
  expect(decl.value).toEqual({ type: "keyword", value: "pointer" });
});

test("var() reference", () => {
  expect(
    parse("#f { cx: var(--cursor-x); }").rules[0].declarations[0].value,
  ).toEqual({ type: "variable", name: "--cursor-x" });
});

test("var() with fallback number", () => {
  expect(
    parse("#f { opacity: var(--o, 0.5); }").rules[0].declarations[0].value,
  ).toEqual({
    type: "variable",
    name: "--o",
    fallback: { type: "number", value: 0.5 },
  });
});

test("var() with fallback color", () => {
  expect(
    parse("#f { fill: var(--c, #ff0000); }").rules[0].declarations[0].value,
  ).toEqual({
    type: "variable",
    name: "--c",
    fallback: { type: "color", value: "#ff0000" },
  });
});

test("var() with fallback length", () => {
  expect(
    parse("#s { cx: var(--x, 10px); }").rules[0].declarations[0].value,
  ).toEqual({
    type: "variable",
    name: "--x",
    fallback: { type: "length", value: 10, unit: "px" },
  });
});

test("var() with nested var() fallback", () => {
  expect(
    parse("#s { cx: var(--x, var(--y)); }").rules[0].declarations[0].value,
  ).toEqual({
    type: "variable",
    name: "--x",
    fallback: { type: "variable", name: "--y" },
  });
});

test("var() with trailing comma and no fallback value", () => {
  expect(parse("#s { cx: var(--x,); }").rules[0].declarations[0].value).toEqual(
    { type: "variable", name: "--x", fallback: undefined },
  );
});

test("function call with dimension args", () => {
  expect(
    parse("#s { transform: translate(100px, 200px); }").rules[0].declarations[0]
      .value,
  ).toEqual({
    type: "function",
    name: "translate",
    args: [
      { type: "length", value: 100, unit: "px" },
      { type: "length", value: 200, unit: "px" },
    ],
  });
});

// --- calc() ----------------------------------------------------------------

test("calc() with + builds a left-leaning binary tree", () => {
  expect(
    parse("#s { cx: calc(100px + 20px); }").rules[0].declarations[0].value,
  ).toEqual({
    type: "calc",
    expr: {
      type: "calc-binary",
      op: "+",
      left: {
        type: "calc-operand",
        value: { type: "length", value: 100, unit: "px" },
      },
      right: {
        type: "calc-operand",
        value: { type: "length", value: 20, unit: "px" },
      },
    },
  });
});

test("calc() honors * / over + - precedence", () => {
  const v = parse("#s { cx: calc(2 + 3 * 4); }").rules[0].declarations[0].value;
  expect(v).toEqual({
    type: "calc",
    expr: {
      type: "calc-binary",
      op: "+",
      left: { type: "calc-operand", value: { type: "number", value: 2 } },
      right: {
        type: "calc-binary",
        op: "*",
        left: { type: "calc-operand", value: { type: "number", value: 3 } },
        right: { type: "calc-operand", value: { type: "number", value: 4 } },
      },
    },
  });
});

test("calc() parenthesized group overrides precedence without extra nodes", () => {
  expect(
    parse("#s { cx: calc((2 + 3) * 4); }").rules[0].declarations[0].value,
  ).toEqual({
    type: "calc",
    expr: {
      type: "calc-binary",
      op: "*",
      left: {
        type: "calc-binary",
        op: "+",
        left: { type: "calc-operand", value: { type: "number", value: 2 } },
        right: { type: "calc-operand", value: { type: "number", value: 3 } },
      },
      right: { type: "calc-operand", value: { type: "number", value: 4 } },
    },
  });
});

test("calc() composes with var() and input() operands", () => {
  const v = parse("#s { cx: calc(var(--i) * -0.1s); }").rules[0].declarations[0]
    .value;
  expect(v).toEqual({
    type: "calc",
    expr: {
      type: "calc-binary",
      op: "*",
      left: { type: "calc-operand", value: { type: "variable", name: "--i" } },
      right: {
        type: "calc-operand",
        value: { type: "length", value: -0.1, unit: "s" },
      },
    },
  });
});

test("calc() requires whitespace around +/- (CSS rule): -3px is a signed operand", () => {
  // `10px -3px` (no whitespace after `-`) is NOT a subtraction — the `-3px`
  // reads as a second operand, which is a parse error inside a product.
  // With whitespace both sides it IS a subtraction.
  const sub = parse("#s { cx: calc(10px - 3px); }").rules[0].declarations[0]
    .value;
  expect(sub).toEqual({
    type: "calc",
    expr: {
      type: "calc-binary",
      op: "-",
      left: {
        type: "calc-operand",
        value: { type: "length", value: 10, unit: "px" },
      },
      right: {
        type: "calc-operand",
        value: { type: "length", value: 3, unit: "px" },
      },
    },
  });
});

test("getNumericValue folds a static calc() (precedence + parens)", () => {
  const v = parse("#s { cx: calc((2 + 3) * 4 - 1); }").rules[0].declarations[0]
    .value;
  expect(getNumericValue(v)).toBe(19);
});

test("getNumericValue folds a static calc() carrying a unit", () => {
  const v = parse("#s { cx: calc(100px / 4 + 5px); }").rules[0].declarations[0]
    .value;
  expect(getNumericValue(v)).toBe(30);
});

// --- min()/max()/clamp() ---------------------------------------------------

test("min()/max()/clamp() parse as a calc-typed value wrapping a calc-function", () => {
  const v = parse("#s { cx: min(100px, 20px); }").rules[0].declarations[0]
    .value;
  expect(v).toEqual({
    type: "calc",
    expr: {
      type: "calc-function",
      name: "min",
      args: [
        {
          type: "calc-operand",
          value: { type: "length", value: 100, unit: "px" },
        },
        {
          type: "calc-operand",
          value: { type: "length", value: 20, unit: "px" },
        },
      ],
    },
  });
});

test("min() arguments are full calc sums", () => {
  const v = parse("#s { cx: min(100px, 20px + 5px); }").rules[0].declarations[0]
    .value;
  expect(getNumericValue(v)).toBe(25);
});

test("calc composes inside min() and min() composes inside calc", () => {
  expect(
    getNumericValue(
      parse("#s { cx: calc(min(10px, 4px) * 2); }").rules[0].declarations[0]
        .value,
    ),
  ).toBe(8);
});

test("getNumericValue folds min/max/clamp", () => {
  const at = (src: string) =>
    getNumericValue(parse(`#s { cx: ${src}; }`).rules[0].declarations[0].value);
  expect(at("min(3, 7, 5)")).toBe(3);
  expect(at("max(3, 7, 5)")).toBe(7);
  expect(at("clamp(10px, 4px, 20px)")).toBe(10);
  expect(at("clamp(10px, 40px, 20px)")).toBe(20);
  // MIN > MAX: MIN wins.
  expect(at("clamp(30px, 5px, 20px)")).toBe(30);
});

test("clamp() requires exactly 3 args; min/max reject empties", () => {
  expect(() => parse("#s { cx: clamp(1px, 2px); }")).toThrow(/clamp/);
  expect(() => parse("#s { cx: clamp(1px, 2px, 3px, 4px); }")).toThrow(/clamp/);
  expect(() => parse("#s { cx: min(); }")).toThrow();
});

// --- CSS math functions (css-values-4) -------------------------------------

// Fold a static math expression to its numeric value.
const foldCalc = (src: string) =>
  getNumericValue(parse(`#s { cx: ${src}; }`).rules[0].declarations[0].value);

test("math functions parse as calc-typed values (top-level and nested)", () => {
  expect(parse("#s { cx: sqrt(9); }").rules[0].declarations[0].value).toEqual({
    type: "calc",
    expr: {
      type: "calc-function",
      name: "sqrt",
      args: [{ type: "calc-operand", value: { type: "number", value: 9 } }],
    },
  });
  // Composes both directions across calc/min.
  expect(foldCalc("calc(sqrt(16) * 2)")).toBe(8);
  expect(foldCalc("min(sqrt(16), pow(2, 3))")).toBe(4);
});

test("e and pi constants fold in calc", () => {
  expect(foldCalc("calc(pi)")).toBeCloseTo(Math.PI, 10);
  expect(foldCalc("calc(e * 2)")).toBeCloseTo(Math.E * 2, 10);
});

test("trig: bare numbers are radians, angle units convert", () => {
  expect(foldCalc("sin(0)")).toBeCloseTo(0, 10);
  expect(foldCalc("cos(0)")).toBeCloseTo(1, 10);
  expect(foldCalc("sin(90deg)")).toBeCloseTo(1, 10);
  expect(foldCalc("cos(pi)")).toBeCloseTo(-1, 10);
  expect(foldCalc("sin(0.5turn)")).toBeCloseTo(0, 10);
  expect(foldCalc("tan(45deg)")).toBeCloseTo(1, 10);
});

test("inverse trig returns degrees", () => {
  expect(foldCalc("asin(1)")).toBeCloseTo(90, 10);
  expect(foldCalc("acos(0)")).toBeCloseTo(90, 10);
  expect(foldCalc("atan(1)")).toBeCloseTo(45, 10);
});

test("atan2 resolves the correct quadrant (degrees)", () => {
  expect(foldCalc("atan2(1, 1)")).toBeCloseTo(45, 10);
  expect(foldCalc("atan2(1, -1)")).toBeCloseTo(135, 10);
  expect(foldCalc("atan2(-1, -1)")).toBeCloseTo(-135, 10);
  expect(foldCalc("atan2(-1, 1)")).toBeCloseTo(-45, 10);
});

test("exponential family: pow/sqrt/hypot/log/exp", () => {
  expect(foldCalc("pow(2, 10)")).toBe(1024);
  expect(foldCalc("hypot(3, 4)")).toBe(5);
  expect(foldCalc("hypot(3px, 4px)")).toBe(5); // same-unit hypotenuse
  expect(foldCalc("exp(0)")).toBe(1);
  expect(foldCalc("log(e)")).toBeCloseTo(1, 10); // natural log by default
  expect(foldCalc("log(8, 2)")).toBeCloseTo(3, 10); // explicit base
});

test("abs preserves unit, sign is unitless", () => {
  expect(foldCalc("abs(-5px)")).toBe(5);
  expect(foldCalc("sign(-42)")).toBe(-1);
  expect(foldCalc("sign(42)")).toBe(1);
  expect(foldCalc("sign(0)")).toBe(0);
});

test("mod follows the divisor sign, rem follows the dividend sign (CSS)", () => {
  // mod(): sign of the divisor.
  expect(foldCalc("mod(-3, 2)")).toBe(1);
  expect(foldCalc("mod(3, -2)")).toBe(-1);
  // rem(): sign of the dividend.
  expect(foldCalc("rem(-3, 2)")).toBe(-1);
  expect(foldCalc("rem(3, -2)")).toBe(1);
});

test("round strategies: nearest (default), up, down, to-zero", () => {
  expect(foldCalc("round(2.4, 1)")).toBe(2);
  expect(foldCalc("round(2.6, 1)")).toBe(3);
  expect(foldCalc("round(nearest, 2.5, 1)")).toBe(3); // ties toward +∞
  expect(foldCalc("round(up, 2.1, 1)")).toBe(3);
  expect(foldCalc("round(down, 2.9, 1)")).toBe(2);
  expect(foldCalc("round(to-zero, -2.9, 1)")).toBe(-2);
  expect(foldCalc("round(2.7, 0.5)")).toBe(2.5); // arbitrary step
});

test("round() step defaults to 1 when omitted (CSS)", () => {
  expect(foldCalc("round(2.4)")).toBe(2);
  expect(foldCalc("round(2.6)")).toBe(3);
  expect(foldCalc("round(up, 2.1)")).toBe(3);
});

test("round/mod/rem compose both directions inside calc()", () => {
  expect(foldCalc("calc(round(2.4, 1) * 2)")).toBe(4);
  expect(foldCalc("calc(mod(-3, 2) + 10)")).toBe(11);
  expect(foldCalc("min(round(7.5, 1), rem(-3, 2))")).toBe(-1);
  expect(foldCalc("calc(abs(sign(-9) * 5))")).toBe(5);
});

test("round/mod/rem/abs/sign resolve a reactive var() operand", () => {
  const v = parse("#s { cx: round(var(--x), 1); }").rules[0].declarations[0]
    .value;
  expect(v).toEqual({
    type: "calc",
    expr: {
      type: "calc-function",
      name: "round",
      args: [
        { type: "calc-operand", value: { type: "variable", name: "--x" } },
        { type: "calc-operand", value: { type: "number", value: 1 } },
      ],
    },
  });
  // Static fold can't resolve the var(), so it falls back to 0 — the calc()
  // itself stays unfolded for per-frame resolution against the runtime var.
  expect(foldCalc("round(var(--x), 1)")).toBe(0);
});

test("math functions enforce arg counts", () => {
  expect(() => parse("#s { cx: sin(1, 2); }")).toThrow(/sin/);
  expect(() => parse("#s { cx: pow(2); }")).toThrow(/pow/);
  expect(() => parse("#s { cx: atan2(1); }")).toThrow(/atan2/);
  expect(() => parse("#s { cx: round(); }")).toThrow(/round/);
  expect(() => parse("#s { cx: round(1, 2, 3); }")).toThrow(/round/);
  expect(() => parse("#s { cx: log(1, 2, 3); }")).toThrow(/log/);
});

test("sibling-index()/sibling-count() parse as zero-arg calc functions", () => {
  expect(
    parse("#s { cx: sibling-index(); }").rules[0].declarations[0].value,
  ).toEqual({
    type: "calc",
    expr: { type: "calc-function", name: "sibling-index", args: [] },
  });
  // Compose inside calc like any math function.
  expect(
    parse("#s { cx: calc(sibling-count() * 10px); }").rules[0].declarations[0]
      .value.type,
  ).toBe("calc");
  // Zero-arg: passing an argument is an arity error.
  expect(() => parse("#s { cx: sibling-index(1); }")).toThrow(/sibling-index/);
});

test("sibling-index()/sibling-count() round-trip through the serializer", () => {
  const rt = (src: string) =>
    serialize(parse(`#s { cx: ${src}; }`)).match(/cx: ([^;]+);/)![1];
  expect(rt("sibling-index()")).toBe("sibling-index()");
  // Every binary node is parenthesized by the serializer (precedence-exact).
  expect(rt("calc(sibling-index() / sibling-count())")).toBe(
    "calc((sibling-index() / sibling-count()))",
  );
});

test("round() strategy round-trips through the serializer", () => {
  const rt = (src: string) =>
    serialize(parse(`#s { cx: ${src}; }`)).match(/cx: ([^;]+);/)![1];
  expect(rt("round(up, 2.5px, 1px)")).toBe("round(up, 2.5px, 1px)");
  // "nearest" is the default and elides.
  expect(rt("round(nearest, 2.5px, 1px)")).toBe("round(2.5px, 1px)");
  expect(rt("sin(90deg)")).toBe("sin(90deg)");
});

test("animation shorthand → list", () => {
  expect(
    parse("#box { animation: pulse 1.5s ease-in-out infinite; }").rules[0]
      .declarations[0].value,
  ).toEqual({
    type: "list",
    values: [
      { type: "keyword", value: "pulse" },
      { type: "length", value: 1.5, unit: "s" },
      { type: "keyword", value: "ease-in-out" },
      { type: "keyword", value: "infinite" },
    ],
  });
});

test("comma-separated animation shorthand → comma list of space lists", () => {
  expect(
    parse("#box { animation: slide 1s linear 1, spin 2s ease-in-out 1 0.5s; }")
      .rules[0].declarations[0].value,
  ).toEqual({
    type: "list",
    separator: "comma",
    values: [
      {
        type: "list",
        values: [
          { type: "keyword", value: "slide" },
          { type: "length", value: 1, unit: "s" },
          { type: "keyword", value: "linear" },
          { type: "number", value: 1 },
        ],
      },
      {
        type: "list",
        values: [
          { type: "keyword", value: "spin" },
          { type: "length", value: 2, unit: "s" },
          { type: "keyword", value: "ease-in-out" },
          { type: "number", value: 1 },
          { type: "length", value: 0.5, unit: "s" },
        ],
      },
    ],
  });
});

test("stroke-dasharray → list of lengths", () => {
  expect(
    parse("#p { stroke-dasharray: 5px 3px 2px; }").rules[0].declarations[0]
      .value,
  ).toEqual({
    type: "list",
    values: [
      { type: "length", value: 5, unit: "px" },
      { type: "length", value: 3, unit: "px" },
      { type: "length", value: 2, unit: "px" },
    ],
  });
});

test("keyframes from/to", () => {
  const kf = parse(
    "@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }",
  ).keyframes[0];
  expect(kf.name).toBe("spin");
  expect(kf.blocks.map((b) => b.selectors)).toEqual([[0], [100]]);
});

test("keyframes multi-selector 0%, 100%", () => {
  const kf = parse(
    "@keyframes pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.3) } }",
  ).keyframes[0];
  expect(kf.blocks.map((b) => b.selectors)).toEqual([[0, 100], [50]]);
});

test("per-keyframe easing hoisted off declarations", () => {
  const block = parse(
    "@keyframes k { 0% { opacity: 0; animation-timing-function: ease-in; } }",
  ).keyframes[0].blocks[0];
  expect(block.easing).toEqual({ type: "keyword", value: "ease-in" });
  expect(block.declarations.map((d) => d.property)).toEqual(["opacity"]);
});

test("per-keyframe easing keeps steps()/linear() verbatim", () => {
  const s = parse(
    "@keyframes k { 0% { opacity: 0; animation-timing-function: steps(3, jump-end); } 50% { opacity: 1; animation-timing-function: linear(0, 0.5 50%, 1); } }",
  ).keyframes[0];
  expect(s.blocks[0].easing).toEqual({
    type: "function",
    name: "steps",
    args: [
      { type: "number", value: 3 },
      { type: "keyword", value: "jump-end" },
    ],
  });
  const lin = s.blocks[1].easing;
  expect(lin && lin.type === "function" && lin.name).toBe("linear");
});

test("nested child rule", () => {
  const child = parse("#p { type: group; > #c { type: circle; r: 20px; } }")
    .rules[0].children[0];
  expect(child.selector).toEqual({ type: "id", name: "c" });
  expect(child.declarations).toHaveLength(2);
});

test("pseudo hover + active with transform", () => {
  const states = parse(
    "#b { fill: #3498db; &:hover { fill: #2980b9; transform: scale(1.05); } &:active { fill: #1a5276; } }",
  ).rules[0].states;
  expect(states.map((s) => s.state)).toEqual(["hover", "active"]);
  expect(states[0].declarations).toHaveLength(2);
});

test("state block with child rule (&:hover > #c)", () => {
  const state = parse(
    "#card { fill: #111; &:hover { fill: #2a2a4a; > #icon { transform: rotate(15deg); } } }",
  ).rules[0].states[0];
  expect(state.state).toBe("hover");
  expect(state.declarations.map((d) => d.property)).toEqual(["fill"]);
  expect(state.children).toHaveLength(1);
  expect(state.children[0].selector).toEqual({ type: "id", name: "icon" });
  expect(state.children[0].declarations[0].property).toBe("transform");
});

test("@define: declarations + nested child + state", () => {
  const ast = parse(`@define spark {
    type: circle; r: 5px; fill: #fbbf24;
    &:hover { fill: #f00; }
    > #tail { type: rect; width: 2px; }
  }`);
  expect(ast.rules).toHaveLength(0);
  expect(ast.definitions).toHaveLength(1);
  const def = ast.definitions[0];
  expect(def.type).toBe("definition");
  expect(def.name).toBe("spark");
  expect(def.declarations.map((d) => d.property)).toEqual([
    "type",
    "r",
    "fill",
  ]);
  expect(def.states.map((s) => s.state)).toEqual(["hover"]);
  expect(def.children[0].selector).toEqual({ type: "id", name: "tail" });
});

test("@define: multiple definitions collected in order", () => {
  const ast = parse("@define a { r: 1px; } @define b { r: 2px; }");
  expect(ast.definitions.map((d) => d.name)).toEqual(["a", "b"]);
});

test("use: is a normal keyword declaration", () => {
  const decl = parse("#spark1 { use: spark; cx: 100px; }").rules[0]
    .declarations[0];
  expect(sansPos(decl)).toEqual({
    type: "declaration",
    property: "use",
    value: { type: "keyword", value: "spark" },
  });
});

test("hex value is a color; non-hex #ident is a node-id keyword (mask reference)", () => {
  const decls = parse("#n { fill: #abc; mask: #myLayer alpha; }").rules[0]
    .declarations;
  expect(decls[0].value).toEqual({ type: "color", value: "#abc" });
  // `mask: #myLayer alpha` -> list of a #-prefixed id keyword + a mode keyword.
  expect(decls[1].value).toEqual({
    type: "list",
    values: [
      { type: "keyword", value: "#myLayer" },
      { type: "keyword", value: "alpha" },
    ],
  });
});

test("#ident starting with hex-like chars is a node-id keyword, not a truncated color", () => {
  // `#Background…` must not lex as the hex color `#Bac` (B,a,c are hex) with the
  // rest dangling — it is a full node-id mask reference.
  const decls = parse("#n { mask: #Background-Big-Wave alpha; }").rules[0]
    .declarations;
  expect(decls[0].value).toEqual({
    type: "list",
    values: [
      { type: "keyword", value: "#Background-Big-Wave" },
      { type: "keyword", value: "alpha" },
    ],
  });
  // A genuine hex color still parses as a color.
  expect(parse("#n { fill: #abc; }").rules[0].declarations[0].value).toEqual({
    type: "color",
    value: "#abc",
  });
});

test("comment ignored", () => {
  const ast = parse("/* hi */ #box { fill: #fff; }");
  expect(ast.rules).toHaveLength(1);
  expect(ast.rules[0].declarations[0].value).toEqual({
    type: "color",
    value: "#fff",
  });
});

test("string value (path d)", () => {
  expect(
    parse('#p { type: path; d: "M 10 10 L 50 50 Z"; }').rules[0].declarations[1]
      .value,
  ).toEqual({ type: "string", value: "M 10 10 L 50 50 Z" });
});

// --- @machine state machines ---------------------------------------------

test("@machine: full cat example — structure, initial, states, any-state", () => {
  const ast = parse(`@machine cat {
    initial: idle;
    state idle {
      to: excited on click(#hitbox);
      to: hyper when style(--energy > 80) mix 300ms ease-in-out;
    }
    state excited { to: idle on complete; }
    state hyper {
      to: idle when style(--energy <= 80) mix 300ms;
      emit: overheat;
    }
    state * { to: idle on event(reset); }
  }`);
  expect(ast.rules).toHaveLength(0);
  expect(ast.machines).toHaveLength(1);
  const m = ast.machines[0];
  expect(m.type).toBe("machine");
  expect(m.name).toBe("cat");
  expect(m.initial).toBe("idle");
  expect(m.states.map((s) => s.name)).toEqual([
    "idle",
    "excited",
    "hyper",
    "*",
  ]);
  // Declaration order == transition priority order.
  expect(m.states[0].transitions.map((t) => t.to)).toEqual([
    "excited",
    "hyper",
  ]);
  expect(m.states[2].emits).toEqual(["overheat"]);
});

test("@machine: pointer trigger on #id", () => {
  const t = parse(
    "@machine m { initial: a; state a { to: b on click(#hitbox); } }",
  ).machines[0].states[0].transitions[0];
  expect(t).toEqual({
    to: "b",
    trigger: {
      kind: "pointer",
      event: "click",
      target: { type: "id", name: "hitbox" },
    },
    guards: [],
    mix: null,
  });
});

test("@machine: pointer trigger on :root (tap anywhere)", () => {
  const t = parse(
    "@machine m { initial: a; state a { to: b on pointerdown(:root); } }",
  ).machines[0].states[0].transitions[0];
  expect(t.trigger).toEqual({
    kind: "pointer",
    event: "pointerdown",
    target: { type: "root", name: "root" },
  });
});

test("@machine: all pointer event kinds parse", () => {
  const events = [
    "click",
    "pointerdown",
    "pointerup",
    "hoverstart",
    "hoverend",
  ];
  for (const ev of events) {
    const t = parse(
      `@machine m { initial: a; state a { to: b on ${ev}(#x); } }`,
    ).machines[0].states[0].transitions[0];
    expect(t.trigger).toEqual({
      kind: "pointer",
      event: ev,
      target: { type: "id", name: "x" },
    });
  }
});

test("@machine: complete and event(name) triggers", () => {
  const done = parse(
    "@machine m { initial: a; state a { to: b on complete; } }",
  ).machines[0].states[0].transitions[0];
  expect(done.trigger).toEqual({ kind: "complete" });
  const ev = parse(
    "@machine m { initial: a; state a { to: b on event(reset); } }",
  ).machines[0].states[0].transitions[0];
  expect(ev.trigger).toEqual({ kind: "event", name: "reset" });
});

test("@machine: numeric guard on --var", () => {
  const t = parse(
    "@machine m { initial: a; state a { to: b when style(--energy > 80); } }",
  ).machines[0].states[0].transitions[0];
  expect(t.guards).toEqual([
    { left: { kind: "var", name: "--energy" }, op: ">", right: 80 },
  ]);
});

test("@machine: colon guard reads as equality; keyword right side", () => {
  const t = parse(
    "@machine m { initial: a; state a { to: b when style(--mood: happy); } }",
  ).machines[0].states[0].transitions[0];
  expect(t.guards).toEqual([
    { left: { kind: "var", name: "--mood" }, op: "=", right: "happy" },
  ]);
});

test("@machine: input() path guard", () => {
  const t = parse(
    "@machine m { initial: a; state a { to: b when style(input(cursor.x) < 400); } }",
  ).machines[0].states[0].transitions[0];
  expect(t.guards).toEqual([
    { left: { kind: "input", path: "cursor.x" }, op: "<", right: 400 },
  ]);
});

test("@machine: state-time guard normalizes time to ms (2s -> 2000, 500ms -> 500)", () => {
  const s = parse(
    "@machine m { initial: a; state a { to: b when style(state-time > 2s); } }",
  ).machines[0].states[0].transitions[0];
  expect(s.guards).toEqual([
    { left: { kind: "state-time" }, op: ">", right: 2000 },
  ]);
  const ms = parse(
    "@machine m { initial: a; state a { to: b when style(state-time > 500ms); } }",
  ).machines[0].states[0].transitions[0];
  expect(ms.guards[0].right).toBe(500);
});

test("@machine: all comparison operators", () => {
  const cases: Array<[string, string]> = [
    ["=", "="],
    ["!=", "!="],
    ["<", "<"],
    ["<=", "<="],
    [">", ">"],
    [">=", ">="],
  ];
  for (const [src, op] of cases) {
    const t = parse(
      `@machine m { initial: a; state a { to: b when style(--e ${src} 5); } }`,
    ).machines[0].states[0].transitions[0];
    expect(t.guards[0].op).toBe(op);
  }
});

test("@machine: boolean guard right side", () => {
  const t = parse(
    "@machine m { initial: a; state a { to: b when style(--pressed = true); } }",
  ).machines[0].states[0].transitions[0];
  expect(t.guards[0].right).toBe(true);
});

test("@machine: on + when combined, and chained guards preserve order", () => {
  const t = parse(`@machine m { initial: a; state a {
    to: b on click(#x) when style(--energy > 80) and style(input(cursor.x) < 400);
  } }`).machines[0].states[0].transitions[0];
  expect(t.trigger).toEqual({
    kind: "pointer",
    event: "click",
    target: { type: "id", name: "x" },
  });
  expect(t.guards).toEqual([
    { left: { kind: "var", name: "--energy" }, op: ">", right: 80 },
    { left: { kind: "input", path: "cursor.x" }, op: "<", right: 400 },
  ]);
});

test("@machine: mix with easing and without", () => {
  const withEasing = parse(
    "@machine m { initial: a; state a { to: b when style(--e > 1) mix 300ms ease-in-out; } }",
  ).machines[0].states[0].transitions[0];
  expect(withEasing.mix).toEqual({ duration: 300, easing: "ease-in-out" });
  const bare = parse(
    "@machine m { initial: a; state a { to: b when style(--e > 1) mix 300ms; } }",
  ).machines[0].states[0].transitions[0];
  expect(bare.mix).toEqual({ duration: 300, easing: null });
  const secs = parse("@machine m { initial: a; state a { to: b mix 2s; } }")
    .machines[0].states[0].transitions[0];
  expect(secs.mix).toEqual({ duration: 2000, easing: null });
});

test("@machine: bare unconditional transition (no trigger/guards/mix)", () => {
  const t = parse("@machine m { initial: a; state a { to: b; } }").machines[0]
    .states[0].transitions[0];
  expect(t).toEqual({ to: "b", trigger: null, guards: [], mix: null });
});

test("@machine: multiple machines collected in order, run concurrently", () => {
  const ast = parse(
    "@machine blink { initial: on; state on { to: off; } } @machine btn { initial: up; state up { } }",
  );
  expect(ast.machines.map((m) => m.name)).toEqual(["blink", "btn"]);
});

test("@machine: minified (whitespace-stripped) parses identically", () => {
  const src = `@machine cat {
    initial: idle;
    state idle { to: excited on click(#hitbox); to: hyper when style(--energy > 80) mix 300ms ease-in-out; }
    state * { to: idle on event(reset); }
  }`;
  // Compare the AST value only — diagnostics carry source offsets, which differ
  // between the spaced and whitespace-stripped forms (e.g. the #hitbox ref).
  const sansDiag = (s: string) => ({ ...parse(s), diagnostics: [] });
  expect(sansDiag(stripWs(src))).toEqual(sansDiag(src));
});

// --- :state() pseudo blocks ----------------------------------------------

test(":state(name) block — un-namespaced", () => {
  const st = parse("#cat { fill: #111; &:state(idle) { fill: #f44; } }")
    .rules[0].states[0];
  expect(st.state).toBe("state");
  expect(st.machineState).toEqual({ machine: null, name: "idle" });
  expect(st.declarations.map((d) => d.property)).toEqual(["fill"]);
});

test(":state(machine.name) namespaced block with nested > child", () => {
  const st = parse(
    "#cat { &:state(cat.excited) { fill: #f44; > #eye { r: 3px; } } }",
  ).rules[0].states[0];
  expect(st.machineState).toEqual({ machine: "cat", name: "excited" });
  expect(st.children).toHaveLength(1);
  expect(st.children[0].selector).toEqual({ type: "id", name: "eye" });
  expect(st.children[0].declarations[0].property).toBe("r");
});

test(":state() coexists with &:hover; hover unchanged and still present", () => {
  const states = parse(
    "#c { &:hover { fill: #0f0; } &:state(idle) { fill: #00f; } }",
  ).rules[0].states;
  expect(states.map((s) => s.state)).toEqual(["hover", "state"]);
  expect(states[0].machineState).toBeUndefined();
  expect(states[1].machineState).toEqual({ machine: null, name: "idle" });
});

test("--tap: trigger; is a normal keyword variable declaration", () => {
  const ast = parse(":root { --tap: trigger; --energy: 0; --pressed: false; }");
  expect(ast.variables).toEqual([
    { name: "--tap", value: { type: "keyword", value: "trigger" } },
    { name: "--energy", value: { type: "number", value: 0 } },
    { name: "--pressed", value: { type: "keyword", value: "false" } },
  ]);
});

// The real example scenes must parse end-to-end (recursing into subdirs like
// examples/lottie/ so converter output is exercised too).
const examplesDir = fileURLToPath(
  new URL("../../../examples", import.meta.url),
);
function collectCss(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory())
      out.push(
        ...collectCss(`${dir}/${entry.name}`, `${prefix}${entry.name}/`),
      );
    else if (entry.name.endsWith(".css")) out.push(`${prefix}${entry.name}`);
  }
  return out;
}
for (const file of collectCss(examplesDir)) {
  test(`example scene: ${file}`, () => {
    expect(parse(readFileSync(`${examplesDir}/${file}`, "utf8")).type).toBe(
      "stylesheet",
    );
  });
}

// Parser robustness on minified input: strip every *optional* whitespace and
// assert the AST is unchanged. `stripWs` mirrors a conservative minifier —
// remove whitespace adjacent to `{ } ; : , > ( )`, collapse the rest to a
// single space (the space that separates list values is syntactically
// required, so it must survive) — while leaving string literals untouched.
// Whitespace bracketing a calc() `+`/`-` is also required by CSS (it is what
// distinguishes subtraction from a signed operand), so `sin(1) + 2` must not
// collapse to `sin(1)+2` even though `)` is punctuation.
const PUNCT = "{};:,>()";
const ADDITIVE = "+-";
function stripWs(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "*") {
      // comment
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      // string literal — copy verbatim
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j++;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      out += " ";
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  let res = "";
  for (let i = 0; i < out.length; ) {
    const ch = out[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < out.length && out[j] !== ch) j++;
      res += out.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === " ") {
      const prev = res[res.length - 1];
      const next = out[i + 1];
      if (
        prev === undefined ||
        next === undefined ||
        ((PUNCT.includes(prev) || PUNCT.includes(next)) &&
          !ADDITIVE.includes(prev) &&
          !ADDITIVE.includes(next))
      ) {
        i++;
        continue;
      }
      res += " ";
      i++;
      continue;
    }
    res += ch;
    i++;
  }
  return res.trim();
}

for (const file of collectCss(examplesDir)) {
  test(`minified (whitespace-stripped) parses identically: ${file}`, () => {
    const src = readFileSync(`${examplesDir}/${file}`, "utf8");
    expect(sansPos(parse(stripWs(src)))).toEqual(sansPos(parse(src)));
  });
}

// --- source spans -------------------------------------------------------------
// Every span must round-trip: source.slice(start, end) is the exact text.

test("declaration span/valueSpan: longhand", () => {
  const src = "#d { animation-delay: 250ms; }";
  const d = parse(src).rules[0].declarations[0];
  expect(src.slice(d.span.start, d.span.end)).toBe("animation-delay: 250ms");
  expect(src.slice(d.valueSpan.start, d.valueSpan.end)).toBe("250ms");
});

test("declaration span/valueSpan: animation shorthand (comma-list value)", () => {
  const src = "#d { animation: spin 2s linear infinite, fade 1s ease; }";
  const d = parse(src).rules[0].declarations[0];
  expect(src.slice(d.span.start, d.span.end)).toBe(
    "animation: spin 2s linear infinite, fade 1s ease",
  );
  expect(src.slice(d.valueSpan.start, d.valueSpan.end)).toBe(
    "spin 2s linear infinite, fade 1s ease",
  );
});

test("declaration span excludes a trailing `;` and surrounding whitespace", () => {
  const src = "#d {\n  opacity: 0.5 ;\n}";
  const d = parse(src).rules[0].declarations[0];
  expect(src.slice(d.span.start, d.span.end)).toBe("opacity: 0.5");
  expect(src.slice(d.valueSpan.start, d.valueSpan.end)).toBe("0.5");
});

test("rule span/preludeSpan round-trip (incl. braces)", () => {
  const src = "#box { width: 100px; fill: #f00; }";
  const rule = parse(src).rules[0];
  expect(src.slice(rule.preludeSpan.start, rule.preludeSpan.end)).toBe("#box");
  expect(src.slice(rule.span.start, rule.span.end)).toBe(src.trim());
});

test("nested child rule carries its own span/preludeSpan", () => {
  const src = "#p { type: group; > #c { r: 20px; } }";
  const child = parse(src).rules[0].children[0];
  expect(src.slice(child.preludeSpan.start, child.preludeSpan.end)).toBe("#c");
  expect(src.slice(child.span.start, child.span.end)).toBe("#c { r: 20px; }");
});

test("keyframe selectorSpan/span and @keyframes span/preludeSpan round-trip", () => {
  const src =
    "@keyframes pulse {\n  0%, 50% { opacity: 1; }\n  100% { opacity: 0; }\n}";
  const kf = parse(src).keyframes[0];
  expect(src.slice(kf.preludeSpan.start, kf.preludeSpan.end)).toBe("pulse");
  expect(src.slice(kf.span.start, kf.span.end)).toBe(src);

  const multi = kf.blocks[0];
  expect(src.slice(multi.selectorSpan.start, multi.selectorSpan.end)).toBe(
    "0%, 50%",
  );
  expect(src.slice(multi.span.start, multi.span.end)).toBe(
    "0%, 50% { opacity: 1; }",
  );
});

// --- random() (CSS Values 5) -------------------------------------------------

test("random(): bare min/max carries the length unit", () => {
  const v = parse("#b { r: random(10px, 100px); }").rules[0].declarations[0]
    .value;
  if (!isRandomValue(v)) throw new Error("expected a random value");
  expect(v.perElement).toBe(false);
  expect(v.ident).toBeUndefined();
  expect(v.step).toBeUndefined();
  expect(v.min).toEqual({ type: "length", value: 10, unit: "px" });
  expect(v.max).toEqual({ type: "length", value: 100, unit: "px" });
});

test("random(): per-element + dashed-ident prelude, in either order", () => {
  const a = parse("#b { cx: random(per-element --k, -1, 1); }").rules[0]
    .declarations[0].value;
  const b = parse("#b { cx: random(--k per-element, -1, 1); }").rules[0]
    .declarations[0].value;
  if (!isRandomValue(a) || !isRandomValue(b))
    throw new Error("expected random values");
  for (const v of [a, b]) {
    expect(v.perElement).toBe(true);
    expect(v.ident).toBe("--k");
    expect(v.min).toEqual({ type: "number", value: -1 });
  }
});

test("random(): by <step> quantizer parses as a fourth arg", () => {
  const v = parse("#b { x: random(per-element, 0px, 100px, by 20px); }")
    .rules[0].declarations[0].value;
  if (!isRandomValue(v)) throw new Error("expected a random value");
  expect(v.step).toEqual({ type: "length", value: 20, unit: "px" });
});

test("random(): composes as a calc operand", () => {
  const v = parse("#b { r: calc(random(0, 10) + 5); }").rules[0].declarations[0]
    .value;
  expect(v.type).toBe("calc");
});

test("random(): round-trips through serialize (pretty + minify)", () => {
  const src = "#b { x: random(per-element --k, 0px, 100px, by 20px); }";
  expect(sansPos(parse(serialize(parse(src))))).toEqual(sansPos(parse(src)));
  expect(sansPos(parse(serialize(parse(src), { minify: true })))).toEqual(
    sansPos(parse(src)),
  );
});

test("random(): diagnoses incompatible units, empty range, unknown keyword", () => {
  const units = parse("#b { r: random(10px, 5deg); }").diagnostics;
  expect(units.some((d) => d.code === "invalid-random")).toBe(true);

  const range = parse("#b { r: random(100px, 10px); }").diagnostics;
  expect(range.some((d) => d.code === "invalid-random")).toBe(true);

  const keyword = parse("#b { r: random(bogus, 0, 10); }").diagnostics;
  expect(keyword.some((d) => d.code === "invalid-random")).toBe(true);

  // A clean call emits no random diagnostic.
  const ok = parse("#b { r: random(0px, 10px); }").diagnostics;
  expect(ok.some((d) => d.code === "invalid-random")).toBe(false);
});
