import type {
  GradientData,
  MaskMode,
  Matrix3x3,
  PathCommand,
  PathSink,
  Renderer,
  ResolvedClip,
} from "@popcorn/player";
import {
  applyCommandsToPath,
  computePathBounds,
  LUMA_COEFFICIENTS,
  PaintStateRenderer,
  paintOrderSequence,
  resolveGradient,
  resolveStrokeDash,
} from "@popcorn/player";

// react-native-skia types only — inline `import(...)` type refs are erased at
// runtime, so this file loads under `bun test` without the native module. The
// `Skia` API object is injected via the constructor (see PopcornView for the
// real wiring, and the test for a mock).
type SkiaApi = typeof import("@shopify/react-native-skia").Skia;
type SkCanvas = import("@shopify/react-native-skia").SkCanvas;
type SkPaint = import("@shopify/react-native-skia").SkPaint;
type SkPath = import("@shopify/react-native-skia").SkPath;
type SkShader = import("@shopify/react-native-skia").SkShader;
type SkColor = import("@shopify/react-native-skia").SkColor;
type SkPathEffect = import("@shopify/react-native-skia").SkPathEffect;

type Bounds = { x: number; y: number; width: number; height: number };

// Bounds only feed gradient shaders; a shape with no gradient never reads them,
// so we hand it this shared zero box instead of scanning its geometry.
const ZERO_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0 };

// Entry caps for the value-keyed caches below (shader, dash). A morphing
// gradient / dash produces a fresh key every frame; cap + clear keeps those
// from growing without bound. Static scenes stay well under the cap.
const SHADER_CACHE_CAP = 64;
const DASH_CACHE_CAP = 64;

// Mirror the (stable) @shopify/react-native-skia enum values so we never import
// them at runtime (that would pull the native module into the test). These match
// the underlying Skia C++ enums and haven't moved.
const PaintStyle = { Fill: 0, Stroke: 1 } as const;
const StrokeCap = { butt: 0, round: 1, square: 2 } as const; // SkStrokeCap
const StrokeJoin = { miter: 0, round: 1, bevel: 2 } as const; // SkStrokeJoin
const FillType = { nonzero: 0, evenodd: 1 } as const; // Winding, EvenOdd
const TileMode_Clamp = 0; // TileMode.Clamp
const ClipOp_Intersect = 1; // ClipOp.Intersect
const BlendMode_DstIn = 6; // SkBlendMode.DstIn:  r = d * sa
const BlendMode_DstOut = 8; // SkBlendMode.DstOut: r = d * (1-sa)

// Luminance -> alpha colour matrix (4x5, RGBA row-major, last column = bias).
// Zeroes RGB and writes Rec.709 luma into alpha, so a luminance matte becomes an
// alpha matte the DstIn/DstOut blend below consumes. Matches Canvas2DRenderer's
// luminanceToAlpha coefficients.
// NOTE: unlike the Canvas2D path this ignores the mask's own alpha (can't
// express luma*alpha as a linear matrix); fine for the usual opaque luma matte.
const LUMA_TO_ALPHA_MATRIX = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  LUMA_COEFFICIENTS.r,
  LUMA_COEFFICIENTS.g,
  LUMA_COEFFICIENTS.b,
  0,
  0,
];

/**
 * React Native Skia implementation of the Renderer interface (PoC).
 *
 * Draws onto an `SkCanvas` bound per frame via `setCanvas`. Semantics mirror
 * Canvas2DRenderer: pending paint state configured by set* calls, fill-then-
 * stroke (or stroke-then-fill for paint-order: stroke), gradient geometry ported
 * verbatim, opacity multiplied into paint alpha with save/restore nesting.
 */
export class SkiaRenderer extends PaintStateRenderer implements Renderer {
  private skia: SkiaApi;
  private canvas: SkCanvas | null = null;
  private width: number;
  private height: number;

  // Sticky paint state (fill/stroke/trim/dash/opacity/…) and the JS CTM mirror
  // (ctm + ctmStack) are inherited from PaintStateRenderer. SkCanvas has no
  // setMatrix (only relative concat), so setTransform reaches an ABSOLUTE matrix
  // via the base's setCtmAbsolute (concat of invert(current)·target) — kept
  // alongside the native save/restore so it never disturbs active clips.

  // Opacity is Skia's missing globalAlpha: the base tracks the value; we push/pop
  // it with the native save/restore so a group's alpha cascades to its children.
  private opacityStack: number[] = [];

