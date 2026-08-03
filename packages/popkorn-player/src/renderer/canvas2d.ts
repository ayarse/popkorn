import type { DeviceRect } from "../scene/bounds";
import { applyCommandsToPath, computePathBounds } from "../scene/path-parser";
import type { BlendMode, MaskMode, TextAnchor } from "../scene/types";
import type { PaintBox } from "./gradient-geometry";
import { resolveGradient } from "./gradient-geometry";
import type { Renderer } from "./interface";
import { PaintStateRenderer } from "./paint-state";
import { paintOrderSequence, resolveStrokeDash } from "./stroke";
import type {
  CornerRadii,
  GradientData,
  Matrix3x3,
  PathCommand,
  ResolvedClip,
} from "./types";
import { LUMA_COEFFICIENTS } from "./types";

/**
 * Canvas 2D implementation of the Renderer interface
 * Used for the PoC - can be swapped for ThorVG later
 */
// Cache entry for a loaded (or loading) image, keyed by src. `img` is an
// HTMLImageElement on the main thread and an ImageBitmap in a worker; it stays
// null until the decode lands (guarded by `loaded`).
interface ImageEntry {
  img: HTMLImageElement | ImageBitmap | null;
  loaded: boolean;
  errored: boolean;
}

// One cached composite raster: the buffer holding it (its pixel (0,0) is the
// region's device origin, like every composite buffer), the signature the shared
// walk captured it under, and the region it covers.
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

export class Canvas2DRenderer extends PaintStateRenderer implements Renderer {
  // The visible canvas — the composite target of last resort, and the authority
  // on device size (`this.ctx` is an offscreen buffer mid-composite).
  private main: CanvasRenderingContext2D;
  private ctx: CanvasRenderingContext2D;
  // Device coordinates of `this.ctx`'s pixel (0, 0). Zero on the main canvas;
  // a composite buffer's origin is its region's origin, so buffers only need to
  // be region-sized. setTransform folds it in, so callers stay in device space.
  private originX = 0;
  private originY = 0;
  // Image cache and lazily-created offscreen buffers for track masks.
  private images = new Map<string, ImageEntry>();
  // In-flight image decodes; each promise settles (never rejects) on load/error.
  private pendingImages = new Set<Promise<void>>();
  private offscreen: (CanvasRenderingContext2D | null)[] = [];
  // Re-entrancy depth for offscreen compositing (compositeMask + compositeFilter):
  // nested composites each claim a distinct offscreen band (base = depth*2) so an
  // inner composite's beginFrame() can't clear an outer's content mid-composite.
  // Filter and mask share the counter so they interleave (filter-in-matte,
  // matte-in-filter) without clobbering each other's buffers.
  private maskDepth = 0;
  // Raster cache for composite subtrees, keyed by the shared walk's cache key.
  // Insertion order IS the LRU order (a hit re-inserts), and `rasterArea` tracks
  // the allocated pixels so eviction can bound the pool by area.
  private rasters = new Map<string, RasterEntry>();
  private rasterArea = 0;
  // Signature last seen for a key that wasn't cached — the admission gate: a
  // subtree earns a buffer only once its signature repeats, so a genuinely
  // animating subtree (a new signature every frame) never allocates one.
  private rasterAdmit = new Map<string, string>();
  // Set while capturing when a draw could not produce final pixels (an image
  // still decoding, a webfont still loading). Such a raster is blitted but not
  // stored — caching it would freeze the pre-decode frame forever.
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

  clear(): void {
    this.main.clearRect(0, 0, this.main.canvas.width, this.main.canvas.height);
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

  // Apply eagerly onto the ctx: the CSS keyword IS the globalCompositeOperation
  // value for every blend mode, except `normal` -> `source-over`. The loop resets
  // to 'normal' after the node's shape, so it doesn't leak to siblings.
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
      // Uniform (possibly elliptical) radius.
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
    // A webfont landing later re-shapes this text with no scene-state change, so
    // a raster captured before the fonts settle must not be stored.
    if (this.capturing && typeof document !== "undefined") {
      if (document.fonts && document.fonts.status !== "loaded")
        this.rasterIncomplete = true;
    }
    this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    this.ctx.textAlign =
      anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";
    this.ctx.textBaseline = "alphabetic";
    // ctx.letterSpacing is sticky — set it every draw (a CSS length string), so a
    // 0 spacing clears a prior node's value. Guarded: not all engines expose it.
    if ("letterSpacing" in this.ctx)
      this.ctx.letterSpacing = `${letterSpacing}px`;

    // Bounding box (for gradients) mirrors scene/transform.getShapeBounds.
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
      // Repaints in once the decode lands — but a raster captured now would
      // freeze the image out permanently, so the capture must not be stored.
      if (this.capturing && !entry.errored) this.rasterIncomplete = true;
      return;
    }
    // Source-cropped (object-view-box): 9-arg sample of the sub-rect into the box.
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

