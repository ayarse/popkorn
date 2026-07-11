import { afterEach, expect, test } from "bun:test";
import { parse } from "@popcorn/parser";
import { buildSceneGraph } from "./builder";
import {
  getShapeBounds,
  resolveTransformOrigin,
  setTextMeasurer,
} from "./transform";
import type { TextData } from "./types";

// A fake platform measurer: fixed advance per character, distinct from the
// 0.6·em headless estimate so tests can tell which path produced a box.
const FAKE_ADVANCE = 9;
const fakeMeasurer = (text: string, style: { fontSize: number }) => ({
  width: FAKE_ADVANCE * text.length,
  height: style.fontSize,
});

const textNode = (decls = "") =>
  buildSceneGraph(
    parse(
      `#t { type: text; content: "AB"; x: 100px; y: 100px; font-size: 20px; ${decls} }`,
    ),
  ).children[0];

// Always clear the process-global measurer so a test never leaks into the next.
afterEach(() => setTextMeasurer(null));

test("registered measurer drives text hit-test bounds", () => {
  setTextMeasurer(fakeMeasurer);
  const t = textNode();
  // getShapeBounds is the exact box runtime/hit-test.ts uses for text.
  const b = getShapeBounds(t);
  expect(b.width).toBe(FAKE_ADVANCE * 2); // measurer, not 0.6*20*2 estimate
  expect(b.height).toBe(20);
  // anchor: start, alphabetic baseline -> box sits above y.
  expect(b).toMatchObject({ x: 100, y: 80 });
});

test("transform-origin % on a text node resolves against the measurer box", () => {
  setTextMeasurer(fakeMeasurer);
  const t = textNode("transform-origin: 50% 100%;");
  const origin = resolveTransformOrigin(t);
  const b = getShapeBounds(t);
  // 50% of width from the box's left edge; 100% of height from its top.
  expect(origin.x).toBeCloseTo(b.x + b.width / 2, 5);
  expect(origin.y).toBeCloseTo(b.y + b.height, 5);
  expect(origin.x).toBeCloseTo(100 + (FAKE_ADVANCE * 2) / 2, 5);
});

test("unregistering the measurer restores the headless estimate", () => {
  const t = textNode();
  setTextMeasurer(fakeMeasurer);
  expect(getShapeBounds(t).width).toBe(FAKE_ADVANCE * 2);

  setTextMeasurer(null);
  // Re-measured against the em-estimate (no DOM under bun).
  expect(getShapeBounds(t).width).toBeCloseTo(0.6 * 20 * 2, 5);
});

test("a node measured under the estimate re-measures when a measurer registers", () => {
  const t = textNode();
  // Measure first (no measurer) -> estimate, caches + clears the dirty flag.
  expect(getShapeBounds(t).width).toBeCloseTo(0.6 * 20 * 2, 5);
  expect(t.textBoundsDirty).toBe(false);

  // Register AFTER measuring: the generation stamp must invalidate the stale
  // estimate cache even though textBoundsDirty is still false.
  setTextMeasurer(fakeMeasurer);
  expect(getShapeBounds(t).width).toBe(FAKE_ADVANCE * 2);
});

test("a measurer returning null falls through to the estimate", () => {
  setTextMeasurer(() => null);
  const t = textNode();
  expect(getShapeBounds(t).width).toBeCloseTo(0.6 * 20 * 2, 5);
  expect((t.shapeData as TextData).content).toBe("AB");
});
