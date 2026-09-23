import { GIFEncoder, type Palette, quantize } from "gifenc";
import {
  createExportLoop,
  downloadBytes,
  type ExportOptions,
  prewarmImages,
  runExportWorker,
  throwIfAborted,
} from "@/lib/export-common";
import { planGif } from "@/lib/gif-plan";

export type { ExportOptions } from "@/lib/export-common";

/** Alpha at or above this (0–255) counts as opaque; below maps to transparency. */
const ALPHA_THRESHOLD = 128;

export interface IndexedFrame {
  /** One palette index per pixel, row-major. */
  index: Uint8Array;
  /** RGB (or RGB reserved-transparent) palette, ≤256 entries. */
  palette: Palette;
  /** Reserved transparent palette index, or -1 for an opaque frame. */
  transparentIndex: number;
}

/**
 * Nearest palette entry to (r,g,b) by squared RGB distance, skipping
 * `skipIndex` (the reserved transparent slot) so opaque pixels never map to it.
 * Mirrors gifenc's early-exit search.
 */
function nearestIndex(
  palette: Palette,
  r: number,
  g: number,
  b: number,
  skipIndex: number,
): number {
  let k = skipIndex === 0 ? 1 : 0;
  let min = Infinity;
  for (let i = 0; i < palette.length; i++) {
    if (i === skipIndex) continue;
    const p = palette[i];
    let d = (p[0] - r) * (p[0] - r);
    if (d > min) continue;
    d += (p[1] - g) * (p[1] - g);
    if (d > min) continue;
    d += (p[2] - b) * (p[2] - b);
    if (d > min) continue;
    min = d;
    k = i;
  }
  return k;
}

/**
 * Pure per-frame pipeline: alpha-threshold → palette → (Floyd–Steinberg) dither
 * → indexed frame. Operates on a raw RGBA buffer so it's DOM-free testable.
 *
 * Transparent frames threshold alpha to 1-bit, quantize *only* the opaque
 * pixels at full RGB quality, and reserve one palette index for transparency —
 * every sub-threshold pixel maps to that index and is excluded from error
 * diffusion (error never crosses the opaque/transparent boundary). Opaque
 * frames quantize the whole buffer.
 */
