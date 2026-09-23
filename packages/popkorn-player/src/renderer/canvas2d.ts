import type { DeviceRect } from "../scene/bounds.js";
import type { Matrix3x3 } from "../scene/matrix.js";
import {
  applyCommandsToPath,
  computePathBounds,
} from "../scene/path-parser.js";
import type { BlendMode, MaskMode, TextAnchor } from "../scene/types.js";
import type { PaintBox } from "./gradient-geometry.js";
import { resolveGradient } from "./gradient-geometry.js";
import type { Renderer } from "./interface.js";
import { PaintStateRenderer } from "./paint-state.js";
import { paintOrderSequence, resolveStrokeDash } from "./stroke.js";
import type {
  CornerRadii,
  GradientData,
  PathCommand,
  ResolvedClip,
} from "./types.js";
import { LUMA_COEFFICIENTS } from "./types.js";

// Image cache entry by src; `img` (HTMLImageElement, or ImageBitmap in a worker) is null until decoded.
interface ImageEntry {
  img: HTMLImageElement | ImageBitmap | null;
  loaded: boolean;
  errored: boolean;
}

// A cached composite raster: buffer (pixel (0,0) = region origin), capture signature, region.
interface RasterEntry {
  ctx: CanvasRenderingContext2D;
  signature: string;
  region: DeviceRect;
}

function entryArea(e: RasterEntry): number {
  return e.ctx.canvas.width * e.ctx.canvas.height;
}

// Intrinsic size: HTMLImageElement exposes naturalWidth/Height, ImageBitmap width/height.
function imgWidth(img: HTMLImageElement | ImageBitmap): number {
  return "naturalWidth" in img ? img.naturalWidth : img.width;
}
function imgHeight(img: HTMLImageElement | ImageBitmap): number {
  return "naturalHeight" in img ? img.naturalHeight : img.height;
}

/** Canvas 2D backend of the Renderer interface. */
export class Canvas2DRenderer extends PaintStateRenderer implements Renderer {
  // The visible canvas: device-size authority (`this.ctx` may be a composite buffer).
  private main: CanvasRenderingContext2D;
  private ctx: CanvasRenderingContext2D;
  // Device coords of `this.ctx`'s pixel (0,0): region origin for a composite buffer, folded in by setTransform.
  private originX = 0;
  private originY = 0;
  private images = new Map<string, ImageEntry>();
  // In-flight image decodes; each promise settles (never rejects) on load/error.
  private pendingImages = new Set<Promise<void>>();
  private offscreen: (CanvasRenderingContext2D | null)[] = [];
  // Composite nesting depth (mask + filter share it); each level claims its own buffer band.
  private maskDepth = 0;
  // Composite raster cache; Map insertion order is the LRU order, bounded by allocated area.
  private rasters = new Map<string, RasterEntry>();
  private rasterArea = 0;
  // Admission gate: a key earns a buffer only once its signature repeats.
  private rasterAdmit = new Map<string, string>();
  // A draw during capture lacked final pixels (image/webfont pending): blit but don't store.
  private rasterIncomplete = false;
  private capturing = false;

