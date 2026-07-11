import type { Matrix3x3 } from "../renderer/types";

/**
 * How the scene box is fitted into the host element, mirroring CSS object-fit.
 * - contain: letterbox, centered (the default)
 * - cover:   crop to fill, centered
 * - fill:    stretch each axis independently
 * - none:    1:1 scene pixels, top-left (may clip)
 */
export type FitMode = "contain" | "cover" | "fill" | "none";

/**
 * Per-axis scale plus a device-pixel offset that maps scene coords into the
 * canvas backing store: deviceX = offsetX + sceneX * scaleX (same for y). Scale
 * folds in the fit ratio *and* devicePixelRatio, so the canvas stays crisp.
 */
export interface Viewport {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export const IDENTITY_VIEWPORT: Viewport = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};

/**
 * Compute the viewport that fits a sceneW×sceneH scene into an elemW×elemH CSS
 * element rendered on a canvas of elemW×elemH*dpr device pixels, per `fit`.
 * Pure: no DOM. A degenerate scene (0 size) falls back to a 1:1 dpr mapping.
 */
export function computeViewport(
  sceneW: number,
  sceneH: number,
  elemW: number,
  elemH: number,
  dpr: number,
  fit: FitMode,
): Viewport {
  const dw = elemW * dpr;
  const dh = elemH * dpr;
  if (sceneW <= 0 || sceneH <= 0) {
    return { scaleX: dpr, scaleY: dpr, offsetX: 0, offsetY: 0 };
  }
  const sx = dw / sceneW;
  const sy = dh / sceneH;

  switch (fit) {
    case "fill":
      return { scaleX: sx, scaleY: sy, offsetX: 0, offsetY: 0 };
    case "none":
      // 1:1 scene pixels (scaled only by dpr), pinned top-left.
      return { scaleX: dpr, scaleY: dpr, offsetX: 0, offsetY: 0 };
    case "cover": {
      const s = Math.max(sx, sy);
      return {
        scaleX: s,
        scaleY: s,
        offsetX: (dw - sceneW * s) / 2,
        offsetY: (dh - sceneH * s) / 2,
      };
    }
    case "contain":
    default: {
      const s = Math.min(sx, sy);
      return {
        scaleX: s,
        scaleY: s,
        offsetX: (dw - sceneW * s) / 2,
        offsetY: (dh - sceneH * s) / 2,
      };
    }
  }
}

/** The device-space root transform matrix for a viewport (translate ∘ scale). */
export function viewportMatrix(vp: Viewport): Matrix3x3 {
  return [vp.scaleX, 0, vp.offsetX, 0, vp.scaleY, vp.offsetY, 0, 0, 1];
}

/** Inverse of the viewport: map a device-pixel point back to scene coords. */
export function deviceToScene(
  vp: Viewport,
  deviceX: number,
  deviceY: number,
): { x: number; y: number } {
  return {
    x: (deviceX - vp.offsetX) / vp.scaleX,
    y: (deviceY - vp.offsetY) / vp.scaleY,
  };
}
