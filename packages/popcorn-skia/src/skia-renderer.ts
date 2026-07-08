import type {
  Renderer,
  Color,
  PathCommand,
  Matrix3x3,
  GradientData,
  ResolvedClip,
  TrimDescriptor,
  StrokeLineCap,
  StrokeLineJoin,
  FillRule,
  MaskMode,
  PaintOrder,
  PathSink,
} from '@popcorn/player';
import {
  colorToCSS,
  applyCommandsToPath,
  computePathBounds,
  multiplyMatrices,
  invertMatrix,
  IDENTITY_MATRIX,
} from '@popcorn/player';

// react-native-skia types only — inline `import(...)` type refs are erased at
// runtime, so this file loads under `bun test` without the native module. The
// `Skia` API object is injected via the constructor (see PopcornView for the
// real wiring, and the test for a mock).
type SkiaApi = typeof import('@shopify/react-native-skia').Skia;
type SkCanvas = import('@shopify/react-native-skia').SkCanvas;
type SkPaint = import('@shopify/react-native-skia').SkPaint;
type SkPath = import('@shopify/react-native-skia').SkPath;
type SkShader = import('@shopify/react-native-skia').SkShader;
type SkColor = import('@shopify/react-native-skia').SkColor;

type Bounds = { x: number; y: number; width: number; height: number };

// Mirror the (stable) @shopify/react-native-skia enum values so we never import
// them at runtime (that would pull the native module into the test). These match
// the underlying Skia C++ enums and haven't moved.
const PaintStyle = { Fill: 0, Stroke: 1 } as const;
const StrokeCap = { butt: 0, round: 1, square: 2 } as const;   // SkStrokeCap
const StrokeJoin = { miter: 0, round: 1, bevel: 2 } as const;  // SkStrokeJoin
const FillType = { nonzero: 0, evenodd: 1 } as const;          // Winding, EvenOdd
const TileMode_Clamp = 0;                                       // TileMode.Clamp
const ClipOp_Intersect = 1;                                     // ClipOp.Intersect
const BlendMode_DstIn = 6;                                      // SkBlendMode.DstIn:  r = d * sa
const BlendMode_DstOut = 8;                                     // SkBlendMode.DstOut: r = d * (1-sa)

// Luminance -> alpha colour matrix (4x5, RGBA row-major, last column = bias).
// Zeroes RGB and writes Rec.709 luma into alpha, so a luminance matte becomes an
// alpha matte the DstIn/DstOut blend below consumes. Matches Canvas2DRenderer's
// luminanceToAlpha coefficients.
// ponytail: unlike the Canvas2D path this ignores the mask's own alpha (can't
// express luma*alpha as a linear matrix); fine for the usual opaque luma matte.
const LUMA_TO_ALPHA_MATRIX = [
  0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
];

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * React Native Skia implementation of the Renderer interface (PoC).
 *
 * Draws onto an `SkCanvas` bound per frame via `setCanvas`. Semantics mirror
 * Canvas2DRenderer: pending paint state configured by set* calls, fill-then-
 * stroke (or stroke-then-fill for paint-order: stroke), gradient geometry ported
 * verbatim, opacity multiplied into paint alpha with save/restore nesting.
 */
export class SkiaRenderer implements Renderer {
  private skia: SkiaApi;
  private canvas: SkCanvas | null = null;
  private width: number;
  private height: number;

  private fillColor: string | null = '#000000';
  private strokeColor: string | null = null;
  private strokeWidth = 1;
  private fillGradient: GradientData | null = null;
  private strokeGradient: GradientData | null = null;
  private lineCap: StrokeLineCap = 'butt';
  private lineJoin: StrokeLineJoin = 'miter';
  private miterLimit = 4;
  private trim: TrimDescriptor | null = null;
  private dashArray: number[] = [];
  private dashOffset = 0;
  private fillRule: FillRule = 'nonzero';
  private paintOrder: PaintOrder = 'normal';

  // Opacity is Skia's missing globalAlpha: track it and push/pop it with the
  // native save/restore so a group's alpha cascades to its children.
  private opacity = 1;
  private opacityStack: number[] = [];