  constructor(canvas: HTMLCanvasElement) {
    super();
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D rendering context");
    }
    this.ctx = ctx;
    this.main = ctx;
  }

  beginFrame(): void {
    // Reset to device space BEFORE clearRect, or the letterbox band keeps stale pixels.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.main.clearRect(0, 0, this.main.canvas.width, this.main.canvas.height);
    this.ctx.globalAlpha = 1;
  }

  endFrame(): void {}

  // The CSS keyword is the globalCompositeOperation, except `normal` -> `source-over`.
  setBlendMode(mode: BlendMode): void {
    super.setBlendMode(mode);
    this.ctx.globalCompositeOperation =
      mode === "normal" ? "source-over" : (mode as GlobalCompositeOperation);
  }

  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    rx = 0,
    ry = 0,
    corners?: CornerRadii,
  ): void {
    this.ctx.beginPath();
    if (corners) {
      // roundRect takes the per-corner array natively (tl, tr, br, bl).
      this.ctx.roundRect(x, y, w, h, [...corners]);
    } else if (rx > 0 || ry > 0) {
      this.ctx.roundRect(x, y, w, h, [{ x: rx, y: ry }]);
    } else {
      this.ctx.rect(x, y, w, h);
    }
    this.applyFillAndStroke({ x, y, width: w, height: h });
  }

  drawCircle(cx: number, cy: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.applyFillAndStroke({
      x: cx - r,
      y: cy - r,
      width: r * 2,
      height: r * 2,
    });
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number): void {
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.applyFillAndStroke({
      x: cx - rx,
      y: cy - ry,
      width: rx * 2,
      height: ry * 2,
    });
  }

  drawPath(commands: PathCommand[]): void {
    this.ctx.beginPath();
    applyCommandsToPath(this.ctx, commands);
    this.applyFillAndStroke(computePathBounds(commands));
  }

  drawText(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    fontFamily: string,
    fontWeight: string,
    anchor: TextAnchor,
    letterSpacing = 0,
  ): void {
    // A later-loading webfont re-shapes text with no state change, so don't store this capture.
    if (this.capturing && typeof document !== "undefined") {
      if (document.fonts && document.fonts.status !== "loaded")
        this.rasterIncomplete = true;
    }
    this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    this.ctx.textAlign =
      anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
    this.ctx.textBaseline = "alphabetic";
    // ctx.letterSpacing is sticky: set every draw so 0 clears a prior value.
    if ("letterSpacing" in this.ctx)
      this.ctx.letterSpacing = `${letterSpacing}px`;

    // Bounding box (for gradients) matches scene/transform.getShapeBounds.
    const width = this.ctx.measureText(text).width;
    const ax =
      anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    const bounds: PaintBox = {
      x: ax,
      y: y - fontSize,
      width,
      height: fontSize,
    };

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

  drawImage(
    src: string,
    x: number,
    y: number,
    w: number,
    h: number,
    sx?: number,
    sy?: number,
    sw?: number,
    sh?: number,
  ): void {
    if (!src) return;
    let entry = this.images.get(src);
    if (!entry) {
      const loaded = this.loadImage(src);
      if (!loaded) return; // fully headless (no Image, no fetch/createImageBitmap): node is inert
      entry = loaded;
    }
    if (!entry.loaded || !entry.img) {
      // Repaints once decoded; a raster captured now must not be stored.
      if (this.capturing && !entry.errored) this.rasterIncomplete = true;
      return;
    }
    // Source-cropped (object-view-box): 9-arg sample.
    if (
      sx !== undefined &&
      sy !== undefined &&
      sw !== undefined &&
      sh !== undefined
    ) {
      const dw = w > 0 ? w : sw;
      const dh = h > 0 ? h : sh;
      this.ctx.drawImage(entry.img, sx, sy, sw, sh, x, y, dw, dh);
      return;
    }
    const dw = w > 0 ? w : imgWidth(entry.img);
    const dh = h > 0 ? h : imgHeight(entry.img);
    this.ctx.drawImage(entry.img, x, y, dw, dh);
  }

  // Start a decode once per src: HTMLImageElement, or fetch -> createImageBitmap in a worker; null if neither exists.
  private loadImage(src: string): ImageEntry | null {
    if (typeof Image !== "undefined") {
      const img = new Image();
      const entry: ImageEntry = { img, loaded: false, errored: false };
      this.images.set(src, entry);
      this.trackImageLoad(
        new Promise<void>((resolve) => {
          img.onload = () => {
            entry.loaded = true;
            resolve();
          };
          img.onerror = () => {
            entry.errored = true;
            console.warn(
              `Canvas2DRenderer: failed to load image ${src.slice(0, 64)}`,
            );
            resolve();
          };
        }),
      );
      img.src = src;
      return entry;
    }
    if (
      typeof createImageBitmap !== "undefined" &&
      typeof fetch !== "undefined"
    ) {
      const entry: ImageEntry = { img: null, loaded: false, errored: false };
      this.images.set(src, entry);
      this.trackImageLoad(
        fetch(src)
          .then((r) => r.blob())
          .then((b) => createImageBitmap(b))
          .then((bmp) => {
            entry.img = bmp;
            entry.loaded = true;
          })
          .catch(() => {
            entry.errored = true;
            console.warn(
              `Canvas2DRenderer: failed to load image ${src.slice(0, 64)}`,
            );
          }),
      );
      return entry;
    }
    return null;
  }

  private trackImageLoad(p: Promise<void>): void {
    this.pendingImages.add(p);
    void p.finally(() => {
      this.pendingImages.delete(p);
    });
  }

  whenImagesSettled(): Promise<void> {
    return Promise.all([...this.pendingImages]).then(() => undefined);
  }

  compositeMask(
    mode: MaskMode,
    drawContent: () => void,
    drawMask: () => void,
    region?: DeviceRect,
  ): void {
    const r = region ?? this.fullRegion();
    if (r.width <= 0 || r.height <= 0) return;
    const base = this.maskDepth * 2;
    const a = this.ensureOffscreen(base, r.width, r.height);
    const b = this.ensureOffscreen(base + 1, r.width, r.height);
    if (!a || !b) {
      drawContent();
      return;
    } // headless / no offscreen: content only

    const main = this.ctx;
    const mainX = this.originX;
    const mainY = this.originY;

    // Content -> A, mask -> B at the same origin; a nested matte re-enters at a deeper band.
    this.maskDepth++;
    try {
      this.ctx = a;
      this.originX = r.x;
      this.originY = r.y;
      this.enterRegion(a, r);
      try {
        drawContent();
      } finally {
        a.restore();
      }

      this.ctx = b;
      this.enterRegion(b, r);
      try {
        drawMask();
      } finally {
        b.restore();
      }
    } finally {
      this.maskDepth--;
      this.ctx = main;
      this.originX = mainX;
      this.originY = mainY;
    }

    // Luminance -> alpha in place, so one destination-in/out handles every mode.
    if (mode === "luminance" || mode === "luminance-invert")
      luminanceToAlpha(b, r.width, r.height);

    // destination-in keeps content under opaque mask, destination-out (invert) under transparent;
    // the clip keeps the erase off the grow-only buffer's slack.
    const invert = mode === "alpha-invert" || mode === "luminance-invert";
    a.save();
    a.setTransform(1, 0, 0, 1, 0, 0);
    clipToRegion(a, 0, 0, r.width, r.height);
    a.globalCompositeOperation = invert ? "destination-out" : "destination-in";
    a.drawImage(b.canvas, 0, 0, r.width, r.height, 0, 0, r.width, r.height);
    a.globalCompositeOperation = "source-over";
    a.restore();

    // Blit back at identity, buffer corner on the region origin.
    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.globalAlpha = 1;
    main.drawImage(
      a.canvas,
      0,
      0,
      r.width,
      r.height,
      r.x - mainX,
      r.y - mainY,
      r.width,
      r.height,
    );
    main.restore();
  }

  // ctx.filter is missing on old Safari (<18).
  supportsFilter(): boolean {
    return typeof this.ctx.filter === "string";
  }

  // Blit happens in device space, so `filter` must arrive pre-scaled by world scale (ctx.filter CTM handling diverges).
  compositeFilter(
    filter: string,
    drawContent: () => void,
    region?: DeviceRect,
  ): void {
    const r = region ?? this.fullRegion();
    if (r.width <= 0 || r.height <= 0) return;
    const buf = this.ensureOffscreen(this.maskDepth * 2, r.width, r.height);
    if (!buf) {
      // Headless: draw unfiltered, bracketed so the closure's setTransform can't leak.
      this.ctx.save();
      drawContent();
      this.ctx.restore();
      return;
    }

    const main = this.ctx;
    const mainX = this.originX;
    const mainY = this.originY;
    // A nested composite claims a deeper band, so it can't clear this buffer.
    this.maskDepth++;
    try {
      this.ctx = buf;
      this.originX = r.x;
      this.originY = r.y;
      this.enterRegion(buf, r);
      try {
        drawContent();
      } finally {
        buf.restore();
      }
    } finally {
      this.maskDepth--;
      this.ctx = main;
      this.originX = mainX;
      this.originY = mainY;
    }

    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.globalAlpha = 1;
    main.filter = filter;
    // Source the region only: the grow-only buffer's slack holds stale pixels. Region includes filter bleed.
    main.drawImage(
      buf.canvas,
      0,
      0,
      r.width,
      r.height,
      r.x - mainX,
      r.y - mainY,
      r.width,
      r.height,
    );
    main.filter = "none";
    main.restore();
  }

  /** Composite into a dedicated raster and blit; reuse it while signature and region match. */
  cacheComposite(
    key: string,
    signature: string,
    region: DeviceRect,
    draw: () => void,
  ): void {
    if (region.width <= 0 || region.height <= 0) return;
    const hit = this.rasters.get(key);
    if (hit && hit.signature === signature) {
      // Re-insert to move it to the young end of the LRU.
      this.rasters.delete(key);
      this.rasters.set(key, hit);
      this.blitRaster(hit.ctx, region);
      return;
    }
    // First sighting of this signature: draw through without a buffer.
    if (this.rasterAdmit.get(key) !== signature) {
      this.rasterAdmit.set(key, signature);
      draw();
      return;
    }

    // Drop the superseded entry before capturing: the capture may reuse its canvas.
    const w = gridUp(region.width);
    const h = gridUp(region.height);
    let buf: CanvasRenderingContext2D | null = null;
    if (hit) {
      this.rasters.delete(key);
      this.rasterArea -= entryArea(hit);
      if (hit.ctx.canvas.width >= w && hit.ctx.canvas.height >= h)
        buf = hit.ctx;
    }
    buf ??= this.newRaster(w, h);
    if (!buf) {
      draw();
      return;
    }

    const main = this.ctx;
    const mainX = this.originX;
    const mainY = this.originY;
    const outerIncomplete = this.rasterIncomplete;
    const outerCapturing = this.capturing;
    this.rasterIncomplete = false;
    this.capturing = true;
    try {
      this.ctx = buf;
      this.originX = region.x;
      this.originY = region.y;
      // A dedicated buffer, not the banded pool, so no depth bump.
      this.enterRegion(buf, region);
      try {
        draw();
      } finally {
        buf.restore();
      }
    } finally {
      this.ctx = main;
      this.originX = mainX;
      this.originY = mainY;
      this.capturing = outerCapturing;
    }

    this.blitRaster(buf, region);
    const incomplete = this.rasterIncomplete;
    // An enclosing capture inherits incompleteness.
    this.rasterIncomplete = outerIncomplete || incomplete;
    if (incomplete) return;
    this.store(key, { ctx: buf, signature, region });
  }

  /** Dedicated raster allocation, never the depth-banded scratch pool. */
  private newRaster(w: number, h: number): CanvasRenderingContext2D | null {
    return createOffscreen(w, h);
  }

  /** Insert and LRU-evict to a budget of 4x the main buffer's pixels. */
  private store(key: string, entry: RasterEntry): void {
    this.rasters.delete(key);
    this.rasters.set(key, entry);
    this.rasterArea += entryArea(entry);
    const budget =
      4 * Math.max(1, this.main.canvas.width * this.main.canvas.height);
    for (const [k, e] of this.rasters) {
      if (this.rasterArea <= budget || k === key) break;
      this.rasters.delete(k);
      this.rasterArea -= entryArea(e);
    }
  }

  /** Blit a stored raster at identity. */
  private blitRaster(src: CanvasRenderingContext2D, r: DeviceRect): void {
    const dst = this.ctx;
    dst.save();
    dst.setTransform(1, 0, 0, 1, 0, 0);
    dst.globalAlpha = 1;
    dst.drawImage(
      src.canvas,
      0,
      0,
      r.width,
      r.height,
      r.x - this.originX,
      r.y - this.originY,
      r.width,
      r.height,
    );
    dst.restore();
  }

  /** The whole backing buffer, used when a caller supplies no region. */
  private fullRegion(): DeviceRect {
    return {
      x: 0,
      y: 0,
      width: this.main.canvas.width,
      height: this.main.canvas.height,
    };
  }

  /** Reset to device space, clear and clip `r` on a composite buffer; pair with ctx.restore(). */
  private enterRegion(ctx: CanvasRenderingContext2D, r: DeviceRect): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, r.width, r.height);
    clipToRegion(ctx, 0, 0, r.width, r.height);
  }

  // Region-sized (filtered blit cost tracks the source surface), 64px-grid, grow-only; resize() drops the pool.
  private ensureOffscreen(
    index: number,
    w: number,
    h: number,
  ): CanvasRenderingContext2D | null {
    let ctx = this.offscreen[index];
    if (ctx === undefined) {
      ctx = createOffscreen(gridUp(w), gridUp(h));
      this.offscreen[index] = ctx;
      return ctx;
    }
    if (ctx && (ctx.canvas.width < w || ctx.canvas.height < h)) {
      // Assigning a dimension wipes the canvas; composites clear their region first anyway.
      ctx.canvas.width = Math.max(ctx.canvas.width, gridUp(w));
      ctx.canvas.height = Math.max(ctx.canvas.height, gridUp(h));
    }
    return ctx;
  }

  clip(clip: ResolvedClip): void {
    const path = new Path2D();
    switch (clip.type) {
      case "rect":
        path.rect(clip.x, clip.y, clip.width, clip.height);
        break;
      case "circle":
        path.arc(clip.cx, clip.cy, clip.r, 0, Math.PI * 2);
        break;
      case "path":
        applyCommandsToPath(path, clip.commands);
        break;
    }
    this.ctx.clip(path, this.fillRule);
  }

  // Opacity drives the native globalAlpha rather than a tracked field.
  setOpacity(opacity: number): void {
    this.ctx.globalAlpha = opacity;
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  transform(m: Matrix3x3): void {
    // Matrix3x3 [a, b, tx, c, d, ty, ...] -> canvas (a, c, b, d, tx, ty).
    this.ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
  }

  setTransform(m: Matrix3x3): void {
    // Same mapping; the target's origin is subtracted so device-space matrices address region buffers.
    this.ctx.setTransform(
      m[0],
      m[3],
      m[1],
      m[4],
      m[2] - this.originX,
      m[5] - this.originY,
    );
  }

  // Device size is the main canvas's, never a composite buffer's.
  getWidth(): number {
    return this.main.canvas.width;
  }

  getHeight(): number {
    return this.main.canvas.height;
  }

  resize(width: number, height: number): void {
    const c = this.main.canvas;
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
    // Drop the buffer pool and cached rasters: both belong to the old device space.
    this.offscreen.length = 0;
    this.rasters.clear();
    this.rasterAdmit.clear();
    this.rasterArea = 0;
  }

  private applyFillAndStroke(bounds: PaintBox): void {
    for (const which of paintOrderSequence(this.paintOrder)) {
      if (which === "fill") this.fillPath(bounds);
      else this.strokePath(bounds);
    }
  }

  private fillPath(bounds: PaintBox): void {
    // Fill is never trimmed (like Lottie); gradient wins over solid.
    if (this.fillGradient) {
      this.ctx.fillStyle = this.realizeGradient(this.fillGradient, bounds);
      this.ctx.fill(this.fillRule);
    } else if (this.fillColor) {
      this.ctx.fillStyle = this.fillColor;
      this.ctx.fill(this.fillRule);
    }
  }

  private strokePath(bounds: PaintBox): void {
    const stroke = this.strokeGradient
      ? this.realizeGradient(this.strokeGradient, bounds)
      : this.strokeColor;
    if (!stroke) return;

    // Trim/dash composition; an empty trim window strokes nothing. Set per stroke so it can't leak.
    const dash = resolveStrokeDash(this.trim, this.dashArray, this.dashOffset);
    if (!dash.stroke) return;
    this.ctx.setLineDash(dash.dashArray);
    this.ctx.lineDashOffset = dash.dashOffset;

    this.ctx.lineCap = this.lineCap;
    this.ctx.lineJoin = this.lineJoin;
    this.ctx.miterLimit = this.miterLimit;
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = this.strokeWidth;
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  /** Gradient descriptor -> CanvasGradient via the shared resolver. */
  private realizeGradient(g: GradientData, b: PaintBox): CanvasGradient {
    const r = resolveGradient(g, b);
    const grad =
      r.type === "linear"
        ? this.ctx.createLinearGradient(r.x1, r.y1, r.x2, r.y2)
        : r.type === "conic"
          ? this.ctx.createConicGradient(r.startAngle, r.cx, r.cy)
          : this.ctx.createRadialGradient(r.fx, r.fy, 0, r.cx, r.cy, r.r);
    for (const stop of r.stops) grad.addColorStop(stop.offset, stop.color);
    return grad;
  }
}

/** Clip to a rect in the target's own pixels (transform already reset). */
function clipToRegion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}

/** Round up to a 64px grid, never below the request. */
function gridUp(n: number): number {
  return Math.max(1, Math.ceil(n / 64) * 64);
}

/** A blank offscreen 2D context sized w×h, or null when no canvas API exists. */
function createOffscreen(
  w: number,
  h: number,
): CanvasRenderingContext2D | null {
  try {
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      return canvas.getContext("2d");
    }
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(w, h).getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Rewrite alpha to luminance × alpha. NOTE: CPU pass; a ctx.filter grayscale path would avoid the readback. */
function luminanceToAlpha(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return;
  let data: ImageData;
  try {
    // The mask region sits at the buffer's corner, so the readback does too.
    data = ctx.getImageData(0, 0, width, height);
  } catch {
    return; // tainted canvas — leave as-is (treated as an alpha mask)
  }
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum =
      LUMA_COEFFICIENTS.r * px[i] +
      LUMA_COEFFICIENTS.g * px[i + 1] +
      LUMA_COEFFICIENTS.b * px[i + 2];
    px[i + 3] = (px[i + 3] * lum) / 255;
  }
  ctx.putImageData(data, 0, 0);
}