  // Reused across every shape so we don't allocate a native SkPaint per draw (the
  // hot-path allocation the profile flagged). `reset()` returns each to its
  // default before we reconfigure it; drawRect/drawPath copy the paint state into
  // the recorded op, so a single instance per role is safe. Parsed colours are
  // cached too — Skia.Color re-parses the CSS string on every call otherwise.
  private fillPaint: SkPaint;
  private strokePaint: SkPaint;
  // Lazily pooled compositing paint for compositeMask (reset + reconfigured per
  // mask, like fill/strokePaint). Allocated on first mask so a mask-free scene
  // never pays for it.
  private maskPaint: SkPaint | null = null;
  private colorCache = new Map<string, SkColor>();

  // Per-frame rebuild caches. drawPath/buildPath/clip otherwise realize a fresh
  // SkPath, SkShader and dash PathEffect every frame; these memoize the static
  // (unchanging) cases so only genuinely animated geometry rebuilds. See each
  // cache's use site for its key + invalidation rationale.
  private pathCache = new WeakMap<PathCommand[], SkPath>();
  private shaderCache = new Map<string, SkShader>();
  private dashCache = new Map<string, SkPathEffect>();

  constructor(skia: SkiaApi, opts: { width: number; height: number }) {
    super();
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
    this.resetCtm();
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
    const bounds: Bounds = {
      x: cx - r,
      y: cy - r,
      width: r * 2,
      height: r * 2,
    };
    this.fillAndStroke(bounds, (p) => this.canvas!.drawCircle(cx, cy, r, p));
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number): void {
    const rect = this.skia.XYWHRect(cx - rx, cy - ry, rx * 2, ry * 2);
    const bounds: Bounds = {
      x: cx - rx,
      y: cy - ry,
      width: rx * 2,
      height: ry * 2,
    };
    this.fillAndStroke(bounds, (p) => this.canvas!.drawOval(rect, p));
  }

  drawPath(commands: PathCommand[]): void {
    const path = this.buildPath(commands);
    path.setFillType(FillType[this.fillRule]);
    // Only a gradient paint consumes bounds, so skip the full command scan
    // (computePathBounds) for the common flat-fill/stroke path.
    const bounds =
      this.fillGradient || this.strokeGradient
        ? computePathBounds(commands)
        : ZERO_BOUNDS;
    this.fillAndStroke(bounds, (p) => this.canvas!.drawPath(path, p));
  }

  // NOTE: fonts deferred — RN Skia needs an SkFont/typeface loaded async,
  // out of scope for the PoC. Text nodes paint nothing.
  drawText(): void {}

  // NOTE: images deferred — no async decode/cache seam wired for RN Skia yet.
  drawImage(): void {}

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

  // Track-matte compositing via nested layers (mirrors Canvas2DRenderer):
  //   L1 (content layer) <- drawContent
  //     L2 (mask layer, DstIn/DstOut paint, +luma filter) <- drawMask
  //   restore L2  => mask alpha keeps/erases content (DstIn: r=d·sa)
  //   restore L1  => masked content painted onto the canvas (source-over)
  // The closures each call setTransform (absolute, per the CTM mirror) to place
  // their subtree at its world position. Everything is bracketed so the CTM and
  // clip state are clean afterwards.
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

    const invert = mode === "alpha-invert" || mode === "luminance-invert";
    this.maskPaint ??= this.skia.Paint();
    const maskPaint = this.maskPaint;

