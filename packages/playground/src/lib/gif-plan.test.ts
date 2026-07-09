import { describe, expect, test } from "bun:test";
import { planGif } from "@/lib/gif-plan";

describe("planGif", () => {
  test("delayMs is always a centisecond multiple, minimum 20ms", () => {
    for (const fps of [1, 12, 24, 29.97, 30, 50, 60, 120, 1000]) {
      const plan = planGif(5000, { fps });
      expect(plan.delayMs % 10).toBe(0);
      expect(plan.delayMs).toBeGreaterThanOrEqual(20);
    }
  });

  test("reports true effective fps derived from the snapped delay", () => {
    const plan = planGif(5000, { fps: 24 });
    expect(plan.fps).toBeCloseTo(1000 / plan.delayMs, 10);
  });

  test("defaults to 50fps (20ms delay)", () => {
    const plan = planGif(1000);
    expect(plan.delayMs).toBe(20);
    expect(plan.fps).toBe(50);
  });

  test("frameCount * delayMs tracks duration within one frame", () => {
    for (const durationMs of [333, 1000, 2500, 9999]) {
      const plan = planGif(durationMs);
      const diff = Math.abs(plan.frameCount * plan.delayMs - durationMs);
      expect(diff).toBeLessThanOrEqual(plan.delayMs);
    }
  });

  test("caps frame count for long scenes by lengthening the (snapped) delay", () => {
    const plan = planGif(60_000, { fps: 50, maxFrames: 1200 });
    expect(plan.frameCount).toBeLessThanOrEqual(1200);
    expect(plan.delayMs % 10).toBe(0);
    expect(plan.frameCount * plan.delayMs).toBeCloseTo(60_000, -2);
  });

  test("static scene (duration <= 0) exports exactly 1 frame", () => {
    expect(planGif(0).frameCount).toBe(1);
    expect(planGif(-5).frameCount).toBe(1);
    const plan = planGif(0);
    expect(plan.delayMs % 10).toBe(0);
  });
});
