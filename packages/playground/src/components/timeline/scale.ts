// Pure time<->pixel math + accent palette for the editor timeline. Kept
// dependency-free (no React) so it's unit-testable and so ruler, pills,
// diamonds and the playhead all share ONE `msToPx` (via `pxPerMs`).

/** Base pixels-per-millisecond at zoom = 1 — so 1s renders as 100px. */
export const PX_PER_MS = 0.1;

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 8;

/** Pixels-per-ms for a zoom multiplier. Everything spatial derives from this. */
export function pxPerMs(zoom: number): number {
  return PX_PER_MS * zoom;
}

/** Candidate ruler steps in ms, ascending (1-2-5 per decade). */
const STEPS = [
  10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10_000, 20_000, 30_000,
  60_000, 120_000, 300_000,
];

/**
 * Smallest tick step (ms) whose on-screen width is at least `minPx`, so labels
 * stay ~80px apart and never crowd. `ppm` is pixels-per-ms.
 */
export function tickStep(ppm: number, minPx = 80): number {
  for (const s of STEPS) if (s * ppm >= minPx) return s;
  return STEPS[STEPS.length - 1];
}

/** Tick marks (ms) covering `[0, end]` at the given step, inclusive of 0. */
export function ticks(end: number, step: number): number[] {
  const out: number[] = [];
  for (let t = 0; t <= end + 0.5; t += step) out.push(t);
  return out;
}

/** Per-layer accent hue (deg), cycled by track index; readable on dark + light. */
const LAYER_HUES = [265, 199, 150, 45, 330, 20, 95, 285];

export function layerHue(i: number): number {
  return LAYER_HUES[
    ((i % LAYER_HUES.length) + LAYER_HUES.length) % LAYER_HUES.length
  ];
}

/** Format ms as seconds with two decimals (e.g. `1.24s`). */
export function fmtSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

/** Snap a millisecond value to the nearest `grid` ms (default 10ms). */
export function snapMs(ms: number, grid = 10): number {
  return Math.round(ms / grid) * grid;
}
