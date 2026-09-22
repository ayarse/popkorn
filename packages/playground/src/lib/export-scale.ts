import type { Matrix3x3 } from "@popkorn/player";

export const EXPORT_SCALES = [1, 2, 3] as const;

/**
 * Output frame size and scene->device viewport for rendering a stage at
 * `scale`×. `fit` rounds each pixel dimension (MP4 passes evenDim).
 */
export function scaledFrame(
  stageWidth: number,
  stageHeight: number,
  scale: number,
  fit: (px: number) => number = Math.round,
): { width: number; height: number; viewport: Matrix3x3 } {
  return {
    width: fit(stageWidth * scale),
    height: fit(stageHeight * scale),
    viewport: [scale, 0, 0, 0, scale, 0, 0, 0, 1],
  };
}
