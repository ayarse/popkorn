import type {
  CornerRadii,
  GradientData,
  ImageEntry,
  MaskMode,
  Matrix3x3,
  PaintBox,
  PathCommand,
  PathSink,
  Renderer,
  ResolvedClip,
  TextAnchor,
} from "@popkorn/player";
import {
  anchorX,
  applyCommandsToPath,
  computePathBounds,
  ellipseBox,
  LUMA_COEFFICIENTS,
  maskModeParts,
  newImageDest,
  PaintStateRenderer,
  PendingImages,
  paintOrderSequence,
  resolveGradient,
  resolveImageDest,
  resolveStrokeDash,
  roundedRectPath,
  setTextMeasurer,
} from "@popkorn/player";

// Type-only import (erased at runtime) so this loads under bun test; `Skia` is injected via the constructor.
type SkiaApi = typeof import("@shopify/react-native-skia").Skia;
type SkCanvas = import("@shopify/react-native-skia").SkCanvas;
type SkPaint = import("@shopify/react-native-skia").SkPaint;
type SkPath = import("@shopify/react-native-skia").SkPath;
type SkShader = import("@shopify/react-native-skia").SkShader;
type SkColor = import("@shopify/react-native-skia").SkColor;
type SkPathEffect = import("@shopify/react-native-skia").SkPathEffect;
type SkFont = import("@shopify/react-native-skia").SkFont;
type SkFontMgr = import("@shopify/react-native-skia").SkFontMgr;
type SkImage = import("@shopify/react-native-skia").SkImage;

// Only gradient shaders read bounds, so non-gradient shapes share a zero box.
const ZERO_BOUNDS: PaintBox = { x: 0, y: 0, width: 0, height: 0 };

// Caps for the value-keyed shader/dash caches: morphing values mint a key per frame.
const SHADER_CACHE_CAP = 64;
const DASH_CACHE_CAP = 64;

// Stable Skia C++ enum values, inlined to avoid importing the native module at runtime.
const PaintStyle = { Fill: 0, Stroke: 1 } as const;
const StrokeCap = { butt: 0, round: 1, square: 2 } as const; // SkStrokeCap
const StrokeJoin = { miter: 0, round: 1, bevel: 2 } as const; // SkStrokeJoin
const FillType = { nonzero: 0, evenodd: 1 } as const; // Winding, EvenOdd
const TileMode_Clamp = 0; // TileMode.Clamp
const FontSlant_Upright = 0; // SkFontSlant.Upright
const ClipOp_Intersect = 1; // ClipOp.Intersect
const BlendMode_DstIn = 6; // SkBlendMode.DstIn:  r = d * sa
const BlendMode_DstOut = 8; // SkBlendMode.DstOut: r = d * (1-sa)

// CSS mix-blend-mode -> SkBlendMode; `normal` is SrcOver (reset default).
const BLEND_MODE: Record<string, number> = {
  multiply: 24,
  screen: 14,
  overlay: 15,
  darken: 16,
  lighten: 17,
  "color-dodge": 18,
  "color-burn": 19,
  "hard-light": 20,
  "soft-light": 21,
  difference: 22,
  exclusion: 23,
  hue: 25,
  saturation: 26,
  color: 27,
  luminosity: 28,
};

// Luma -> alpha colour matrix (4x5 row-major, Rec.709), turning a luminance matte into an alpha matte.
// NOTE: ignores the mask's own alpha (luma·alpha isn't linear); pinned divergence vs Canvas2D.
const LUMA_TO_ALPHA_MATRIX = [
  ...new Array<number>(15).fill(0),
  LUMA_COEFFICIENTS.r,
  LUMA_COEFFICIENTS.g,
  LUMA_COEFFICIENTS.b,
  0,
  0,
];

/** React Native Skia backend of the Renderer interface, drawing onto a per-frame SkCanvas. */
export class SkiaRenderer extends PaintStateRenderer implements Renderer {
  private skia: SkiaApi;
  private canvas: SkCanvas | null = null;
  private width: number;
  private height: number;

  // Skia has no globalAlpha: opacity is pushed/popped with native save/restore so it cascades.
  private opacityStack: number[] = [];

  // One reused SkPaint per role (draws copy paint state into the op); parsed colours are cached too.
  private fillPaint: SkPaint;
  private strokePaint: SkPaint;
  // Pooled mask compositing paint, allocated on first mask.
  private maskPaint: SkPaint | null = null;
  private colorCache = new Map<string, SkColor>();

