import type { Matrix3x3 } from "../scene/matrix.js";

/** CSS object-fit semantics (default contain); `none` is 1:1 pinned top-left. */
export type FitMode = "contain" | "cover" | "fill" | "none";

/** deviceX = offsetX + sceneX * scaleX; scale folds in both fit ratio and DPR. */
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

/** Pure; a 0-size scene falls back to a 1:1 dpr mapping. */
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
  // `none`: 1:1 scene pixels (scaled only by dpr), pinned top-left.
  if (sceneW <= 0 || sceneH <= 0 || fit === "none") {
    return { scaleX: dpr, scaleY: dpr, offsetX: 0, offsetY: 0 };
  }
  const sx = dw / sceneW;
  const sy = dh / sceneH;
  if (fit === "fill") return { scaleX: sx, scaleY: sy, offsetX: 0, offsetY: 0 };
  const s = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  return {
    scaleX: s,
    scaleY: s,
    offsetX: (dw - sceneW * s) / 2,
    offsetY: (dh - sceneH * s) / 2,
  };
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
