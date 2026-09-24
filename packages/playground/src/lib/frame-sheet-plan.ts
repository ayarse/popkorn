// Pure frame-time and grid math for the render_frames contact sheet.

export const MAX_FRAMES = 12;
export const DEFAULT_FRAMES = 6;
export const DEFAULT_CELL_WIDTH = 320;
const MIN_CELL_WIDTH = 160;
const MAX_CELL_WIDTH = 480;
// One hour caps absurd requests without rejecting long timelines.
const MAX_TIME_MS = 3_600_000;

export type SheetPlan = {
  /** Frame times in ms, in the order they're laid out. */
  timesMs: number[];
  cellWidth: number;
  cols: number;
  rows: number;
};

/** Requested seconds → frame times, or `DEFAULT_FRAMES` evenly spaced over one loop of `durationMs`. */
export function planSheet(
  args: { times?: unknown; width?: unknown },
  durationMs: number,
): SheetPlan | { error: string } {
  let timesMs: number[];
  if (args.times === undefined) {
    timesMs =
      durationMs > 0 && Number.isFinite(durationMs)
        ? Array.from({ length: DEFAULT_FRAMES }, (_, i) =>
            Math.round((i * durationMs) / DEFAULT_FRAMES),
          )
        : [0];
  } else {
    if (!Array.isArray(args.times) || args.times.length === 0) {
      return { error: "`times` must be a non-empty array of seconds." };
    }
    if (args.times.length > MAX_FRAMES) {
      return { error: `At most ${MAX_FRAMES} frames per sheet.` };
    }
    if (!args.times.every((t) => typeof t === "number" && t >= 0)) {
      return { error: "Every time must be a number of seconds ≥ 0." };
    }
    timesMs = (args.times as number[]).map((t) =>
      Math.min(MAX_TIME_MS, Math.round(t * 1000)),
    );
  }

  const width =
    typeof args.width === "number" ? args.width : DEFAULT_CELL_WIDTH;
  const cellWidth = Math.round(
    Math.min(MAX_CELL_WIDTH, Math.max(MIN_CELL_WIDTH, width)),
  );
  const cols = gridCols(timesMs.length);
  return {
    timesMs,
    cellWidth,
    cols,
    rows: Math.ceil(timesMs.length / cols),
  };
}

/** Columns for n frames: one row up to 3, then 2×2, then 3 wide, then 4 wide. */
export function gridCols(n: number): number {
  if (n <= 3) return Math.max(1, n);
  if (n === 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

/** "1.25s", trimmed to at most 2 decimals. */
export function formatSeconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(2))}s`;
}
