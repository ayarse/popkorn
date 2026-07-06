import type { Color, PathCommand, Matrix3x3, GradientData, ResolvedClip, TrimDescriptor } from './types';
import type { StrokeLineCap, TextAnchor } from '../scene/types';

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

  // Clip the current node and its descendants to a region (in local space).
  clip(clip: ResolvedClip): void;

  // Style (called before draw)
  setFill(color: Color | null): void;
  setFillGradient(gradient: GradientData | null): void;
  setStroke(color: Color | null, width: number): void;
  setStrokeGradient(gradient: GradientData | null): void;
  setStrokeLineCap(cap: StrokeLineCap): void;
  // Trim the stroke to a sub-range of the outline; null strokes the whole outline.
  setTrim(trim: TrimDescriptor | null): void;
  setOpacity(opacity: number): void;

  // Transform stack
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void; // radians
  scale(sx: number, sy: number): void;
  transform(matrix: Matrix3x3): void; // multiply current transform by matrix
  setTransform(matrix: Matrix3x3): void;

  // Canvas dimensions
  getWidth(): number;
  getHeight(): number;
}
