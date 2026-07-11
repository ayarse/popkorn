import { expect, test } from "bun:test";
import { applyEdits } from "@/lib/edits";

const SCENE = `#ball {
  radius: 20px;
  fill: #f00;
}`;

test("applyEdits applies sequentially and all-or-nothing", () => {
  const r = applyEdits(SCENE, [
    { search: "#f00", replace: "#0f0" },
    { search: "20px", replace: "40px" },
  ]);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.result).toBe("#ball {\n  radius: 40px;\n  fill: #0f0;\n}");
});

test("applyEdits fails when search is missing", () => {
  const r = applyEdits(SCENE, [{ search: "nope", replace: "x" }]);
  expect(r).toEqual({
    ok: false,
    error: "Edit block 1 didn't match the scene — not applied",
  });
});

test("applyEdits fails when search is not unique", () => {
  const r = applyEdits("a a", [{ search: "a", replace: "b" }]);
  expect(r.ok).toBe(false);
});

test("applyEdits is atomic: a later failing block reverts earlier ones", () => {
  const r = applyEdits(SCENE, [
    { search: "#f00", replace: "#0f0" },
    { search: "missing", replace: "x" },
  ]);
  expect(r.ok).toBe(false);
});

test("replaceAll swaps every occurrence and reports the count", () => {
  const r = applyEdits("#e94560 a #e94560 b #e94560", [
    { search: "#e94560", replace: "#000", replaceAll: true },
  ]);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.result).toBe("#000 a #000 b #000");
    expect(r.counts).toEqual([3]);
  }
});

test("replaceAll on a single occurrence works and counts 1", () => {
  const r = applyEdits(SCENE, [
    { search: "#f00", replace: "#0f0", replaceAll: true },
  ]);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.result).toContain("#0f0");
    expect(r.counts).toEqual([1]);
  }
});

test("replaceAll with zero matches is an error", () => {
  const r = applyEdits(SCENE, [
    { search: "nope", replace: "x", replaceAll: true },
  ]);
  expect(r.ok).toBe(false);
});

test("replaceAll with an empty search is an error", () => {
  const r = applyEdits(SCENE, [{ search: "", replace: "x", replaceAll: true }]);
  expect(r.ok).toBe(false);
});