  // Kick off a decode, caching the entry immediately so we fetch each src once.
  // Main thread: HTMLImageElement. Worker (no Image): fetch(src) -> blob ->
  // createImageBitmap, which also handles data: URLs. Returns null when neither
  // path exists (e.g. bun tests), leaving the image node inert.
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

  // Resolves once no image decodes are in flight (immediately if none). An
  // offline, seek-driven export awaits this after seeking so a re-render paints
  // the now-decoded images; the live loop ignores it and repaints naturally.
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

    // Content -> A, mask source -> B; each closure sets its own world transform.
    // A nested matte encountered inside these closures re-enters here at a
    // deeper depth, so it claims its own buffer pair rather than clearing ours.
    // Both buffers take the same origin, so they combine at matching coords.
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

    // Turn a luminance mask into an alpha mask in place, so a single
    // destination-in/out handles every mode.
    if (mode === "luminance" || mode === "luminance-invert")
      luminanceToAlpha(b, r.width, r.height);

    // destination-in keeps content where the mask is opaque; destination-out
    // keeps it where the mask is transparent (the *-invert variants). Both
    // buffers hold the region at their own top-left corner, so the combine is
    // corner-to-corner; the clip keeps destination-in's erasure off the slack
    // a grow-only buffer carries beyond the region.
    const invert = mode === "alpha-invert" || mode === "luminance-invert";
    a.save();
    a.setTransform(1, 0, 0, 1, 0, 0);
    clipToRegion(a, 0, 0, r.width, r.height);
    a.globalCompositeOperation = invert ? "destination-out" : "destination-in";
    a.drawImage(b.canvas, 0, 0, r.width, r.height, 0, 0, r.width, r.height);
    a.globalCompositeOperation = "source-over";
    a.restore();

    // Blit the masked result back at identity, landing the buffer's corner on
    // the region's position in the destination's own coordinates.
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

  // ctx.filter exists on all evergreen browsers; old Safari (<18) lacks it. It's
  // a string property ('none' by default), so a typeof check feature-detects it.
  supportsFilter(): boolean {
    return typeof this.ctx.filter === "string";
  }

