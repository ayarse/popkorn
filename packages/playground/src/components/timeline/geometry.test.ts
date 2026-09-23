import { describe, expect, test } from "bun:test";
import { animSpan, MIN_DURATION, trimStart } from "./geometry";

describe("timeline geometry", () => {
  test("left-cap trim keeps the end fixed at the minimum duration", () => {
    // 1000ms anim from 200ms; dragging far right must not push the end out.
    const r = trimStart(200, 1000, 5000);
    expect(r.duration).toBe(MIN_DURATION);
    expect(r.delay + r.duration).toBe(1200);
  });

  test("left-cap trim snaps the in-point and keeps the end", () => {
    const r = trimStart(200, 1000, 123);
    expect(r.delay).toBe(320);
    expect(r.delay + r.duration).toBe(1200);
  });

  test("animSpan caps infinite iterations at the display end, faded", () => {
    const inf = { delay: 100, duration: 500, iterationCount: Infinity };
    expect(animSpan(inf, 0, 3000)).toEqual({
      start: 100,
      end: 3000,
      faded: true,
    });
    const fin = { delay: 100, duration: 500, iterationCount: 2 };
    expect(animSpan(fin, 50, 3000)).toEqual({
      start: 150,
      end: 1150,
      faded: false,
    });
  });
});
