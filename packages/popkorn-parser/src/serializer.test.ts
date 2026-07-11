import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format, minify } from "./index";
import { parse } from "./parser";
import { serialize } from "./serializer";

// Strip position metadata (spans + diagnostics) before value-equality: serialize
// reformats text, so source offsets shift, but the AST *value* is unchanged. Same
// rationale that keeps diagnostics out of round-trip comparisons.
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

// The correctness gate: serialize is value-preserving in both modes, i.e.
// parse(serialize(parse(src))) deep-equals parse(src).

test("minify: no optional whitespace, no trailing ; before }", () => {
  const out = serialize(parse("#box { width: 100px; fill: #ff0000; }"), {
    minify: true,
  });
  expect(out).toBe("#box{width:100px;fill:#ff0000}");
});

test("minify: number shortening is value-preserving (1.50→1.5, 2.0→2)", () => {
  const out = serialize(parse("#s { a: 1.50; b: 2.0; c: 0.7px; }"), {
    minify: true,
  });
  expect(out).toBe("#s{a:1.5;b:2;c:0.7px}");
  // Compare the AST value only — the synthetic a/b/c props raise
  // unknown-property diagnostics whose offsets differ between the two sources.
  expect(sansPos(parse(out).rules)).toEqual(
    sansPos(parse("#s { a: 1.50; b: 2.0; c: 0.7px; }").rules),
  );
});

test("round-trip: :root overflow survives serialize + re-parse", () => {
  const src = ":root { width: 800px; height: 600px; overflow: visible; }";
  const out = serialize(parse(src));
  expect(out).toContain("overflow: visible");
  expect(parse(out).canvas).toEqual({
    width: 800,
    height: 600,
    overflow: "visible",
  });
});

test("pretty: 2-space indent, one decl per line", () => {
  expect(serialize(parse("#box { width: 100px; fill: #ff0000; }"))).toBe(
    "#box {\n  width: 100px;\n  fill: #ff0000;\n}\n",
  );
});

test("minify: nested child (>) and pseudo-state (&:) survive", () => {
  const src = "#p { type: group; > #c { r: 20px; } &:hover { fill: #f00; } }";
  const out = serialize(parse(src), { minify: true });
  expect(sansPos(parse(out))).toEqual(sansPos(parse(src)));
  expect(out).toBe("#p{type:group;>#c{r:20px}&:hover{fill:#f00}}");
});

test("state-block child rule (&:hover > #c) round-trips both modes", () => {
  const src =
    "#card { fill: #111; &:hover { fill: #2a2a4a; > #icon { transform: rotate(15deg); } } }";
  const min = serialize(parse(src), { minify: true });
  expect(sansPos(parse(min))).toEqual(sansPos(parse(src)));
  expect(min).toBe(
    "#card{fill:#111;&:hover{fill:#2a2a4a;>#icon{transform:rotate(15deg)}}}",
  );
  expect(sansPos(parse(serialize(parse(src))))).toEqual(sansPos(parse(src)));
});

test("skew transform functions round-trip in both modes", () => {
  const src = "#s { transform: skew(15deg, 5deg) skewX(30deg) skewY(-10deg); }";
  expect(sansPos(parse(serialize(parse(src), { minify: true })))).toEqual(
    sansPos(parse(src)),
  );
  expect(sansPos(parse(serialize(parse(src))))).toEqual(sansPos(parse(src)));
});

test("calc() round-trips (precedence + var/input operands) in both modes", () => {
  const src =
    "#s { cx: calc((var(--i) + 2) * 3px); cy: calc(100px - var(--k) / 2); }";
  // Compare the AST value only — the undeclared var() operands raise
  // (offset-bearing) info diagnostics that differ between the two sources.
  expect(sansPos(parse(serialize(parse(src), { minify: true })))).toEqual(
    sansPos(parse(src)),
  );
  expect(sansPos(parse(serialize(parse(src))))).toEqual(sansPos(parse(src)));
});

test(":root background round-trips for named colors and rgb()/rgba()", () => {
  const src = ":root { width: 400px; height: 300px; background: red; }";
  expect(sansPos(parse(serialize(parse(src), { minify: true })))).toEqual(
    sansPos(parse(src)),
  );
  expect(sansPos(parse(serialize(parse(src))))).toEqual(sansPos(parse(src)));

  const rgbSrc = ":root { background: rgba(26, 26, 46, 0.5); }";
  expect(sansPos(parse(serialize(parse(rgbSrc), { minify: true })))).toEqual(
    sansPos(parse(rgbSrc)),
  );
  expect(sansPos(parse(serialize(parse(rgbSrc))))).toEqual(
    sansPos(parse(rgbSrc)),
  );
});

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
  for (const minify of [false, true]) {
    test(`round-trip ${minify ? "minify" : "pretty"}: ${file}`, () => {
      const ast = parse(readFileSync(`${examplesDir}/${file}`, "utf8"));
      expect(sansPos(parse(serialize(ast, { minify })))).toEqual(sansPos(ast));
    });
  }
}

test("minify()/format() sugar round-trips through the same AST", () => {
  const src = "#box { width: 100px; fill: #ff0000; }";
  expect(sansPos(parse(minify(src)))).toEqual(sansPos(parse(src)));
  expect(sansPos(parse(format(src)))).toEqual(sansPos(parse(src)));
  expect(minify(src).length).toBeLessThanOrEqual(format(src).length);
});