  // Composite a filtered subtree: render `drawContent` (which sets its own world
  // transform) into an offscreen holding device-space pixels, then blit it back
  // to the main canvas at identity with `filter` applied. Because the blit is in
  // device space, the caller must have already scaled the filter's lengths by the
  // node's world scale (so a scaled element's blur/shadow scales — CSS semantics),
  // rather than relying on ctx.filter honoring the CTM (which browsers diverge on).
  compositeFilter(
    filter: string,
    drawContent: () => void,
    region?: DeviceRect,
  ): void {
    const r = region ?? this.fullRegion();
    if (r.width <= 0 || r.height <= 0) return;
    const buf = this.ensureOffscreen(this.maskDepth * 2, r.width, r.height);
    if (!buf) {
      // Headless (no offscreen): draw unfiltered, bracketed so the closure's
      // absolute setTransform can't leak into sibling draws on the main ctx.
      this.ctx.save();
      drawContent();
      this.ctx.restore();
      return;
    }

    const main = this.ctx;
    const mainX = this.originX;
    const mainY = this.originY;
    // A nested composite inside drawContent claims a deeper band, so it can't
    // clear this buffer mid-composite (mirrors compositeMask's depth discipline).
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
    // Source sub-rect, not the whole buffer: only the region was cleared and
    // redrawn, so a grow-only buffer's slack still holds a previous composite's
    // pixels and would otherwise be filtered in. The region already carries the
    // filter's bleed margin (see scene/bounds), so the blur samples transparent
    // padding, not a hard edge.
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

  supportsRasterCache(): boolean {
    return true;
  }

  /**
   * Run a composite into a dedicated region-sized raster and blit it, reusing
   * the stored raster when the caller's signature and region match the one it
   * was captured under. The composite draws into a transparent buffer and is
   * blitted with the same identity/source-over blit `compositeFilter` and
   * `compositeMask` use, so a captured frame lands the same pixels the direct
   * composite would (bar the 8-bit rounding of one extra premultiplied blit).
   */
  cacheComposite(
    key: string,
    signature: string,
    region: DeviceRect,
    draw: () => void,
  ): void {
    if (region.width <= 0 || region.height <= 0) return;
    const hit = this.rasters.get(key);
    if (hit && hit.signature === signature) {
      // Re-insert to move it to the young end of the LRU order.
      this.rasters.delete(key);
      this.rasters.set(key, hit);
      this.blitRaster(hit.ctx, region);
      return;
    }
    // First sighting of this signature: draw straight through. A subtree that
    // changes every frame stops here forever and never claims a buffer.
    if (this.rasterAdmit.get(key) !== signature) {
      this.rasterAdmit.set(key, signature);
      draw();
      return;
    }

    // Drop the superseded entry BEFORE capturing: the capture may reuse its
    // canvas (and always invalidates its pixels), and an aborted capture must
    // not leave a live entry pointing at half-overwritten pixels.
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
      // The capture buffer is dedicated, not from the depth-banded scratch pool,
      // so a nested composite inside `draw` still claims its own band and the
      // depth counter needs no bump here.
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
    // An enclosing capture must inherit the incompleteness, or it would store a
    // raster containing this one's placeholder pixels.
    this.rasterIncomplete = outerIncomplete || incomplete;
    if (incomplete) return;
    this.store(key, { ctx: buf, signature, region });
  }

  /** A raster buffer for one cached composite: its own allocation, never the
   *  depth-banded scratch pool (whose bands a nested composite clobbers). */
  private newRaster(w: number, h: number): CanvasRenderingContext2D | null {
    return createOffscreen(w, h);
  }

  /** Insert a cache entry and evict by LRU until the pool fits the budget: 4x
   *  the main buffer's pixels, which holds a handful of typical composite
   *  regions without tracking the viewport. */
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

  /** Blit a stored raster's region into the current target, at identity — the
   *  same shape of blit the two composites end with. */
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

  /** The whole backing buffer — the region used when a caller supplies none. */
  private fullRegion(): DeviceRect {
    return {
      x: 0,
      y: 0,
      width: this.main.canvas.width,
      height: this.main.canvas.height,
    };
  }

  /**
   * Open a composite buffer for drawing into `r`: reset to device space, clear
   * the region, and clip to it. The buffer's pixel (0, 0) IS the region's
   * device origin (see `originX`), so the region sits at the buffer's corner
   * and drawing in device space still lands correctly. Pairs with ctx.restore().
   */
  private enterRegion(ctx: CanvasRenderingContext2D, r: DeviceRect): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, r.width, r.height);
    clipToRegion(ctx, 0, 0, r.width, r.height);
  }

  /**
   * Lazily create an offscreen 2D context holding at least w×h pixels. Buffers
   * are region-sized rather than canvas-sized because a filtered blit costs in
   * proportion to its SOURCE surface (Firefox measurably so, ~2× from a
   * viewport-sized source), and because the pool retains 2×(depth+1) of them.
   *
   * Sizes round UP to a 64px grid and only ever grow within a frame band, so a
   * region jittering by a pixel per frame doesn't reallocate; `resize()` drops
   * the pool so a shrunken canvas doesn't keep paying for the old one.
   */
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
      // Assigning either dimension wipes the canvas; both composites clear the
      // region they draw into first, so there is nothing to preserve.
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

  // Paint state (fill/stroke/trim/dash/…) is inherited from PaintStateRenderer.
  // Opacity is the exception: Canvas2D drives it through the native globalAlpha
  // rather than a tracked field.
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
    // Matrix3x3 is [a, b, tx, c, d, ty, 0, 0, 1]
    // Canvas transform takes (a, b, c, d, e, f) = (a, c, b, d, tx, ty)
    this.ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
  }

  setTransform(m: Matrix3x3): void {
    // Matrix3x3 is [a, b, tx, c, d, ty, 0, 0, 1]
    // Canvas setTransform takes (a, b, c, d, e, f) = (a, c, b, d, tx, ty)
    // The translation drops the current target's origin, so an absolute
    // device-space matrix addresses a region-sized composite buffer unchanged.
    this.ctx.setTransform(
      m[0],
      m[3],
      m[1],
      m[4],
      m[2] - this.originX,
      m[5] - this.originY,
    );
  }

  // Device size is the main canvas's, never the composite buffer we may be
  // drawing into: the walk clamps its bounds against this.
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
    // Composite buffers grow monotonically; a resize is the point where a
    // pool sized for the old canvas should stop being retained. Cached rasters
    // go with them: every one was captured in the old device space.
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

  private strokePath(bounds: PaintBox): void {
    const stroke = this.strokeGradient
      ? this.realizeGradient(this.strokeGradient, bounds)
      : this.strokeColor;
    if (!stroke) return;

    // Resolve trim/dash precedence (trim wins over an authored dasharray; an
    // empty trim window strokes nothing). Reset the dash per stroke so a trim
    // pattern can't leak to the next shape.
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

  /** Realize a gradient descriptor (via the shared geometry resolver) into a
   *  CanvasGradient. */
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

/** Confine drawing to a rect, in the target's own pixels (caller has reset the
 *  transform). */
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

/** Round an allocation up to a 64px grid — never below the request, so a
 *  buffer always holds the whole region (invariant: regions stay supersets). */
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

/**
 * Rewrite a buffer's alpha to its per-pixel luminance (×existing alpha), so a
 * luminance mask can be applied with the same destination-in/out path as an alpha
 * mask. One getImageData/putImageData pass.
 *
 * NOTE: a filter-only fast path (`ctx.filter = 'grayscale(1)'` + a luminance
 * blend) would avoid the CPU round-trip; the pixel loop is the simple version.
 */
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