  // SkCanvas has no setMatrix, only concat (relative). We mirror the CTM in JS
  // and push/pop it in lockstep with the native save/restore, so setTransform can
  // reach an ABSOLUTE matrix via `concat(invert(current) · target)`. Kept alongside
  // (not via restoreToCount) so setTransform never disturbs active clips.
  private ctm: Matrix3x3 = IDENTITY_MATRIX;
  private ctmStack: Matrix3x3[] = [];

  // Reused across every shape so we don't allocate a native SkPaint per draw (the
  // hot-path allocation the profile flagged). `reset()` returns each to its
  // default before we reconfigure it; drawRect/drawPath copy the paint state into
  // the recorded op, so a single instance per role is safe. Parsed colours are
  // cached too — Skia.Color re-parses the CSS string on every call otherwise.
  private fillPaint: SkPaint;
  private strokePaint: SkPaint;
  private colorCache = new Map<string, SkColor>();

  constructor(skia: SkiaApi, opts: { width: number; height: number }) {
    this.skia = skia;
    this.width = opts.width;
    this.height = opts.height;
    this.fillPaint = skia.Paint();
    this.strokePaint = skia.Paint();
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

  clear(): void {
    // No-op: each frame records into a fresh (blank) picture canvas.
  }

  beginFrame(): void {
    this.opacity = 1;
    this.opacityStack.length = 0;
    // Fresh recorder canvas starts at identity; resync the mirror to match.
    this.ctm = IDENTITY_MATRIX;
    this.ctmStack.length = 0;
  }

  endFrame(): void {
    // No-op (immediate mode into the recorder).
  }

  // --- Shapes ----------------------------------------------------------------

  drawRect(x: number, y: number, w: number, h: number, rx = 0, ry = 0): void {
    const rect = this.skia.XYWHRect(x, y, w, h);
    const bounds: Bounds = { x, y, width: w, height: h };
    if (rx > 0 || ry > 0) {
      const rr = this.skia.RRectXY(rect, rx, ry);
      this.fillAndStroke(bounds, (p) => this.canvas!.drawRRect(rr, p));
    } else {
      this.fillAndStroke(bounds, (p) => this.canvas!.drawRect(rect, p));
    }
  }

  drawCircle(cx: number, cy: number, r: number): void {
    const bounds: Bounds = { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    this.fillAndStroke(bounds, (p) => this.canvas!.drawCircle(cx, cy, r, p));
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number): void {
    const rect = this.skia.XYWHRect(cx - rx, cy - ry, rx * 2, ry * 2);
    const bounds: Bounds = { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
    this.fillAndStroke(bounds, (p) => this.canvas!.drawOval(rect, p));
  }

  drawPath(commands: PathCommand[]): void {
    const path = this.buildPath(commands);
    path.setFillType(FillType[this.fillRule]);
    this.fillAndStroke(computePathBounds(commands), (p) => this.canvas!.drawPath(path, p));
  }

  // ponytail: fonts deferred — RN Skia needs an SkFont/typeface loaded async,
  // out of scope for the PoC. Text nodes paint nothing.
  drawText(): void {}

  // ponytail: images deferred — no async decode/cache seam wired for RN Skia yet.
  drawImage(): void {}

  clip(clip: ResolvedClip): void {
    if (!this.canvas) return;
    if (clip.type === 'rect') {
      this.canvas.clipRect(this.skia.XYWHRect(clip.x, clip.y, clip.width, clip.height), ClipOp_Intersect, true);
      return;
    }
    let path: SkPath;
    if (clip.type === 'circle') {
      path = this.skia.Path.Make();
      path.addCircle(clip.cx, clip.cy, clip.r);
    } else {
      path = this.buildPath(clip.commands);
      path.setFillType(FillType[this.fillRule]);
    }
    this.canvas.clipPath(path, ClipOp_Intersect, true);
  }

  // Track-matte compositing via nested layers (mirrors Canvas2DRenderer):
  //   L1 (content layer) <- drawContent
  //     L2 (mask layer, DstIn/DstOut paint, +luma filter) <- drawMask
  //   restore L2  => mask alpha keeps/erases content (DstIn: r=d·sa)
  //   restore L1  => masked content painted onto the canvas (source-over)
  // The closures each call setTransform (absolute, per the CTM mirror) to place
  // their subtree at its world position. Everything is bracketed so the CTM and
  // clip state are clean afterwards.
  compositeMask(mode: MaskMode, drawContent: () => void, drawMask: () => void): void {
    const canvas = this.canvas;
    if (!canvas) { drawContent(); return; }

    const savedCtm = this.ctm;
    const savedOpacity = this.opacity;

    const invert = mode === 'alpha-invert' || mode === 'luminance-invert';
    const maskPaint = this.skia.Paint();
    maskPaint.setBlendMode(invert ? BlendMode_DstOut : BlendMode_DstIn);
    if (mode === 'luminance' || mode === 'luminance-invert') {
      maskPaint.setColorFilter(this.skia.ColorFilter.MakeMatrix(LUMA_TO_ALPHA_MATRIX));
    }

    canvas.save();          // outer bracket: restores CTM + clip afterwards
    canvas.saveLayer();     // L1: content
    drawContent();
    canvas.saveLayer(maskPaint); // L2: mask (blended down onto L1 on restore)
    drawMask();
    canvas.restore();       // composite L2 -> L1 (DstIn / DstOut)
    canvas.restore();       // composite L1 -> canvas (source-over)
    canvas.restore();       // outer bracket

    this.ctm = savedCtm;
    this.opacity = savedOpacity;
  }

  // --- Style -----------------------------------------------------------------

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
    // PathEffect.MakeDash requires an even-length interval array; an odd array
    // means [on,off,on] — duplicate it so the pattern repeats correctly (Canvas2D
    // does this implicitly in setLineDash).
    this.dashArray = dashArray.length % 2 ? dashArray.concat(dashArray) : dashArray;
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

  // --- Transform stack -------------------------------------------------------

  save(): void {
    this.canvas?.save();
    this.opacityStack.push(this.opacity);
    this.ctmStack.push(this.ctm);
  }

  restore(): void {
    this.canvas?.restore();
    this.opacity = this.opacityStack.pop() ?? 1;
    this.ctm = this.ctmStack.pop() ?? IDENTITY_MATRIX;
  }

  // Matrix3x3 is row-major [a,b,tx,c,d,ty,0,0,1] — Skia's concat takes exactly
  // that 3x3 row-major array, so it maps directly (no (a,c,b,d,e,f) shuffle).
  transform(m: Matrix3x3): void {
    this.canvas?.concat([...m]);
    this.ctm = multiplyMatrices(this.ctm, m);
  }

  // ABSOLUTE set (mirrors Canvas2DRenderer.setTransform, which replaces the CTM).
  // SkCanvas only has relative concat, so reach `m` by pre-cancelling the current
  // CTM: concat(invert(current) · m). Leaves any active clip untouched, unlike a
  // restoreToCount reset (mask closures call this mid-walk under ancestor clips).
  setTransform(m: Matrix3x3): void {
    const delta = multiplyMatrices(invertMatrix(this.ctm), m);
    this.canvas?.concat([...delta]);
    this.ctm = m;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  // --- Internals -------------------------------------------------------------

  /** Paint fill then stroke (or the reverse for paint-order: stroke). */
  private fillAndStroke(bounds: Bounds, draw: (paint: SkPaint) => void): void {
    if (!this.canvas) return;
    const fill = () => {
      const p = this.makeFillPaint(bounds);
      if (p) draw(p);
    };
    const stroke = () => {
      const p = this.makeStrokePaint(bounds);
      if (p) draw(p);
    };
    if (this.paintOrder === 'stroke') {
      stroke();
      fill();
    } else {
      fill();
      stroke();
    }
  }

  private makeFillPaint(bounds: Bounds): SkPaint | null {
    if (this.fillGradient) {
      const paint = this.fillPaint;
      paint.reset();
      paint.setAntiAlias(true);
      paint.setStyle(PaintStyle.Fill);
      paint.setShader(this.makeShader(this.fillGradient, bounds));
      paint.setAlphaf(this.opacity); // paint alpha modulates the shader
      return paint;
    }
    if (this.fillColor) {
      const paint = this.fillPaint;
      paint.reset();
      paint.setAntiAlias(true);
      paint.setStyle(PaintStyle.Fill);
      const c = this.color(this.fillColor);
      paint.setColor(c);
      paint.setAlphaf(c[3] * this.opacity);
      return paint;
    }
    return null;
  }

  private makeStrokePaint(bounds: Bounds): SkPaint | null {
    const hasStroke = this.strokeGradient || this.strokeColor;
    if (!hasStroke) return null;
    // An empty trim window strokes nothing.
    if (this.trim && !this.trim.visible) return null;

    const paint = this.strokePaint;
    paint.reset();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(this.strokeWidth);
    paint.setStrokeCap(StrokeCap[this.lineCap]);
    paint.setStrokeJoin(StrokeJoin[this.lineJoin]);
    paint.setStrokeMiter(this.miterLimit);

    // Trim wins over an authored dasharray (both share the single dash slot),
    // matching Canvas2DRenderer.
    if (this.trim && this.trim.dashArray.length > 0) {
      paint.setPathEffect(this.skia.PathEffect.MakeDash(this.trim.dashArray, this.trim.dashOffset));
    } else if (!this.trim && this.dashArray.length > 0) {
      paint.setPathEffect(this.skia.PathEffect.MakeDash(this.dashArray, this.dashOffset));
    }

    if (this.strokeGradient) {
      paint.setShader(this.makeShader(this.strokeGradient, bounds));
      paint.setAlphaf(this.opacity);
    } else {
      const c = this.color(this.strokeColor!);
      paint.setColor(c);
      paint.setAlphaf(c[3] * this.opacity);
    }
    return paint;
  }

  /**
   * Port of Canvas2DRenderer.realizeGradient: resolve a gradient descriptor to a
   * concrete shader against the shape's local bounding box. Linear angle follows
   * CSS (0deg = up, 90deg = right); radial is a circle at the box centre with
   * radius = half the box diagonal, unless explicit geometry is given.
   */
  private makeShader(g: GradientData, b: Bounds): SkShader {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const colors = g.stops.map((s) => this.color(s.color));
    const pos = g.stops.map((s) => clamp01(s.offset));

    if (g.type === 'linear-gradient') {
      let p0: { x: number; y: number };
      let p1: { x: number; y: number };
      if (g.from && g.to) {
        p0 = g.from;
        p1 = g.to;
      } else {
        const rad = (g.angle * Math.PI) / 180;
        const dx = Math.sin(rad);
        const dy = -Math.cos(rad);
        const len = Math.abs(b.width * dx) + Math.abs(b.height * dy);
        p0 = { x: cx - (dx * len) / 2, y: cy - (dy * len) / 2 };
        p1 = { x: cx + (dx * len) / 2, y: cy + (dy * len) / 2 };
      }
      return this.skia.Shader.MakeLinearGradient(p0, p1, colors, pos, TileMode_Clamp);
    }

    if (g.at && g.radius != null) {
      const f = g.focal ?? g.at;
      // Focal highlight => two-point conical (inner radius 0 at the focal point),
      // exactly mirroring canvas createRadialGradient(f, 0, at, radius).
      if (f.x !== g.at.x || f.y !== g.at.y) {
        return this.skia.Shader.MakeTwoPointConicalGradient(f, 0, g.at, g.radius, colors, pos, TileMode_Clamp);
      }
      return this.skia.Shader.MakeRadialGradient(g.at, g.radius, colors, pos, TileMode_Clamp);
    }

    const r = Math.hypot(b.width, b.height) / 2;
    return this.skia.Shader.MakeRadialGradient({ x: cx, y: cy }, r, colors, pos, TileMode_Clamp);
  }

  /** Realize SVG-style path commands into an SkPath via the shared applyCommandsToPath. */
  private buildPath(commands: PathCommand[]): SkPath {
    const path = this.skia.Path.Make();
    applyCommandsToPath(new SkPathSink(path), commands);
    return path;
  }
}

/**
 * Adapts an SkPath to the PathSink interface so path realization (incl. smooth-
 * curve reflection and arc conversion) reuses @popcorn/player's applyCommandsToPath.
 */
class SkPathSink implements PathSink {
  constructor(private path: SkPath) {}

  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.path.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.path.quadTo(cpx, cpy, x, y);
  }

  // ponytail: SkPath has no center-parameterized arc that continues from the
  // current point, so sample the (already SVG->center converted) arc into line
  // segments. Fine for the rare A command; smooth enough at 24 steps.
  ellipse(
    x: number, y: number, rx: number, ry: number, rotation: number,
    startAngle: number, endAngle: number, counterclockwise = false
  ): void {
    let a0 = startAngle;
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