  // Memoize static SkPath/SkShader/dash PathEffect so only animated geometry rebuilds.
  private pathCache = new WeakMap<PathCommand[], SkPath>();
  private shaderCache = new Map<string, SkShader>();
  private dashCache = new Map<string, SkPathEffect>();

  // Lazy system font manager (null = headless, text renders nothing) + SkFont cache by (family, weight, size).
  private fontMgr: SkFontMgr | null | undefined;
  private fontCache = new Map<string, SkFont>();
  private imagePaint: SkPaint | null = null;
  // Transparent until the async decode lands; decode failure warns once.
  private images = new Map<string, ImageEntry<SkImage>>();
  private pendingImages = new PendingImages();
  private imageDest = newImageDest();

  constructor(skia: SkiaApi, opts: { width: number; height: number }) {
    super();
    this.skia = skia;
    this.width = opts.width;
    this.height = opts.height;
    this.fillPaint = skia.Paint();
    this.strokePaint = skia.Paint();

    // Scene-layer text measurement uses drawText's own advance, so hit-boxes and clips match the glyphs.
    // NOTE: process-global; the last renderer constructed wins.
    setTextMeasurer((text, style) => {
      const font = this.font(
        style.fontFamily,
        String(style.fontWeight),
        style.fontSize,
      );
      if (!font) return null; // headless / no font manager: fall back to estimate
      return { width: font.measureText(text).width, height: style.fontSize };
    });
  }

  /** Parse a CSS colour to an SkColor once, then reuse the cached (immutable) value. */
  private color(css: string): SkColor {
    let c = this.colorCache.get(css);
    if (!c) {
      c = this.skia.Color(css);
      this.colorCache.set(css, c);
    }
    return c;
  }

  /** Bind the canvas painted this frame (from a PictureRecorder), or null to go dormant. */
  setCanvas(canvas: SkCanvas | null): void {
    this.canvas = canvas;
  }

  // --- Frame lifecycle -------------------------------------------------------

  beginFrame(): void {
    this.opacity = 1;
    this.opacityStack.length = 0;
    // Fresh recorder canvas starts at identity; resync the mirror.
    this.resetCtm();
  }

  endFrame(): void {}

