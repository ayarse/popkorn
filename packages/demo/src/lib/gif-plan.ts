export interface GifPlan {
  /** Effective frames-per-second (may be lowered from the target for long scenes). */
  fps: number;
  /** Number of frames to render. */
  frameCount: number;
  /** Per-frame delay in milliseconds (GIF timing). */
  delayMs: number;
}

/**
 * Pick a frame budget for a scene of `durationMs`. Aims for `fps` (30), but
 * caps total frames at `maxFrames` (~300) by lowering the fps for long scenes,
 * so a 20s scene stays a reasonable file instead of 600 frames. A static scene
 * (duration 0) exports a single frame.
 */
export function planGif(
  durationMs: number,
  { fps = 30, maxFrames = 300 }: { fps?: number; maxFrames?: number } = {},
): GifPlan {
  if (durationMs <= 0) {
    return { fps, frameCount: 1, delayMs: Math.round(1000 / fps) };
  }
  let frameCount = Math.max(1, Math.round((durationMs / 1000) * fps));
  if (frameCount > maxFrames) {
    frameCount = maxFrames;
    fps = frameCount / (durationMs / 1000);
  }
  return { fps, frameCount, delayMs: Math.round(1000 / fps) };
}
