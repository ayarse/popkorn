import { expect, test } from "bun:test";
import { wrapTime } from "./loop";
import { computeViewport, deviceToScene } from "./viewport";

// Scene 800×600 fitted into a 400×300 CSS element at dpr 2 => device 800×600,
// so contain/cover/fill all map exactly (same aspect). Use a mismatched aspect
// (400×400 element) to exercise letterbox/crop offsets.

test("viewport contain: letterbox, centered, uniform scale", () => {
  // 800×600 scene into 400×400 element @ dpr 1 => device 400×400.
  // contain uses min(400/800, 400/600) = 0.5; scaled scene = 400×300, centered.
  const vp = computeViewport(800, 600, 400, 400, 1, "contain");
  expect(vp.scaleX).toBeCloseTo(0.5, 6);
  expect(vp.scaleY).toBeCloseTo(0.5, 6);
  expect(vp.offsetX).toBeCloseTo(0, 6); // fills width
  expect(vp.offsetY).toBeCloseTo((400 - 300) / 2, 6); // 50px letterbox top/bottom
});

test("viewport cover: crop, centered, uniform scale", () => {
  const vp = computeViewport(800, 600, 400, 400, 1, "cover");
  // cover uses max(0.5, 0.667) = 0.6667; scaled scene = 533×400, cropped x.
  expect(vp.scaleX).toBeCloseTo(2 / 3, 6);
  expect(vp.scaleY).toBeCloseTo(2 / 3, 6);
  expect(vp.offsetX).toBeCloseTo((400 - 800 * (2 / 3)) / 2, 6); // negative = crop
  expect(vp.offsetY).toBeCloseTo(0, 6);
});

test("viewport fill: independent per-axis stretch, no offset", () => {
  const vp = computeViewport(800, 600, 400, 400, 1, "fill");
  expect(vp.scaleX).toBeCloseTo(0.5, 6);
  expect(vp.scaleY).toBeCloseTo(2 / 3, 6);
  expect(vp.offsetX).toBe(0);
  expect(vp.offsetY).toBe(0);
});

test("viewport none: 1:1 scene pixels (×dpr), top-left", () => {
  const vp = computeViewport(800, 600, 400, 400, 2, "none");
  expect(vp.scaleX).toBe(2);
  expect(vp.scaleY).toBe(2);
  expect(vp.offsetX).toBe(0);
  expect(vp.offsetY).toBe(0);
});

test("viewport contain folds in DPR", () => {
  // 800×600 scene into 400×300 element @ dpr 2 => device 800×600, exact fit.
  const vp = computeViewport(800, 600, 400, 300, 2, "contain");
  expect(vp.scaleX).toBeCloseTo(1, 6); // 800 device / 800 scene
  expect(vp.offsetX).toBeCloseTo(0, 6);
  expect(vp.offsetY).toBeCloseTo(0, 6);
});

test("pointer inverse round-trips through the viewport (all fits)", () => {
  const fits = ["contain", "cover", "fill", "none"] as const;
  for (const fit of fits) {
    const vp = computeViewport(800, 600, 375, 420, 2, fit);
    for (const [sx, sy] of [
      [0, 0],
      [400, 300],
      [799, 599],
      [123, 456],
    ]) {
      // Forward: scene -> device px (what viewportMatrix applies).
      const dx = vp.offsetX + sx * vp.scaleX;
      const dy = vp.offsetY + sy * vp.scaleY;
      // Inverse (what InputTracker does) recovers the scene point.
      const back = deviceToScene(vp, dx, dy);
      expect(back.x).toBeCloseTo(sx, 4);
      expect(back.y).toBeCloseTo(sy, 4);
    }
  }
});

// --- loop wrap ---------------------------------------------------------------

test("wrapTime: folds past-duration time into [0, duration) when looping", () => {
  expect(wrapTime(2500, 1000, true)).toBe(500);
  expect(wrapTime(1000, 1000, true)).toBe(0); // exactly at the boundary wraps
});

test("wrapTime: within the first pass is untouched", () => {
  expect(wrapTime(600, 1000, true)).toBe(600);
});

test("wrapTime: no-op when looping off or duration is 0", () => {
  expect(wrapTime(2500, 1000, false)).toBe(2500);
  expect(wrapTime(2500, 0, true)).toBe(2500);
});