    canvas.save(); // outer bracket: restores CTM + clip afterwards
    canvas.saveLayer(); // L1: content
    drawContent();
    // Re-entrancy: a nested track matte inside drawContent reuses this single
    // pooled maskPaint, so we must configure it *after* drawContent — right
    // before the layer that reads it — or the nested call's reset/reconfigure
    // would clobber our blend + luma filter. saveLayer snapshots the paint into
    // the layer at call time, so a nested matte in drawMask can't corrupt this
    // already-opened layer either. (Mirrors Canvas2D's per-depth buffer bands.)
    maskPaint.reset();
    maskPaint.setBlendMode(invert ? BlendMode_DstOut : BlendMode_DstIn);
    if (mode === "luminance" || mode === "luminance-invert") {
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

  // Sticky paint state setters are inherited from PaintStateRenderer, except
  // setDash, which even-izes the interval array for Skia's PathEffect.MakeDash.
  setDash(dashArray: number[], dashOffset: number): void {
    // PathEffect.MakeDash requires an even-length interval array; an odd array
    // means [on,off,on] — duplicate it so the pattern repeats correctly (Canvas2D
    // does this implicitly in setLineDash).
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

  // Matrix3x3 is row-major [a,b,tx,c,d,ty,0,0,1] — Skia's concat takes exactly
  // that 3x3 row-major array, so it maps directly (no (a,c,b,d,e,f) shuffle).
  transform(m: Matrix3x3): void {
    // concat copies the floats synchronously (never retains/mutates the array),
    // so pass `m` straight through — no defensive spread.
    this.canvas?.concat(m);
    this.concatCtm(m);
  }

  // ABSOLUTE set (mirrors Canvas2DRenderer.setTransform, which replaces the CTM).
  // SkCanvas only has relative concat, so reach `m` by pre-cancelling the current
  // CTM (base.setCtmAbsolute returns that delta). Leaves any active clip untouched,
  // unlike a restoreToCount reset (mask closures call this mid-walk under clips).
  setTransform(m: Matrix3x3): void {
    // `delta` is a fresh array and concat copies it synchronously.
    this.canvas?.concat(this.setCtmAbsolute(m));
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  resize(width: number, height: number): void {
    // The PictureRecorder canvas is bound per frame via setCanvas at the host's
    // chosen size; we just track the reported dimensions for getWidth/getHeight.
    this.width = width;
    this.height = height;
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
    for (const which of paintOrderSequence(this.paintOrder)) {
      if (which === "fill") fill();
      else stroke();
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
    // Trim/dash precedence shared with the other backends (trim wins over an
    // authored dasharray; an empty trim window strokes nothing).
    const dash = resolveStrokeDash(this.trim, this.dashArray, this.dashOffset);
    if (!dash.stroke) return null;

    const paint = this.strokePaint;
    paint.reset();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(this.strokeWidth);
    paint.setStrokeCap(StrokeCap[this.lineCap]);
    paint.setStrokeJoin(StrokeJoin[this.lineJoin]);
    paint.setStrokeMiter(this.miterLimit);

    if (dash.dashArray.length > 0) {
      paint.setPathEffect(this.dashEffect(dash.dashArray, dash.dashOffset));
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
    // The reset walk deep-copies gradients every frame (scene/types.ts), so the
    // descriptor's object identity is useless as a key — serialize its value +
    // the bounds instead. Cheap next to rebuilding the shader (colour parse +
    // stops arrays) each frame; a morphing gradient produces a fresh key per
    // frame and rebuilds (capped so it can't grow unbounded).
    const key = `${JSON.stringify(g)}|${b.x},${b.y},${b.width},${b.height}`;
    const hit = this.shaderCache.get(key);
    if (hit) return hit;
    const shader = this.buildShader(g, b);
    if (this.shaderCache.size >= SHADER_CACHE_CAP) this.shaderCache.clear();
    this.shaderCache.set(key, shader);
    return shader;
  }

  private buildShader(g: GradientData, b: Bounds): SkShader {
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

    // Focal highlight => two-point conical (inner radius 0 at the focal point),
    // exactly mirroring canvas createRadialGradient(focal, 0, centre, radius).
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

  /** Memoize the dash PathEffect by interval-contents + offset (rebuilt each frame otherwise). */
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
   * Realize SVG-style path commands into an SkPath via the shared
   * applyCommandsToPath, memoized on the commands array *reference*.
   *
   * resetNodeToBase copies the base commands array by reference for a static
   * path (Object.assign), so its reference is stable frame-to-frame and doubles
   * as a free dirty check — a cache hit is provably the same geometry. An
   * animated `d` swaps in a fresh array every frame (registry `d.apply`), a
   * natural miss that rebuilds. The WeakMap lets those transient arrays GC.
   *
   * NOTE: clip paths miss every frame — cloneClipPath re-slices their
   * commands into a fresh array per reset (scene/types.ts), so reference keying
   * can't hit. They rebuild (as before); caching them would need a per-node
   * cache seam threaded through drawPath/clip, not worth it while clips are rare
   * vs draw paths. Fill type is NEVER memoized: every caller re-applies
   * setFillType (draw and clip use different winding on potentially the same
   * geometry).
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

  // NOTE: SkPath has no center-parameterized arc that continues from the
  // current point, so sample the (already SVG->center converted) arc into line
  // segments. Fine for the rare A command; smooth enough at 24 steps.
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
