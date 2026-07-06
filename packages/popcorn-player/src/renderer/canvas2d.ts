import type { Renderer } from './interface';
import type { Color, PathCommand, Matrix3x3, GradientData, ResolvedClip, TrimDescriptor } from './types';
import type { StrokeLineCap } from '../scene/types';
import { colorToCSS } from './types';
import { applyCommandsToPath, computePathBounds } from '../scene/path-parser';

type Bounds = { x: number; y: number; width: number; height: number };

/**
 * Canvas 2D implementation of the Renderer interface
 * Used for the PoC - can be swapped for ThorVG later
 */
export class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private fillColor: string | null = '#000000';
  private strokeColor: string | null = null;
  private strokeWidth: number = 1;
  private fillGradient: GradientData | null = null;
  private strokeGradient: GradientData | null = null;
  private lineCap: StrokeLineCap = 'butt';
  private trim: TrimDescriptor | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  beginFrame(): void {
    this.clear();
    // Reset state
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
  }

  endFrame(): void {
    // No-op for Canvas2D (immediate mode)
  }

  drawRect(x: number, y: number, w: number, h: number, rx = 0, ry = 0): void {
    this.ctx.beginPath();
    if (rx > 0 || ry > 0) {
      // Use roundRect for rounded corners
      this.ctx.roundRect(x, y, w, h, [rx, ry]);
    } else {
      this.ctx.rect(x, y, w, h);
    }
    this.applyFillAndStroke({ x, y, width: w, height: h });
  }

  drawCircle(cx: number, cy: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.applyFillAndStroke({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 });
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number): void {
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.applyFillAndStroke({ x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 });
  }

  drawPath(commands: PathCommand[]): void {
    this.ctx.beginPath();
    applyCommandsToPath(this.ctx, commands);
    this.applyFillAndStroke(computePathBounds(commands));
  }

  clip(clip: ResolvedClip): void {
    const path = new Path2D();
    switch (clip.type) {
      case 'rect':
        path.rect(clip.x, clip.y, clip.width, clip.height);
        break;
      case 'circle':
        path.arc(clip.cx, clip.cy, clip.r, 0, Math.PI * 2);
        break;
      case 'path':
        applyCommandsToPath(path, clip.commands);
        break;
    }
    this.ctx.clip(path);
  }

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

  setTrim(trim: TrimDescriptor | null): void {
    this.trim = trim;
  }

  setOpacity(opacity: number): void {
    this.ctx.globalAlpha = opacity;
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }

  rotate(angle: number): void {
    this.ctx.rotate(angle);
  }

  scale(sx: number, sy: number): void {
    this.ctx.scale(sx, sy);
  }

  transform(m: Matrix3x3): void {
    // Matrix3x3 is [a, b, tx, c, d, ty, 0, 0, 1]
    // Canvas transform takes (a, b, c, d, e, f) = (a, c, b, d, tx, ty)
    this.ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
  }

  setTransform(m: Matrix3x3): void {
    // Matrix3x3 is [a, b, tx, c, d, ty, 0, 0, 1]
    // Canvas setTransform takes (a, b, c, d, e, f) = (a, c, b, d, tx, ty)
    this.ctx.setTransform(m[0], m[3], m[1], m[4], m[2], m[5]);
  }

  getWidth(): number {
    return this.ctx.canvas.width;
  }

  getHeight(): number {
    return this.ctx.canvas.height;
  }

  private applyFillAndStroke(bounds: Bounds): void {
    // Fill is always drawn untrimmed (trim affects the stroke only, like Lottie).
    // Gradient wins over solid color when present.
    if (this.fillGradient) {
      this.ctx.fillStyle = this.realizeGradient(this.fillGradient, bounds);
      this.ctx.fill();
    } else if (this.fillColor) {
      this.ctx.fillStyle = this.fillColor;
      this.ctx.fill();
    }

    const stroke = this.strokeGradient
      ? this.realizeGradient(this.strokeGradient, bounds)
      : this.strokeColor;
    if (!stroke) return;

    // An empty trim window strokes nothing.
    if (this.trim && !this.trim.visible) return;

    // Trim maps to a dash pattern over the outline; reset it per stroke so it
    // can't leak to the next shape.
    if (this.trim && this.trim.dashArray.length > 0) {
      this.ctx.setLineDash(this.trim.dashArray);
      this.ctx.lineDashOffset = this.trim.dashOffset;
    } else {
      this.ctx.setLineDash([]);
      this.ctx.lineDashOffset = 0;
    }

    this.ctx.lineCap = this.lineCap;
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.strokeWidth;
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  /**
   * Realize a gradient descriptor against a shape's local bounding box.
   * Linear angle follows CSS: 0deg = up, 90deg = right. Radial is centered on
   * the box with radius = half the box diagonal.
   */
  private realizeGradient(g: GradientData, b: Bounds): CanvasGradient {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    let grad: CanvasGradient;

    if (g.type === 'linear-gradient') {
      const rad = (g.angle * Math.PI) / 180;
      const dx = Math.sin(rad);
      const dy = -Math.cos(rad);
      const len = Math.abs(b.width * dx) + Math.abs(b.height * dy);
      grad = this.ctx.createLinearGradient(
        cx - (dx * len) / 2, cy - (dy * len) / 2,
        cx + (dx * len) / 2, cy + (dy * len) / 2
      );
    } else {
      const r = Math.hypot(b.width, b.height) / 2;
      grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    }

    for (const stop of g.stops) {
      grad.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
    }
    return grad;
  }
}
