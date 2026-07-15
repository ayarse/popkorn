import { expect, test } from "bun:test";
import { offsetToLineCol } from "./diagnostics";
import { parse, validate } from "./parser";

// One assertion per diagnostic code — each pins the code, severity, a hint when
// applicable, and the flagged source span (so editor underlines land right).

// Find the first diagnostic with a given code.
const find = (src: string, code: string) =>
  parse(src).diagnostics.find((d) => d.code === code);

// Like find(), but asserts the diagnostic exists (avoids `!` non-null casts).
const must = (src: string, code: string) => {
  const d = find(src, code);
  if (!d) throw new Error(`expected a '${code}' diagnostic for: ${src}`);
  return d;
};

// The exact substring a diagnostic's [start,end) span covers.
const span = (src: string, code: string) => {
  const d = find(src, code);
  return d ? src.slice(d.start, d.end) : undefined;
};

test("valid sheet yields no diagnostics", () => {
  expect(parse("#box { width: 100px; fill: red; }").diagnostics).toEqual([]);
});

test("validate() returns just the diagnostics array", () => {
  const d = validate("#box { wdth: 100px; }");
  expect(Array.isArray(d)).toBe(true);
  expect(d[0].code).toBe("unknown-property");
});

test("unknown-property: warning + did-you-mean + property span", () => {
  const src = "#box { wdth: 100px; }";
  const d = must(src, "unknown-property");
  expect(d.severity).toBe("warning");
  expect(d.hint).toBe("Did you mean 'width'?");
  expect(span(src, "unknown-property")).toBe("wdth");
});

test("unknown-property: no false suggestion for gibberish", () => {
  const d = must("#box { zzzzzz: 1; }", "unknown-property");
  expect(d.hint).toBeUndefined();
});

test("custom properties are never unknown", () => {
  expect(parse("#box { --my-var: 3; }").diagnostics).toEqual([]);
});

test("cursor: pointer is a known property (no diagnostics)", () => {
  expect(
    parse("#btn { type: circle; r: 10px; cursor: pointer; }").diagnostics,
  ).toEqual([]);
});

test("unsupported-property: box-model props flagged and dropped", () => {
  const d = must("#box { padding: 4px; }", "unsupported-property");
  expect(d.severity).toBe("warning");
  expect(d.message).toContain("no box model");
  expect(span("#box { padding: 4px; }", "unsupported-property")).toBe(
    "padding",
  );
  expect(parse("#box { padding: 4px; }").rules[0].declarations).toEqual([]);
});

test("unsupported-property: right/bottom flagged, hint to x/y", () => {
  const d = must("#box { right: 5px; }", "unsupported-property");
  expect(d.hint).toContain("x/y");
  expect(span("#box { right: 5px; }", "unsupported-property")).toBe("right");
});

test("unknown-color: bad color keyword + did-you-mean + value span", () => {
  const src = "#box { fill: rde; }";
  const d = must(src, "unknown-color");
  expect(d.severity).toBe("warning");
  expect(d.hint).toBe("Did you mean 'red'?");
  expect(span(src, "unknown-color")).toBe("rde");
});

test("unknown-color: named colors, hex, none, and refs pass", () => {
  for (const v of ["red", "#ff0000", "none", "transparent", "#myLayer"]) {
    expect(find(`#box { fill: ${v}; }`, "unknown-color")).toBeUndefined();
  }
});

test("unknown-keyframes: animation-name to missing @keyframes", () => {
  const src = "#box { animation-name: spinn; } @keyframes spin { }";
  const d = must(src, "unknown-keyframes");
  expect(d.severity).toBe("warning");
  expect(d.hint).toBe("Did you mean 'spin'?");
  expect(span(src, "unknown-keyframes")).toBe("spinn");
});

test("unknown-keyframes: animation shorthand name is checked", () => {
  expect(
    find("#box { animation: nope 2s linear infinite; }", "unknown-keyframes"),
  ).toBeDefined();
  // Defined keyframes resolve cleanly.
  expect(
    find(
      "#box { animation: spin 2s linear; } @keyframes spin { }",
      "unknown-keyframes",
    ),
  ).toBeUndefined();
});

test("unknown-define: use references undefined @define", () => {
  const src = "#box { use: gaget; } @define gadget { }";
  const d = must(src, "unknown-define");
  expect(d.severity).toBe("warning");
  expect(d.hint).toBe("Did you mean 'gadget'?");
  expect(span(src, "unknown-define")).toBe("gaget");
});

test("unknown-id: mask references undefined node id", () => {
  const src = "#box { mask: #missing; } #reveal { }";
  const d = must(src, "unknown-id");
  expect(d.severity).toBe("warning");
  expect(span(src, "unknown-id")).toBe("#missing");
  // A real id resolves.
  expect(
    find("#box { mask: #reveal; } #reveal { }", "unknown-id"),
  ).toBeUndefined();
});

test("undefined-var: info severity, span, and fallback silences it", () => {
  const src = "#box { x: var(--nope); }";
  const d = must(src, "undefined-var");
  expect(d.severity).toBe("info");
  expect(span(src, "undefined-var")).toBe("var(--nope)");
  // Declared or fallback'd vars don't warn.
  expect(
    find("#box { x: var(--k); --k: 1; }", "undefined-var"),
  ).toBeUndefined();
  expect(find("#box { x: var(--k, 0); }", "undefined-var")).toBeUndefined();
});

test("unterminated-string: error with a closing-quote hint", () => {
  // A raw newline ends the unclosed string (CSS parse-error recovery), so the
  // rest of the sheet still parses and the diagnostic is delivered.
  const d = must('#box {\n  content: "hi\n}', "unterminated-string");
  expect(d.severity).toBe("error");
  expect(d.hint).toContain("closing");
});

test("offsetToLineCol maps offsets to 1-based line/col", () => {
  const src = "a\nbc\nd";
  expect(offsetToLineCol(src, 0)).toEqual({ line: 1, column: 1 });
  expect(offsetToLineCol(src, 2)).toEqual({ line: 2, column: 1 });
  expect(offsetToLineCol(src, 3)).toEqual({ line: 2, column: 2 });
  expect(offsetToLineCol(src, 5)).toEqual({ line: 3, column: 1 });
});
