import { expect, test } from "bun:test";
import { planGif } from "./gif-plan";

test("targets 30fps for a short scene", () => {
  const p = planGif(2000);
  expect(p.fps).toBe(30);
  expect(p.frameCount).toBe(60);
  expect(p.delayMs).toBe(Math.round(1000 / 30));
});

test("static scene exports a single frame", () => {
  expect(planGif(0).frameCount).toBe(1);
});

test("long scene caps frames and lowers fps", () => {
  const p = planGif(60_000); // 60s @30fps = 1800 frames, over the 300 cap
  expect(p.frameCount).toBe(300);
  expect(p.fps).toBeCloseTo(5, 5);
  expect(p.delayMs).toBe(200);
});

test("respects a custom cap", () => {
  const p = planGif(10_000, { maxFrames: 100 });
  expect(p.frameCount).toBe(100);
  expect(p.fps).toBeCloseTo(10, 5);
});
