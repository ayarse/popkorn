import { expect, test } from "bun:test";
import { applyEdits, extractEdits } from "@/lib/edits";

const SCENE = `#ball {
  radius: 20px;
  fill: #f00;
}`;

test("extractEdits parses a search/replace block", () => {
  const reply =
    "Sure.\n```edit\n<<<<<<<\n  fill: #f00;\n=======\n  fill: #0f0;\n>>>>>>>\n```";
  expect(extractEdits(reply)).toEqual([
    { search: "  fill: #f00;", replace: "  fill: #0f0;" },
  ]);
});

test("extractEdits parses a deletion (empty replacement)", () => {
  const reply = "```edit\n<<<<<<<\n  radius: 20px;\n=======\n>>>>>>>\n```";
  expect(extractEdits(reply)).toEqual([
    { search: "  radius: 20px;", replace: "" },
  ]);
});

test("extractEdits returns [] with no edit blocks", () => {
  expect(extractEdits("just prose")).toEqual([]);
  expect(extractEdits("```css\n#x {}\n```")).toEqual([]);
});

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
