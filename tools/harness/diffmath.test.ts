import { test, expect } from 'bun:test';
import { cellRects, regionDelta, aHash, hamming, gridDiff } from './diffmath.js';

const W = 16, H = 16;

/** A W×H RGBA image, opaque background `bg`, with a `size`x`size` square of
 *  `fg` painted at (sx, sy). */
function square(bg: [number, number, number, number], fg: [number, number, number, number], sx: number, sy: number, size: number) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const inSquare = x >= sx && x < sx + size && y >= sy && y < sy + size;
      const [r, g, b, a] = inSquare ? fg : bg;
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
    }
  }
  return { data, width: W, height: H };
}

test('identical images: zero deltas, hamming 0', () => {
  const img = square([255, 255, 255, 255], [255, 0, 0, 255], 4, 4, 4);
  const same = square([255, 255, 255, 255], [255, 0, 0, 255], 4, 4, 4);
  const { meanDelta, maxDelta, coverage } = regionDelta(img, same, { x: 0, y: 0, w: W, h: H });
  expect(meanDelta).toBe(0);
  expect(maxDelta).toBe(0);
  expect(coverage).toBe(1);
  expect(hamming(aHash(img, { x: 0, y: 0, w: W, h: H }), aHash(same, { x: 0, y: 0, w: W, h: H }))).toBe(0);
});

test('transparent-both pixels are excluded from comparison', () => {
  const a = square([0, 0, 0, 0], [255, 0, 0, 255], 4, 4, 4);
  const b = square([100, 100, 100, 0], [255, 0, 0, 255], 4, 4, 4); // differs in RGB but alpha=0 on both
  const { meanDelta, coverage } = regionDelta(a, b, { x: 0, y: 0, w: W, h: H });
  expect(meanDelta).toBe(0); // transparent pixels never contribute
  expect(coverage).toBeCloseTo((4 * 4) / (W * H), 5); // only the square pixels counted
});

/** A checkerboard background (so any cell without the square still has
 *  internal texture — a uniform-color cell always aHashes to all-1s, which
 *  would make two *different* uniform colors look identical) with a solid
 *  mid-gray `size`x`size` square painted at (sx, sy). */
function checkerSquare(sx: number, sy: number, size: number) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const inSquare = x >= sx && x < sx + size && y >= sy && y < sy + size;
      const v = inSquare ? 128 : (x + y) % 2 === 0 ? 0 : 255;
      data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

test('a moved square: the cell(s) it moved into rank worst, hashDist > 0', () => {
  const a = checkerSquare(0, 0, 4); // square in top-left cell
  const b = checkerSquare(8, 8, 4); // square moved to a far cell
  const cols = 4, rows = 4; // 4x4 pixel cells over a 16x16 image
  const { cells, meanDelta } = gridDiff(a, b, cols, rows);
  expect(meanDelta).toBeGreaterThan(0);
  expect(cells[0].hashDist).toBeGreaterThan(0);
  // worst cells should be the two cells whose content actually changed:
  // (col 0, row 0) lost the square, (col 2, row 2) gained it.
  const worstKeys = cells.filter((c) => c.hashDist === cells[0].hashDist).map((c) => `${c.col},${c.row}`);
  expect(worstKeys).toContain('0,0');
  expect(worstKeys).toContain('2,2');
});

test('cellRects tiles the image exactly with no gaps or overlaps', () => {
  const rects = cellRects(10, 10, 3, 3);
  expect(rects.length).toBe(9);
  const totalArea = rects.reduce((s, r) => s + r.w * r.h, 0);
  expect(totalArea).toBe(100);
});
