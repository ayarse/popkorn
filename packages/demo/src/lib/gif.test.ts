import { expect, test } from "bun:test";
import { planGif } from "./gif-plan";
import { quantizeFrame } from "./gif";

/**
 * Mean per-channel color error of the reconstructed image, averaged over
 * `block`×`block` tiles. This is the low-pass reading that dithering actually
 * optimizes: FS diffuses quantization error into neighbors, so each local
 * region's *average* color stays close to the original even though individual
 * pixels are noisier.
 */
function blockMeanError(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  index: Uint8Array,
  palette: number[][],
  block: number,
): number {
  let sum = 0;
  let tiles = 0;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      let or = 0, og = 0, ob = 0, pr = 0, pg = 0, pb = 0, n = 0;
      for (let y = by; y < Math.min(by + block, height); y++) {
        for (let x = bx; x < Math.min(bx + block, width); x++) {
          const i = y * width + x;
          const p = palette[index[i]];
          or += rgba[i * 4]; og += rgba[i * 4 + 1]; ob += rgba[i * 4 + 2];
          pr += p[0]; pg += p[1]; pb += p[2];
          n++;
        }
      }
      sum += (Math.abs(or - pr) + Math.abs(og - pg) + Math.abs(ob - pb)) / n;
      tiles++;
    }
  }
  return sum / (tiles * 3);
}

function gradient(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = x; // 0..255
      rgba[i + 1] = y * 4; // 0..252
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// planGif's frame budget is owned/covered by gif-plan.test.ts; here we only
// assert the timing contract exportGif relies on: a centisecond-snapped delay.
test("plan delay is always a multiple of 10ms (GIF centisecond timing)", () => {
  for (const d of [0, 2000, 10_000, 60_000]) {
    expect(planGif(d).delayMs % 10).toBe(0);
  }
});

test("alpha threshold maps sub-128 pixels to the reserved index, opaque pixels never do", () => {
  // 2x2: opaque red, semi-transparent (a=100), fully transparent, opaque blue.
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, // opaque
    0, 255, 0, 100, // semi-transparent → transparent
    0, 0, 255, 0, //   fully transparent
    0, 0, 255, 255, // opaque
  ]);
  const { index, transparentIndex } = quantizeFrame(rgba, 2, 2, { transparent: true });

  expect(transparentIndex).toBeGreaterThanOrEqual(0);
  expect(index[1]).toBe(transparentIndex); // semi
  expect(index[2]).toBe(transparentIndex); // fully transparent
  expect(index[0]).not.toBe(transparentIndex); // opaque
  expect(index[3]).not.toBe(transparentIndex); // opaque
});

test("palette never exceeds 256 entries", () => {
  const w = 256, h = 64;
  const rgba = gradient(w, h); // >256 distinct colors
  expect(quantizeFrame(rgba, w, h, {}).palette.length).toBeLessThanOrEqual(256);
  expect(quantizeFrame(rgba, w, h, { transparent: true }).palette.length).toBeLessThanOrEqual(256);
});

test("dithering lowers local mean color error vs nearest on a gradient", () => {
  const w = 256, h = 64;
  const rgba = gradient(w, h); // >256 distinct colors, so quantization bands

  const dithered = quantizeFrame(rgba, w, h, { dither: true });
  const nearest = quantizeFrame(rgba, w, h, { dither: false });

  const eDither = blockMeanError(rgba, w, h, dithered.index, dithered.palette, 4);
  const eNearest = blockMeanError(rgba, w, h, nearest.index, nearest.palette, 4);

  expect(eDither).toBeLessThan(eNearest);
});
