import type { Color, PathCommand, Matrix3x3 } from './types';

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

  // Style (called before draw)
  setFill(color: Color | null): void;
  setStroke(color: Color | null, width: number): void;
  setOpacity(opacity: number): void;

  // Transform stack
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void; // radians
  scale(sx: number, sy: number): void;
  setTransform(matrix: Matrix3x3): void;

  // Canvas dimensions
  getWidth(): number;
  getHeight(): number;
}