  // --- Shapes ----------------------------------------------------------------

  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    rx = 0,
    ry = 0,
    corners?: CornerRadii,
  ): void {
    const bounds: PaintBox = { x, y, width: w, height: h };
    // No per-corner RRect constructor in RN Skia, so use the shared rounded-rect path.
    if (corners) {
      const path = this.buildPath(roundedRectPath(x, y, w, h, corners));
      this.fillAndStroke(bounds, (p, c) => c.drawPath(path, p));
      return;
    }
    const rect = this.skia.XYWHRect(x, y, w, h);
    if (rx > 0 || ry > 0) {
      const rr = this.skia.RRectXY(rect, rx, ry);
      this.fillAndStroke(bounds, (p, c) => c.drawRRect(rr, p));
    } else {
      this.fillAndStroke(bounds, (p, c) => c.drawRect(rect, p));
    }
  }

  drawCircle(cx: number, cy: number, r: number): void {
    this.fillAndStroke(ellipseBox(cx, cy, r, r), (p, c) =>
      c.drawCircle(cx, cy, r, p),
    );
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number): void {
    const b = ellipseBox(cx, cy, rx, ry);
    const rect = this.skia.XYWHRect(b.x, b.y, b.width, b.height);
    this.fillAndStroke(b, (p, c) => c.drawOval(rect, p));
  }

  drawPath(commands: PathCommand[]): void {
    const path = this.buildPath(commands);
    path.setFillType(FillType[this.fillRule]);
    // Only a gradient consumes bounds, so skip computePathBounds otherwise.
    const bounds =
      this.fillGradient || this.strokeGradient
        ? computePathBounds(commands)
        : ZERO_BOUNDS;
    this.fillAndStroke(bounds, (p, c) => c.drawPath(path, p));
  }

  drawText(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    fontFamily: string,
    fontWeight: string,
    anchor: TextAnchor,
    // NOTE: pinned no-op; RN Skia drawText has no per-glyph advance.
    _letterSpacing = 0,
  ): void {
    if (!this.canvas) return;
    const font = this.font(fontFamily, fontWeight, fontSize);
    if (!font) return; // no system font manager (headless): paint nothing

    // Skia draws left-aligned from the alphabetic baseline; shift x for middle/end anchors.
    const width = font.measureText(text).width;
    const ax = anchorX(x, width, anchor);
    // Bounding box (for gradients) matches scene/transform.getShapeBounds.
    const bounds: PaintBox = {
      x: ax,
      y: y - fontSize,
      width,
      height: fontSize,
    };

    this.fillAndStroke(bounds, (p, c) => c.drawText(text, ax, y, p, font));
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
    if (!this.canvas || !src) return;
    let entry = this.images.get(src);
    if (!entry) entry = this.loadImage(src);
    if (!entry.loaded || !entry.img) return; // repaints in once decoded
    const img = entry.img;
    // Source = the object-view-box crop, else the whole image.
    const d = resolveImageDest(
      this.imageDest,
      w,
      h,
      img.width(),
      img.height(),
      sx,
      sy,
      sw,
      sh,
    );
    if (!this.imagePaint) this.imagePaint = this.skia.Paint();
    const paint = this.imagePaint;
    paint.reset();
    paint.setAntiAlias(true);
    paint.setAlphaf(this.opacity); // cascade group opacity onto the image
    this.canvas.drawImageRect(
      img,
      this.skia.XYWHRect(d.sx, d.sy, d.sw, d.sh),
      this.skia.XYWHRect(x, y, d.dw, d.dh),
      paint,
    );
  }

  // (family, weight, size) -> cached SkFont; matchFamilyStyle is synchronous, unknown families use the default face.
  private font(family: string, weight: string, size: number): SkFont | null {
    const mgr = this.fontManager();
    if (!mgr) return null;
    const key = `${family}|${weight}|${size}`;
    let font = this.fontCache.get(key);
    if (!font) {
      // CSS font-family is a comma list; take the first name.
      const name = family
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "");
      const typeface = mgr.matchFamilyStyle(name, {
        weight: cssFontWeight(weight),
        slant: FontSlant_Upright,
      });
      font = this.skia.Font(typeface ?? undefined, size);
      this.fontCache.set(key, font);
    }
    return font;
  }

  private fontManager(): SkFontMgr | null {
    if (this.fontMgr === undefined) {
      // System() touches the native module; headless bun degrades to no text.
      try {
        this.fontMgr = this.skia.FontMgr.System();
      } catch {
        this.fontMgr = null;
      }
    }
    return this.fontMgr;
  }

  // Decode each src once: data: URIs synchronously via fromBase64, else async Data.fromURI.
  private loadImage(src: string): ImageEntry<SkImage> {
    const entry: ImageEntry<SkImage> = {
      img: null,
      loaded: false,
      errored: false,
    };
    this.images.set(src, entry);
    const fail = (what: string) => {
      entry.errored = true;
      console.warn(`SkiaRenderer: failed to ${what} image ${src.slice(0, 64)}`);
    };

    const decode = (
      data: import("@shopify/react-native-skia").SkData,
    ): void => {
      const img = this.skia.Image.MakeImageFromEncoded(data);
      if (img) {
        entry.img = img;
        entry.loaded = true;
      } else {
        fail("decode");
      }
    };

    const base64 = /^data:[^,]*;base64,(.*)$/s.exec(src);
    if (base64) {
      try {
        decode(this.skia.Data.fromBase64(base64[1]));
      } catch {
        fail("decode");
      }
      return entry;
    }

    this.pendingImages.track(
      this.skia.Data.fromURI(src)
        .then(decode)
        .catch(() => fail("load")),
    );
    return entry;
  }

  whenImagesSettled(): Promise<void> {
    return this.pendingImages.settled();
  }

  // True while an async (file/http) decode is in flight, so a dormant host can schedule a wake-up.
  hasPendingImages(): boolean {
    return this.pendingImages.size > 0;
  }

  clip(clip: ResolvedClip): void {
    if (!this.canvas) return;
    if (clip.type === "rect") {
      this.canvas.clipRect(
        this.skia.XYWHRect(clip.x, clip.y, clip.width, clip.height),
        ClipOp_Intersect,
        true,
      );
      return;
    }
    let path: SkPath;
    if (clip.type === "circle") {
      path = this.skia.Path.Make();
      path.addCircle(clip.cx, clip.cy, clip.r);
    } else {
      path = this.buildPath(clip.commands);
      path.setFillType(FillType[this.fillRule]);
    }
    this.canvas.clipPath(path, ClipOp_Intersect, true);
  }

  // Nested layers: L1 content, L2 mask (DstIn/DstOut + luma filter); restoring L2 then L1 composites.
  compositeMask(
    mode: MaskMode,
    drawContent: () => void,
    drawMask: () => void,
  ): void {
    const canvas = this.canvas;
    if (!canvas) {
      drawContent();
      return;
    }

    const savedCtm = this.ctm;
    const savedOpacity = this.opacity;

    const { luminance, invert } = maskModeParts(mode);
    this.maskPaint ??= this.skia.Paint();
    const maskPaint = this.maskPaint;

    canvas.save(); // outer bracket: restores CTM + clip afterwards
    canvas.saveLayer(); // L1: content
    drawContent();
    // Configure the pooled maskPaint after drawContent: a nested matte there would clobber it.
    // saveLayer snapshots the paint, so a nested matte in drawMask is safe.
    maskPaint.reset();
    maskPaint.setBlendMode(invert ? BlendMode_DstOut : BlendMode_DstIn);
    if (luminance) {
      maskPaint.setColorFilter(
        this.skia.ColorFilter.MakeMatrix(LUMA_TO_ALPHA_MATRIX),
      );
    }
    canvas.saveLayer(maskPaint); // L2: mask (blended down onto L1 on restore)
    drawMask();
    canvas.restore(); // composite L2 -> L1 (DstIn / DstOut)
    canvas.restore(); // composite L1 -> canvas (source-over)
    canvas.restore(); // outer bracket

    this.ctm = savedCtm;
    this.opacity = savedOpacity;
  }

  // --- Style -----------------------------------------------------------------

  setDash(dashArray: number[], dashOffset: number): void {
    // MakeDash needs an even-length array; duplicate an odd one as Canvas2D setLineDash does.
    this.dashArray =
      dashArray.length % 2 ? dashArray.concat(dashArray) : dashArray;
    this.dashOffset = dashOffset;
  }

  // --- Transform stack -------------------------------------------------------

  save(): void {
    this.canvas?.save();
    this.opacityStack.push(this.opacity);
    this.pushCtm();
  }

  restore(): void {
    this.canvas?.restore();
    this.opacity = this.opacityStack.pop() ?? 1;
    this.popCtm();
  }

  // Matrix3x3 is row-major [a,b,tx,c,d,ty,0,0,1], exactly what concat takes.
  transform(m: Matrix3x3): void {
    // concat copies synchronously, so no defensive spread.
    this.canvas?.concat(m);
    this.concatCtm(m);
  }

  // Absolute set via the delta from setCtmAbsolute; unlike restoreToCount it keeps active clips.
  setTransform(m: Matrix3x3): void {
    this.canvas?.concat(this.setCtmAbsolute(m));
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  resize(width: number, height: number): void {
    // The recorder canvas is bound per frame at the host's size; just track dimensions.
    this.width = width;
    this.height = height;
  }

  // --- Internals -------------------------------------------------------------

  /** Paint fill then stroke (or the reverse for paint-order: stroke). */
  private fillAndStroke(
    bounds: PaintBox,
    draw: (paint: SkPaint, canvas: SkCanvas) => void,
  ): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const fill = () => {
      const p = this.makeFillPaint(bounds);
      if (p) draw(p, canvas);
    };
    const stroke = () => {
      const p = this.makeStrokePaint(bounds);
      if (p) draw(p, canvas);
    };
    for (const which of paintOrderSequence(this.paintOrder)) {
      if (which === "fill") fill();
      else stroke();
    }
  }

  private makeFillPaint(bounds: PaintBox): SkPaint | null {
    if (!this.fillGradient && !this.fillColor) return null;
    const paint = this.resetPaint(this.fillPaint, PaintStyle.Fill);
    return this.shade(paint, this.fillGradient, this.fillColor, bounds);
  }

  // Reset a pooled paint and apply the sticky blend (SrcOver needs nothing).
  private resetPaint(paint: SkPaint, style: number): SkPaint {
    paint.reset();
    const m = BLEND_MODE[this.blendMode];
    if (m !== undefined) paint.setBlendMode(m);
    paint.setAntiAlias(true);
    paint.setStyle(style);
    return paint;
  }

  // Gradient shader or solid colour; paint alpha modulates either by opacity.
  private shade(
    paint: SkPaint,
    gradient: GradientData | null,
    color: string | null,
    bounds: PaintBox,
  ): SkPaint {
    if (gradient) {
      paint.setShader(this.makeShader(gradient, bounds));
      paint.setAlphaf(this.opacity);
    } else if (color) {
      const c = this.color(color);
      paint.setColor(c);
      paint.setAlphaf(c[3] * this.opacity);
    }
    return paint;
  }

  private makeStrokePaint(bounds: PaintBox): SkPaint | null {
    if (!this.strokeGradient && !this.strokeColor) return null;
    // Trim/dash composition; an empty trim window strokes nothing.
    const dash = resolveStrokeDash(this.trim, this.dashArray, this.dashOffset);
    if (!dash.stroke) return null;

    const paint = this.resetPaint(this.strokePaint, PaintStyle.Stroke);
    paint.setStrokeWidth(this.strokeWidth);
    paint.setStrokeCap(StrokeCap[this.lineCap]);
    paint.setStrokeJoin(StrokeJoin[this.lineJoin]);
    paint.setStrokeMiter(this.miterLimit);

    if (dash.dashArray.length > 0) {
      paint.setPathEffect(this.dashEffect(dash.dashArray, dash.dashOffset));
    }

    return this.shade(paint, this.strokeGradient, this.strokeColor, bounds);
  }

  /** Gradient descriptor -> SkShader via the shared resolver. */
  private makeShader(g: GradientData, b: PaintBox): SkShader {
    // Gradients are deep-copied per frame, so key by value + bounds, not identity.
    const key = `${JSON.stringify(g)}|${b.x},${b.y},${b.width},${b.height}`;
    const hit = this.shaderCache.get(key);
    if (hit) return hit;
    const shader = this.buildShader(g, b);
    if (this.shaderCache.size >= SHADER_CACHE_CAP) this.shaderCache.clear();
    this.shaderCache.set(key, shader);
    return shader;
  }

  private buildShader(g: GradientData, b: PaintBox): SkShader {
    const r = resolveGradient(g, b);
    const colors = r.stops.map((s) => this.color(s.color));
    const pos = r.stops.map((s) => s.offset);

    if (r.type === "linear") {
      return this.skia.Shader.MakeLinearGradient(
        { x: r.x1, y: r.y1 },
        { x: r.x2, y: r.y2 },
        colors,
        pos,
        TileMode_Clamp,
      );
    }

    if (r.type === "conic") {
      // Skia sweep angles are degrees from +x clockwise, matching resolveGradient.
      const startDeg = (r.startAngle * 180) / Math.PI;
      return this.skia.Shader.MakeSweepGradient(
        r.cx,
        r.cy,
        colors,
        pos,
        TileMode_Clamp,
        null,
        0,
        startDeg,
        startDeg + 360,
      );
    }

    // Focal highlight -> two-point conical, inner radius 0 at the focal point.
    if (r.fx !== r.cx || r.fy !== r.cy) {
      return this.skia.Shader.MakeTwoPointConicalGradient(
        { x: r.fx, y: r.fy },
        0,
        { x: r.cx, y: r.cy },
        r.r,
        colors,
        pos,
        TileMode_Clamp,
      );
    }
    return this.skia.Shader.MakeRadialGradient(
      { x: r.cx, y: r.cy },
      r.r,
      colors,
      pos,
      TileMode_Clamp,
    );
  }

  /** Dash PathEffect memoized by intervals + offset. */
  private dashEffect(intervals: number[], offset: number): SkPathEffect {
    const key = `${intervals.join(",")}|${offset}`;
    let e = this.dashCache.get(key);
    if (!e) {
      if (this.dashCache.size >= DASH_CACHE_CAP) this.dashCache.clear();
      e = this.skia.PathEffect.MakeDash(intervals, offset);
      this.dashCache.set(key, e);
    }
    return e;
  }

  /**
   * Commands -> SkPath, memoized by array reference (stable for static paths, fresh when animated).
   * NOTE: clip paths are re-sliced per reset so always miss. Fill type is never memoized.
   */
  private buildPath(commands: PathCommand[]): SkPath {
    let path = this.pathCache.get(commands);
    if (!path) {
      path = this.skia.Path.Make();
      applyCommandsToPath(new SkPathSink(path), commands);
      this.pathCache.set(commands, path);
    }
    return path;
  }
}

/** CSS font-weight -> SkFontStyle weight; bold 700, anything else unrecognized 400. */
function cssFontWeight(weight: string): number {
  if (weight === "bold") return 700;
  const n = parseInt(weight, 10);
  return Number.isFinite(n) && n > 0 ? n : 400;
}

/** SkPath as a PathSink, so applyCommandsToPath does the realization. */
class SkPathSink implements PathSink {
  constructor(private path: SkPath) {}

  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.path.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.path.quadTo(cpx, cpy, x, y);
  }

  // NOTE: no current-point-continuing center arc on SkPath; sampled at 24 segments.
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    const a0 = startAngle;
    let a1 = endAngle;
    if (!counterclockwise && a1 < a0) a1 += Math.PI * 2;
    if (counterclockwise && a1 > a0) a1 -= Math.PI * 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const t = a0 + (a1 - a0) * (i / steps);
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      this.path.lineTo(x + ex * cos - ey * sin, y + ex * sin + ey * cos);
    }
  }

  closePath(): void {
    this.path.close();
  }
}
