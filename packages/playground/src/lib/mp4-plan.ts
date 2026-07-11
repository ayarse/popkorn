export interface Mp4Plan {
  /** Frames per second of the output video. */
  fps: number;
  /** Number of frames to render. */
  frameCount: number;
  /** Per-frame presentation duration in microseconds (WebCodecs timestamps). */
  frameDurationUs: number;
  /** Per-frame sample delay in milliseconds (scene-time step). */
  delayMs: number;
}

// NOTE: fixed 30fps target — no fps picker, matching the GIF exporter's
// single-knob simplicity. Long scenes cap total frames by stretching the
// delay (lowering effective fps) so a 10min scene doesn't demand 18000 frames.
const DEFAULT_FPS = 30;
const MAX_FRAMES = 1800;

/**
 * Pick a frame budget for a scene of `durationMs` at `fps`. Mirrors
 * {@link planGif}: sample time `i * delayMs` per frame, cap total frames at
 * `maxFrames` by lengthening the delay for very long scenes. A static scene
 * (duration <= 0) exports a single frame.
 */
export function planMp4(
  durationMs: number,
  {
    fps = DEFAULT_FPS,
    maxFrames = MAX_FRAMES,
  }: { fps?: number; maxFrames?: number } = {},
): Mp4Plan {
  let delayMs = 1000 / fps;

  if (durationMs <= 0) {
    return {
      fps,
      frameCount: 1,
      delayMs,
      frameDurationUs: Math.round(delayMs * 1000),
    };
  }

  let frameCount = Math.max(1, Math.round(durationMs / delayMs));
  if (frameCount > maxFrames) {
    delayMs = durationMs / maxFrames;
    frameCount = Math.max(1, Math.round(durationMs / delayMs));
  }

  return {
    fps: 1000 / delayMs,
    frameCount,
    delayMs,
    frameDurationUs: Math.round(delayMs * 1000),
  };
}

/** H.264 needs even dimensions; round down to the nearest even (min 2). */
export function evenDim(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

// Smallest H.264 level (baseline profile) whose max macroblocks-per-frame
// covers the given frame size, as `[maxMacroblocks, levelByte]`. Level byte is
// the trailing pair of the `avc1.4200LL` codec string.
const LEVELS: readonly [number, number][] = [
  [1620, 0x1e], // 3.0
  [3600, 0x1f], // 3.1
  [5120, 0x20], // 3.2
  [8192, 0x28], // 4.0
  [8704, 0x2a], // 4.2
  [22080, 0x32], // 5.0
  [36864, 0x33], // 5.1
];

/**
 * Pick a baseline-profile H.264 codec string sized to `width`×`height`, e.g.
 * `avc1.42001e` (level 3.0) for a 400×300 stage. Falls back to level 5.1 for
 * anything larger than that level covers.
 */
export function avcCodec(width: number, height: number): string {
  const mb = Math.ceil(width / 16) * Math.ceil(height / 16);
  let level = LEVELS[LEVELS.length - 1][1];
  for (const [maxMb, lv] of LEVELS) {
    if (mb <= maxMb) {
      level = lv;
      break;
    }
  }
  return `avc1.4200${level.toString(16).padStart(2, "0")}`;
}
