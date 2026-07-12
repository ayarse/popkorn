import type {
  BlendMode,
  FillRule,
  PaintOrder,
  StrokeLineCap,
  StrokeLineJoin,
} from "../scene/types";
import type { Color, GradientData, Matrix3x3, TrimDescriptor } from "./types";
import {
  colorToCSS,
  IDENTITY_MATRIX,
  invertMatrix,
  multiplyMatrices,
} from "./types";

/**
 * Shared sticky paint state + an opt-in JS CTM mirror for the renderer backends.
 * The loop drives the `set*` calls before each draw; the backend reads these
 * protected fields at draw time. This exists so the ~14 paint fields and their
 * setters live in one place instead of a hand-copied (and drifting) triple.
 *
 * The CTM mirror (ctm + stack) is only used by backends whose surface has no
 * absolute setMatrix — SVG (<g> transforms) and Skia (SkCanvas.concat is
 * relative). Canvas2D delegates save/restore/transform straight to the native
 * ctx and leaves these mirror helpers unused.
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
  // Sticky like the rest; the loop sets it before a node's shape draw and resets
  // it to 'normal' after. Backends read `blendMode` at draw (Canvas gCO, SVG
  // element style, Skia paint) — a subclass may override to apply it eagerly.
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
  /** Reach the ABSOLUTE matrix `m` from a relative-only surface: returns the
   *  delta (invert(ctm)·m) for the backend to concat, and advances the mirror. */
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