export function quantizeFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  {
    transparent = false,
    dither = true,
    alphaThreshold = ALPHA_THRESHOLD,
  }: { transparent?: boolean; dither?: boolean; alphaThreshold?: number } = {},
): IndexedFrame {
  const n = width * height;

  let transparentMask: Uint8Array | null = null;
  let palette: Palette;
  let transparentIndex: number;

  if (transparent) {
    transparentMask = new Uint8Array(n);
    let opaqueCount = 0;
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] < alphaThreshold) transparentMask[i] = 1;
      else opaqueCount++;
    }

    if (opaqueCount > 0) {
      // Quantize only the opaque pixels, at full RGB565 quality.
      const opaque = new Uint8ClampedArray(opaqueCount * 4);
      let j = 0;
      for (let i = 0; i < n; i++) {
        if (transparentMask[i]) continue;
        opaque[j * 4] = rgba[i * 4];
        opaque[j * 4 + 1] = rgba[i * 4 + 1];
        opaque[j * 4 + 2] = rgba[i * 4 + 2];
        opaque[j * 4 + 3] = 0xff;
        j++;
      }
      // Reserve one slot for transparency (255 opaque colors + 1).
      palette = quantize(opaque, 255, { format: "rgb565" }).map((c) =>
        c.slice(0, 3),
      );
    } else {
      palette = [];
    }
    transparentIndex = palette.length;
    palette.push([0, 0, 0]);
  } else {
    palette = quantize(rgba, 256, { format: "rgb565" }).map((c) =>
      c.slice(0, 3),
    );
    if (palette.length === 0) palette.push([0, 0, 0]);
    transparentIndex = -1;
  }

  const index = new Uint8Array(n);
  const skip = transparent ? transparentIndex : -1;
  const mask = transparentMask;

  // Memoize color→index keyed by the rgb565-quantized color, as gifenc's
  // applyPalette does: the palette is per-frame, so the cache is too. -1 = miss.
  const cache = new Int16Array(65536).fill(-1);

  if (!dither) {
    for (let i = 0; i < n; i++) {
      if (mask && mask[i]) {
        index[i] = transparentIndex;
        continue;
      }
      const r = rgba[i * 4],
        g = rgba[i * 4 + 1],
        b = rgba[i * 4 + 2];
      const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
      let idx = cache[key];
      if (idx < 0) idx = cache[key] = nearestIndex(palette, r, g, b, skip);
      index[i] = idx;
    }
    return { index, palette, transparentIndex };
  }

  // Floyd–Steinberg error diffusion over a working RGB copy.
  const buf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    buf[i * 3] = rgba[i * 4];
    buf[i * 3 + 1] = rgba[i * 4 + 1];
    buf[i * 3 + 2] = rgba[i * 4 + 2];
  }

  const diffuse = (
    x: number,
    y: number,
    er: number,
    eg: number,
    eb: number,
    w: number,
  ) => {
    if (x < 0 || x >= width || y >= height) return;
    const j = y * width + x;
    if (mask && mask[j]) return;
    buf[j * 3] += er * w;
    buf[j * 3 + 1] += eg * w;
    buf[j * 3 + 2] += eb * w;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask && mask[i]) {
        index[i] = transparentIndex;
        continue;
      }
      const r = buf[i * 3] < 0 ? 0 : buf[i * 3] > 255 ? 255 : buf[i * 3];
      const g =
        buf[i * 3 + 1] < 0 ? 0 : buf[i * 3 + 1] > 255 ? 255 : buf[i * 3 + 1];
      const b =
        buf[i * 3 + 2] < 0 ? 0 : buf[i * 3 + 2] > 255 ? 255 : buf[i * 3 + 2];
      const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
      let idx = cache[key];
      if (idx < 0) idx = cache[key] = nearestIndex(palette, r, g, b, skip);
      index[i] = idx;
      const pc = palette[idx];
      const er = r - pc[0];
      const eg = g - pc[1];
      const eb = b - pc[2];
      diffuse(x + 1, y, er, eg, eb, 7 / 16);
      diffuse(x - 1, y + 1, er, eg, eb, 3 / 16);
      diffuse(x, y + 1, er, eg, eb, 5 / 16);
      diffuse(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }

  return { index, palette, transparentIndex };
}

/**
 * Render `source` offline to a downloadable GIF (Uint8Array of GIF bytes).
 * The timeline is a pure function of time, so a throwaway player seeks
 * frame-by-frame across [0, duration] and each frame is encoded.
 */
export async function exportGif(
  source: string,
  { onProgress, durationMs, scale = 1, signal }: ExportOptions = {},
): Promise<Uint8Array> {
  const scene = createExportLoop(source, "gif", { durationMs, scale });
  const { loop, width, height, duration } = scene;
  const ctx = scene.canvas.getContext("2d")!;
  const plan = planGif(duration);
  // Sample at real wall-clock time so playback speed matches the scene.
  const times = Array.from({ length: plan.frameCount }, (_, i) =>
    Math.min(i * plan.delayMs, duration),
  );
  await prewarmImages(scene, times);

  const gif = GIFEncoder();

  for (let i = 0; i < times.length; i++) {
    throwIfAborted(signal);
    loop.seek(times[i]);

    const { data } = ctx.getImageData(0, 0, width, height);
    const { index, palette, transparentIndex } = quantizeFrame(
      data,
      width,
      height,
      { transparent: true },
    );

    gif.writeFrame(index, width, height, {
      palette,
      delay: plan.delayMs,
      repeat: 0,
      // Restore-to-background between transparent frames so they don't smear.
      dispose: 2,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
    });

    onProgress?.((i + 1) / plan.frameCount);
    // Yield so the main-thread progress label can repaint between frames; in a
    // worker there's no UI to repaint, so skip the yield.
    if (typeof document !== "undefined")
      await new Promise((r) => setTimeout(r, 0));
  }

  gif.finish();
  return gif.bytes();
}

/** {@link exportGif} in a Web Worker, falling back to inline where unsupported. */
export function exportGifInWorker(
  source: string,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  return runExportWorker("gif", source, options, exportGif);
}

export function downloadGif(bytes: Uint8Array, filename = "scene.gif"): void {
  downloadBytes(bytes, filename, "image/gif");
}
