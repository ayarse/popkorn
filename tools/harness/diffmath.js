// Pure pixel-diff math shared by harness.html (as a <script type="module">) and
// diffmath.test.ts (imported directly under bun). No DOM — operates on plain
// { data: Uint8ClampedArray, width, height } image objects, RGBA layout.
//
// TRANSPARENT_ALPHA_THRESHOLD mirrors the original __diff(): pixels fully
// transparent on both sides are excluded from comparison (they're "both
// nothing", not a mismatch).
const TRANSPARENT_ALPHA_THRESHOLD = 8;

/** Tile a width×height image into cols×rows rects, row-major, exact coverage
 *  (edge cells absorb the remainder via floor division). */
export function cellRects(width, height, cols, rows) {
  const rects = [];
  for (let row = 0; row < rows; row++) {
    const y = Math.floor((row * height) / rows);
    const y2 = Math.floor(((row + 1) * height) / rows);
    for (let col = 0; col < cols; col++) {
      const x = Math.floor((col * width) / cols);
      const x2 = Math.floor(((col + 1) * width) / cols);
      rects.push({ x, y, w: x2 - x, h: y2 - y });
    }
  }
  return rects;
}

/** Mean/max per-pixel RGB delta over a rect, plus coverage = fraction of
 *  pixels that weren't transparent on both sides (and thus actually compared). */
export function regionDelta(a, b, rect) {
  const { x, y, w, h } = rect;
  const width = a.width;
  let sum = 0, n = 0, maxDelta = 0, total = 0;
  for (let j = 0; j < h; j++) {
    const py = y + j;
    for (let i = 0; i < w; i++) {
      const px = x + i;
      const idx = (py * width + px) * 4;
      total++;
      const aA = a.data[idx + 3], bA = b.data[idx + 3];
      if (aA < TRANSPARENT_ALPHA_THRESHOLD && bA < TRANSPARENT_ALPHA_THRESHOLD) continue;
      const d = Math.abs(a.data[idx] - b.data[idx]) + Math.abs(a.data[idx + 1] - b.data[idx + 1]) + Math.abs(a.data[idx + 2] - b.data[idx + 2]);
      sum += d;
      n++;
      if (d > maxDelta) maxDelta = d;
    }
  }
  return {
    meanDelta: n ? sum / n : 0,
    maxDelta,
    coverage: total ? n / total : 0,
  };
}

/** 64-bit average hash (aHash) of a rect: downsample to 8x8 grayscale
 *  (alpha-premultiplied luminance, transparent reads as black), threshold
 *  each cell against the 64-cell mean. Returns a BigInt, MSB = top-left. */
export function aHash(img, rect) {
  const { x, y, w, h } = rect;
  const width = img.width;
  const N = 8;
  const gray = new Array(N * N).fill(0);
  for (let gy = 0; gy < N; gy++) {
    const y0 = y + Math.floor((gy * h) / N);
    const y1 = Math.max(y0 + 1, y + Math.floor(((gy + 1) * h) / N));
    for (let gx = 0; gx < N; gx++) {
      const x0 = x + Math.floor((gx * w) / N);
      const x1 = Math.max(x0 + 1, x + Math.floor(((gx + 1) * w) / N));
      let sum = 0, count = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const idx = (py * width + px) * 4;
          const alpha = img.data[idx + 3] / 255;
          const lum = (img.data[idx] * 0.299 + img.data[idx + 1] * 0.587 + img.data[idx + 2] * 0.114) * alpha;
          sum += lum;
          count++;
        }
      }
      gray[gy * N + gx] = count ? sum / count : 0;
    }
  }
  const mean = gray.reduce((s, v) => s + v, 0) / (N * N);
  let hash = 0n;
  for (let i = 0; i < N * N; i++) {
    hash = (hash << 1n) | (gray[i] >= mean ? 1n : 0n);
  }
  return hash;
}

/** Bit distance (0-64) between two aHash values. */
export function hamming(h1, h2) {
  let x = h1 ^ h2;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Per-cell delta + aHash localization over an 8x8 (default) grid, sorted
 *  worst-first by (hashDist desc, meanDelta desc) so structural mismatches
 *  (things in the wrong place) outrank uniform color noise. */
export function gridDiff(a, b, cols = 8, rows = 8) {
  const rects = cellRects(a.width, a.height, cols, rows);
  const cells = rects.map((rect, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const { meanDelta, maxDelta, coverage } = regionDelta(a, b, rect);
    const hashDist = hamming(aHash(a, rect), aHash(b, rect));
    return { col, row, x: rect.x, y: rect.y, w: rect.w, h: rect.h, meanDelta, maxDelta, coverage, hashDist };
  });
  cells.sort((p, q) => (q.hashDist - p.hashDist) || (q.meanDelta - p.meanDelta));
  const overall = regionDelta(a, b, { x: 0, y: 0, w: a.width, h: a.height });
  return { cells, meanDelta: overall.meanDelta, maxDelta: overall.maxDelta };
}
