import { describe, expect, test } from "bun:test";
// NOTE: the render/encode pipeline in mp4.ts needs WebCodecs (VideoEncoder),
// which doesn't exist under bun; only the DOM-free plan math is tested here.
import { avcCodec, evenDim, planMp4 } from "@/lib/mp4-plan";

describe("planMp4", () => {
  test("defaults to 30fps", () => {
    expect(planMp4(2000).fps).toBeCloseTo(30, 10);
    expect(planMp4(2000).delayMs).toBeCloseTo(1000 / 30, 10);
  });

  test("frameDurationUs matches delayMs", () => {
    for (const d of [1000, 5000, 60_000]) {
      const p = planMp4(d);
      expect(p.frameDurationUs).toBe(Math.round(p.delayMs * 1000));
    }
  });

  test("a static scene exports a single frame", () => {
    expect(planMp4(0).frameCount).toBe(1);
    expect(planMp4(-5).frameCount).toBe(1);
  });

  test("caps total frames by stretching the delay on long scenes", () => {
    const p = planMp4(10 * 60 * 1000); // 10 minutes
    expect(p.frameCount).toBeLessThanOrEqual(1800);
    expect(p.fps).toBeLessThan(30); // delay lengthened
  });
});

describe("evenDim", () => {
  test("rounds odd down to even, leaves even untouched, floors at 2", () => {
    expect(evenDim(400)).toBe(400);
    expect(evenDim(401)).toBe(400);
    expect(evenDim(1)).toBe(2);
    expect(evenDim(0)).toBe(2);
  });
});

describe("avcCodec", () => {
  test("picks baseline level 3.0 for a small stage", () => {
    expect(avcCodec(400, 300)).toBe("avc1.42001e");
  });

  test("scales the level up for larger frames", () => {
    // 1920x1080 = 8160 macroblocks → level 4.0 (0x28).
    expect(avcCodec(1920, 1080)).toBe("avc1.420028");
  });

  test("always emits a well-formed baseline codec string", () => {
    for (const [w, h] of [
      [16, 16],
      [640, 480],
      [4096, 4096],
    ]) {
      expect(avcCodec(w, h)).toMatch(/^avc1\.4200[0-9a-f]{2}$/);
    }
  });
});
