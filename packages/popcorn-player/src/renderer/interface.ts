import type { Color, PathCommand, Matrix3x3, GradientData, ResolvedClip, TrimDescriptor } from './types';
import type { StrokeLineCap, StrokeLineJoin, TextAnchor, FillRule, MaskMode, PaintOrder } from '../scene/types';

/**
 * Abstract renderer interface (ThorVG-style)
 * This interface allows swapping between Canvas2D (PoC) and ThorVG (future)
 */
export interface Renderer {
  // Frame lifecycle
  clear(): void;
  beginFrame(): void;
  endFrame(): void;

  // Shape rendering
  drawRect(x: number, y: number, w: number, h: number, rx?: number, ry?: number): void;
  drawCircle(cx: number, cy: number, r: number): void;
  drawEllipse(cx: number, cy: number, rx: number, ry: number): void;
  drawPath(commands: PathCommand[]): void;
  drawText(text: string, x: number, y: number, fontSize: number, fontFamily: string, fontWeight: string, anchor: TextAnchor): void;
  // Draw a cached image (by src) into the x/y/w/h box. w/h <= 0 means natural
  // size. Loading/caching is the renderer's concern; nothing paints until the
  // image decodes (the running loop repaints it in naturally).
  drawImage(src: string, x: number, y: number, w: number, h: number): void;

  // Clip the current node and its descendants to a region (in local space).
  clip(clip: ResolvedClip): void;

  // Track-mask composite. Paints `drawContent` and `drawMask` into offscreen
  // buffers (each closure sets its own world transform and draws a subtree),
  // masks the content by the mask per `mode`, and blits the result to the main
  // canvas. Degrades to drawing the content alone when offscreen isn't available.
  compositeMask(mode: MaskMode, drawContent: () => void, drawMask: () => void): void;

  // Style (called before draw)
  setFill(color: Color | null): void;
  setFillGradient(gradient: GradientData | null): void;
  setStroke(color: Color | null, width: number): void;
  setStrokeGradient(gradient: GradientData | null): void;
  setStrokeLineCap(cap: StrokeLineCap): void;
  setStrokeLineJoin(join: StrokeLineJoin): void;
  setStrokeMiterLimit(limit: number): void;
  // Trim the stroke to a sub-range of the outline; null strokes the whole outline.
  setTrim(trim: TrimDescriptor | null): void;
  // Stroke dash pattern + offset. Empty array => solid stroke. Ignored while a
  // trim window is active (trim wins).
  setDash(dashArray: number[], dashOffset: number): void;
  // Fill winding rule for the next path/star/polygon fill and clip.
  setFillRule(rule: FillRule): void;
  // Paint order for the next shape: 'stroke' draws stroke behind fill.
  setPaintOrder(order: PaintOrder): void;
  setOpacity(opacity: number): void;

  // Transform stack
  save(): void;
  restore(): void;
  transform(matrix: Matrix3x3): void; // multiply current transform by matrix
  setTransform(matrix: Matrix3x3): void;

  // Canvas dimensions
  getWidth(): number;
  getHeight(): number;
}
