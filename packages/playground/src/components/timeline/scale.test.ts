import { describe, expect, test } from "bun:test";
import { pxPerMs, snapMs, tickStep, ticks } from "./scale";

describe("timeline scale", () => {
  test("pxPerMs scales linearly with zoom", () => {
    expect(pxPerMs(1)).toBeCloseTo(0.1);
    expect(pxPerMs(2)).toBeCloseTo(0.2);
  });

  test("tickStep picks the smallest step wide enough to not crowd labels", () => {
    // At zoom 1 (0.1px/ms) a 1000ms step is 100px >= 80px minimum.
    expect(tickStep(pxPerMs(1))).toBe(1000);
    // Zoomed way in, finer steps clear the minimum first.
    expect(tickStep(pxPerMs(8))).toBe(100);
    // Zoomed out, the step grows so labels stay apart.
    expect(tickStep(pxPerMs(0.2))).toBe(5000);
  });

  test("ticks are inclusive of 0 and the end", () => {
    expect(ticks(1000, 250)).toEqual([0, 250, 500, 750, 1000]);
  });

  test("snapMs rounds to the 10ms grid", () => {
    expect(snapMs(1234)).toBe(1230);
    expect(snapMs(1236)).toBe(1240);
    expect(snapMs(-7)).toBe(-10);
  });
});
