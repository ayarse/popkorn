import { expect, test } from "bun:test";
import { moveKeyframe, retimeAnimation } from "./timeline-edits";

// Helper: assert ok and return the new source.
function ok(r: ReturnType<typeof retimeAnimation>): string {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.source;
}

// --- retimeAnimation: shorthand ----------------------------------------------

test("retime shorthand: duration + delay, preserving units", () => {
  const src = "#d { animation: spin 2s linear infinite; }";
  const out = ok(
    retimeAnimation(src, "#d", "spin", { duration: 3000, delay: 500 }),
  );
  // duration replaces `2s` in seconds; delay inserted after it (fresh → ms).
  expect(out).toBe("#d { animation: spin 3s 500ms linear infinite; }");
});

test("retime shorthand: replaces existing delay in its own unit", () => {
  const src = "#d { animation: fade 1s 250ms ease; }";
  const out = ok(retimeAnimation(src, "#d", "fade", { delay: 400 }));
  expect(out).toBe("#d { animation: fade 1s 400ms ease; }");
});

test("retime shorthand: targets the matching item in a comma list", () => {
  const src = "#d { animation: spin 2s linear, fade 1s ease; }";
  const out = ok(retimeAnimation(src, "#d", "fade", { duration: 1500 }));
  expect(out).toBe("#d { animation: spin 2s linear, fade 1.5s ease; }");
});

// --- retimeAnimation: longhand -----------------------------------------------

test("retime longhand: rewrites animation-duration in ms", () => {
  const src =
    "#d { animation-name: pulse; animation-duration: 800ms; animation-delay: 0ms; }";
  const out = ok(retimeAnimation(src, "#d", "pulse", { duration: 1200 }));
  expect(out).toContain("animation-duration: 1200ms;");
  expect(out).toContain("animation-name: pulse;");
});

test("retime longhand: inserts an absent property as a new declaration", () => {
  const src = "#d {\n  animation-name: pulse;\n  animation-duration: 800ms;\n}";
  const out = ok(retimeAnimation(src, "#d", "pulse", { delay: 300 }));
  expect(out).toContain("animation-delay: 300ms;");
  // Inserted on its own line, indented like its siblings.
  expect(out).toMatch(/\n {2}animation-delay: 300ms;/);
});

// --- retimeAnimation: :state() rules -----------------------------------------

const stateScene = `#btn {
  type: rect; x: 0; y: 0; width: 40px; height: 40px; fill: #333;
  &:state(door.open) { animation: swing 600ms ease-out; }
  &:state(door.shut) { animation-name: snap; animation-duration: 200ms; }
}`;

test("retime shorthand inside a :state() block", () => {
  const out = ok(
    retimeAnimation(stateScene, "#btn:state(door.open)", "swing", {
      duration: 900,
    }),
  );
  expect(out).toContain("animation: swing 900ms ease-out;");
});

test("retime longhand inside a :state() block", () => {
  const out = ok(
    retimeAnimation(stateScene, "#btn:state(door.shut)", "snap", {
      duration: 350,
    }),
  );
  expect(out).toContain("animation-duration: 350ms;");
});

test("retime: unknown state name errors", () => {
  const r = retimeAnimation(stateScene, "#btn:state(door.ajar)", "swing", {
    duration: 100,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("ajar");
});

test("retime: selector not found errors", () => {
  const r = retimeAnimation("#a { fill: #f00; }", "#missing", "x", {
    delay: 10,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("missing");
});

// --- moveKeyframe ------------------------------------------------------------

test("moveKeyframe: rewrites a single-selector block", () => {
  const src =
    "@keyframes k { 0% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }";
  const out = ok(moveKeyframe(src, "k", 0.5, 0.7));
  expect(out).toContain("70% { opacity: 1; }");
  expect(out).not.toContain("50% { opacity: 1; }");
});

test("moveKeyframe: splits a multi-selector block, rewriting only the match", () => {
  const src = "@keyframes k { 0%, 50% { opacity: 1; } 100% { opacity: 0; } }";
  const out = ok(moveKeyframe(src, "k", 0.5, 0.6));
  expect(out).toContain("0%, 60% { opacity: 1; }");
});

test("moveKeyframe: rejects a collision with another block", () => {
  const src =
    "@keyframes k { 0% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }";
  const r = moveKeyframe(src, "k", 0.5, 1.0);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("100%");
});

test("moveKeyframe: rounds to at most 2 decimals", () => {
  const src = "@keyframes k { 0% { opacity: 0; } 50% { opacity: 1; } }";
  const out = ok(moveKeyframe(src, "k", 0.5, 1 / 3));
  expect(out).toContain("33.33% { opacity: 1; }");
});

test("moveKeyframe: unknown @keyframes errors", () => {
  const r = moveKeyframe("@keyframes k { 0% { opacity: 0; } }", "nope", 0, 0.5);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("nope");
});
