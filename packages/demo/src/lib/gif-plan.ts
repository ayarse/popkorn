export interface GifPlan {
  /** True effective frames-per-second (1000 / delayMs, since delayMs is centisecond-snapped). */
  fps: number;
  /** Number of frames to render. */
  frameCount: number;
  /** Per-frame delay in milliseconds (GIF timing). Always a multiple of 10, minimum 20. */
  delayMs: number;
}

const CENTISECOND = 10;
const MIN_DELAY_MS = 20;

function snapDelayMs(rawDelayMs: number): number {
  return Math.max(
    MIN_DELAY_MS,
    Math.round(rawDelayMs / CENTISECOND) * CENTISECOND,
  );
}

/**
 * Pick a frame budget for a scene of `durationMs`. Targets `fps` (50, GIF's
 * practical max since delay is stored in centiseconds), snapped to the
 * nearest centisecond delay (min 20ms — browsers clamp shorter delays to
 * 100ms). Reports the TRUE effective fps derived from that snapped delay so
 * playback speed never lies. Caps total frames at `maxFrames` (~1200) by
 * lengthening the delay (still centisecond-snapped) for long scenes, so a
 * 60s scene doesn't demand 3000 frames. A static scene (duration <= 0)
 * exports a single frame.
 */
export function planGif(
  durationMs: number,
  { fps = 50, maxFrames = 1200 }: { fps?: number; maxFrames?: number } = {},
): GifPlan {
  const delayMs = snapDelayMs(1000 / fps);

  if (durationMs <= 0) {
    return { fps: 1000 / delayMs, frameCount: 1, delayMs };
  }

  let effectiveDelayMs = delayMs;
  let frameCount = Math.max(1, Math.round(durationMs / effectiveDelayMs));

  if (frameCount > maxFrames) {
    effectiveDelayMs = snapDelayMs(durationMs / maxFrames);
    frameCount = Math.max(1, Math.round(durationMs / effectiveDelayMs));
  }

  return {
    fps: 1000 / effectiveDelayMs,
    frameCount,
    delayMs: effectiveDelayMs,
  };
}
