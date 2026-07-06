import type { Renderer } from './interface';
import type { Color, PathCommand, Matrix3x3, GradientData, ResolvedClip, TrimDescriptor } from './types';
import type { StrokeLineCap, TextAnchor, FillRule, MatteMode, PaintOrder } from '../scene/types';
import { colorToCSS } from './types';
import { applyCommandsToPath, computePathBounds } from '../scene/path-parser';

type Bounds = { x: number; y: number; width: number; height: number };

/**
 * Canvas 2D implementation of the Renderer interface
 * Used for the PoC - can be swapped for ThorVG later
 */
// Cache entry for a loaded (or loading) image, keyed by src.
interface ImageEntry {
  img: HTMLImageElement;
  loaded: boolean;
  errored: boolean;
}

export class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  // Image cache and lazily-created offscreen buffers for track mattes.
  private images = new Map<string, ImageEntry>();
  private offscreen: (CanvasRenderingContext2D | null)[] = [];
  private fillColor: string | null = '#000000';
  private strokeColor: string | null = null;
  private strokeWidth: number = 1;
  private fillGradient: GradientData | null = null;
  private strokeGradient: GradientData | null = null;
  private lineCap: StrokeLineCap = 'butt';
  private trim: TrimDescriptor | null = null;
  private dashArray: number[] = [];
  private dashOffset: number = 0;
  private fillRule: FillRule = 'nonzero';
  private paintOrder: PaintOrder = 'normal';

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
    // Reset to identity/device space FIRST, then clear — clearRect is affected
    // by the current transform, so clearing before resetting would wipe only the
    // scene rect under the leftover viewport transform and leave stale pixels in
    // the letterbox band (a transient ghost that self-heals on a later repaint).
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.clear();
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

  drawText(text: string, x: number, y: number, fontSize: number, fontFamily: string, fontWeight: string, anchor: TextAnchor): void {
    this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    this.ctx.textAlign = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
    this.ctx.textBaseline = 'alphabetic';

    // Bounding box (for gradients) mirrors scene/transform.getShapeBounds.
    const width = this.ctx.measureText(text).width;
    const ax = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    const bounds: Bounds = { x: ax, y: y - fontSize, width, height: fontSize };

    if (this.fillGradient) {
      this.ctx.fillStyle = this.realizeGradient(this.fillGradient, bounds);
      this.ctx.fillText(text, x, y);
    } else if (this.fillColor) {
      this.ctx.fillStyle = this.fillColor;
      this.ctx.fillText(text, x, y);
    }

    const stroke = this.strokeGradient
      ? this.realizeGradient(this.strokeGradient, bounds)
      : this.strokeColor;
    if (stroke) {
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = this.strokeWidth;
      this.ctx.strokeText(text, x, y);
    }
  }

  drawImage(src: string, x: number, y: number, w: number, h: number): void {
    if (!src || typeof Image === 'undefined') return; // headless: node is inert
    let entry = this.images.get(src);
    if (!entry) {
      const img = new Image();
      entry = { img, loaded: false, errored: false };
      this.images.set(src, entry);
      img.onload = () => { entry!.loaded = true; };
      img.onerror = () => {
        entry!.errored = true;
        console.warn(`Canvas2DRenderer: failed to load image ${src.slice(0, 64)}`);
      };
      img.src = src;
    }
    if (!entry.loaded) return; // repaints in once the running loop sees it decoded
    const dw = w > 0 ? w : entry.img.naturalWidth;
    const dh = h > 0 ? h : entry.img.naturalHeight;
    this.ctx.drawImage(entry.img, x, y, dw, dh);
  }

  compositeMatte(mode: MatteMode, drawContent: () => void, drawMatte: () => void): void {
    const a = this.ensureOffscreen(0);
    const b = this.ensureOffscreen(1);
    if (!a || !b) { drawContent(); return; } // headless / no offscreen: content only

    const main = this.ctx;

    // Content -> A, matte source -> B; each closure sets its own world transform.
    this.ctx = a;
    this.beginFrame();
    drawContent();

    this.ctx = b;
    this.beginFrame();
    drawMatte();

    // Turn a luma matte into an alpha matte in place, so a single
    // destination-in/out handles every mode.
    if (mode === 'luma' || mode === 'luma-invert') lumaToAlpha(b);

    // destination-in keeps content where the matte is opaque; destination-out
    // keeps it where the matte is transparent (the *-invert variants).
    const invert = mode === 'alpha-invert' || mode === 'luma-invert';
    a.save();
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = invert ? 'destination-out' : 'destination-in';
    a.drawImage(b.canvas, 0, 0);
    a.globalCompositeOperation = 'source-over';
    a.restore();

    // Blit the matted result onto the main canvas at identity (A already holds
    // world-positioned pixels).
    this.ctx = main;
    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.globalAlpha = 1;
    main.drawImage(a.canvas, 0, 0);
    main.restore();
  }

  /** Lazily create/resize an offscreen 2D context sized to the main canvas. */
  private ensureOffscreen(index: number): CanvasRenderingContext2D | null {
    const w = this.ctx.canvas.width, h = this.ctx.canvas.height;
    let ctx = this.offscreen[index];
    if (ctx === undefined) {
      ctx = createOffscreen(w, h);
      this.offscreen[index] = ctx;
    }
    if (ctx && (ctx.canvas.width !== w || ctx.canvas.height !== h)) {
      ctx.canvas.width = w;
      ctx.canvas.height = h;
    }
    return ctx;
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
    this.ctx.clip(path, this.fillRule);
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
    // paint-order: stroke draws the stroke first so the fill sits on top of it
    // (only the stroke's exposed outer edge shows) — otherwise fill then stroke.
    if (this.paintOrder === 'stroke') {
      this.strokePath(bounds);
      this.fillPath(bounds);
    } else {
      this.fillPath(bounds);
      this.strokePath(bounds);
    }
  }

  private fillPath(bounds: Bounds): void {
    // Fill is always drawn untrimmed (trim affects the stroke only, like Lottie).
    // Gradient wins over solid color when present.
    if (this.fillGradient) {
      this.ctx.fillStyle = this.realizeGradient(this.fillGradient, bounds);
      this.ctx.fill(this.fillRule);
    } else if (this.fillColor) {
      this.ctx.fillStyle = this.fillColor;
      this.ctx.fill(this.fillRule);
    }
  }

  private strokePath(bounds: Bounds): void {
    const stroke = this.strokeGradient
      ? this.realizeGradient(this.strokeGradient, bounds)
      : this.strokeColor;
    if (!stroke) return;

    // An empty trim window strokes nothing.
    if (this.trim && !this.trim.visible) return;

    // Trim maps to a dash pattern over the outline; reset it per stroke so it
    // can't leak to the next shape. Trim wins over an authored stroke-dasharray
    // when both are set (both use the single Canvas dash slot).
    // ponytail: composing an authored dash *within* a trim window (dash-of-a-dash)
    // is the real upgrade path; for now trim simply overrides the dash array.
    if (this.trim && this.trim.dashArray.length > 0) {
      this.ctx.setLineDash(this.trim.dashArray);
      this.ctx.lineDashOffset = this.trim.dashOffset;
    } else if (!this.trim && this.dashArray.length > 0) {
      this.ctx.setLineDash(this.dashArray);
      this.ctx.lineDashOffset = this.dashOffset;
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

/** A blank offscreen 2D context sized w×h, or null when no canvas API exists. */
function createOffscreen(w: number, h: number): CanvasRenderingContext2D | null {
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      return canvas.getContext('2d');
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Rewrite a buffer's alpha to its per-pixel luminance (×existing alpha), so a
 * luma matte can be applied with the same destination-in/out path as an alpha
 * matte. One getImageData/putImageData pass.
 *
 * ponytail: a filter-only fast path (`ctx.filter = 'grayscale(1)'` + a luminance
 * blend) would avoid the CPU round-trip; the pixel loop is the simple version.
 */
function lumaToAlpha(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas;
  if (width === 0 || height === 0) return;
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, width, height);
  } catch {
    return; // tainted canvas — leave as-is (treated as an alpha matte)
  }
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    px[i + 3] = (px[i + 3] * lum) / 255;
  }
  ctx.putImageData(data, 0, 0);
}
