import type { Matrix3x3 } from "../scene/matrix.js";
import {
  IDENTITY_MATRIX,
  invertMatrix,
  multiplyMatrices,
} from "../scene/matrix.js";
import type {
  BlendMode,
  FillRule,
  MaskMode,
  PaintOrder,
  StrokeLineCap,
  StrokeLineJoin,
} from "../scene/types.js";
import type { Color, GradientData, TrimDescriptor } from "./types.js";
import { colorToCSS } from "./types.js";

// Track-matte mode decoded into its luminance/invert axes (shared constants, no per-call allocation).
export interface MaskModeParts {
  readonly luminance: boolean;
  readonly invert: boolean;
}
const MASK_MODE_PARTS: Record<MaskMode, MaskModeParts> = {
  alpha: { luminance: false, invert: false },
  luminance: { luminance: true, invert: false },
  "alpha-invert": { luminance: false, invert: true },
  "luminance-invert": { luminance: true, invert: true },
};

export function maskModeParts(mode: MaskMode): MaskModeParts {
  return MASK_MODE_PARTS[mode];
}

/**
 * Shared sticky paint state (set* before each draw, read at draw time) plus an
 * opt-in CTM mirror for surfaces without absolute setMatrix (SVG, Skia).
 */
export abstract class PaintStateRenderer {
  protected fillColor: string | null = "#000000";
  protected strokeColor: string | null = null;
  protected strokeWidth = 1;
  protected fillGradient: GradientData | null = null;
  protected strokeGradient: GradientData | null = null;
  protected lineCap: StrokeLineCap = "butt";
  protected lineJoin: StrokeLineJoin = "miter";
  protected miterLimit = 4;
  protected trim: TrimDescriptor | null = null;
  protected dashArray: number[] = [];
  protected dashOffset = 0;
  protected fillRule: FillRule = "nonzero";
  protected paintOrder: PaintOrder = "normal";
  protected opacity = 1;
  protected blendMode: BlendMode = "normal";

  setFill(color: Color | null): void {
    this.fillColor = color ? colorToCSS(color) : null;
  }
  setFillGradient(gradient: GradientData | null): void {
    this.fillGradient = gradient;
  }
  setStroke(color: Color | null, width: number): void {
    this.strokeColor = color ? colorToCSS(color) : null;
    this.strokeWidth = width;
  }
  setStrokeGradient(gradient: GradientData | null): void {
    this.strokeGradient = gradient;
  }
  setStrokeLineCap(cap: StrokeLineCap): void {
    this.lineCap = cap;
  }
  setStrokeLineJoin(join: StrokeLineJoin): void {
    this.lineJoin = join;
  }
  setStrokeMiterLimit(limit: number): void {
    this.miterLimit = limit;
  }
  setTrim(trim: TrimDescriptor | null): void {
    this.trim = trim;
  }
  setDash(dashArray: number[], dashOffset: number): void {
    this.dashArray = dashArray;
    this.dashOffset = dashOffset;
  }
  setFillRule(rule: FillRule): void {
    this.fillRule = rule;
  }
  setPaintOrder(order: PaintOrder): void {
    this.paintOrder = order;
  }
  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }
  // Sticky; the loop sets it before a shape draw and resets to 'normal' after.
  setBlendMode(mode: BlendMode): void {
    this.blendMode = mode;
  }

  // --- opt-in JS CTM mirror (SVG/Skia). Canvas2D leaves these untouched. ---
  protected ctm: Matrix3x3 = IDENTITY_MATRIX;
  protected ctmStack: Matrix3x3[] = [];
  protected pushCtm(): void {
    this.ctmStack.push(this.ctm);
  }
  protected popCtm(): void {
    this.ctm = this.ctmStack.pop() ?? IDENTITY_MATRIX;
  }
  protected concatCtm(m: Matrix3x3): void {
    this.ctm = multiplyMatrices(this.ctm, m);
  }
  /** Delta (invert(ctm)·m) to concat on a relative-only surface to reach absolute `m`. */
  protected setCtmAbsolute(m: Matrix3x3): Matrix3x3 {
    const delta = multiplyMatrices(invertMatrix(this.ctm), m);
    this.ctm = m;
    return delta;
  }
  protected resetCtm(): void {
    this.ctm = IDENTITY_MATRIX;
    this.ctmStack.length = 0;
  }
}
