import type { DeviceRect } from "../scene/bounds.js";
import type {
  BlendMode,
  FillRule,
  MaskMode,
  PaintOrder,
  StrokeLineCap,
  StrokeLineJoin,
  TextAnchor,
} from "../scene/types.js";
import type {
  Color,
  CornerRadii,
  GradientData,
  Matrix3x3,
  PathCommand,
  ResolvedClip,
  TrimDescriptor,
} from "./types.js";

/** Primitive-level paint interface implemented by the Canvas2D, SVG and Skia backends. */
export interface Renderer {
  // Frame lifecycle
  clear(): void;
  beginFrame(): void;
  endFrame(): void;

  // Brackets one node's draws with a frame-stable key so a retained backend (SVG) can diff per node.
  beginNode?(key: string): void;
  endNode?(): void;

  // `corners` ([tl, tr, br, bl] border-radius) overrides rx/ry when present.
  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    rx?: number,
    ry?: number,
    corners?: CornerRadii,
  ): void;
  drawCircle(cx: number, cy: number, r: number): void;
  drawEllipse(cx: number, cy: number, rx: number, ry: number): void;
  drawPath(commands: PathCommand[]): void;
  // One line of text; the shared walk splits lines. NOTE: letterSpacing is a pinned no-op on Skia.
  drawText(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    fontFamily: string,
    fontWeight: string,
    anchor: TextAnchor,
    letterSpacing?: number,
  ): void;
  // w/h <= 0 means natural size; sx/sy/sw/sh (all four) select a source sub-rect. Paints nothing until decoded.
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
  ): void;
  // Resolves once no image decodes are in flight; offline export awaits it between seek and render.
  whenImagesSettled?(): Promise<void>;

  // Clip the current node and its descendants to a region (in local space).
  clip(clip: ResolvedClip): void;

  // Masks drawContent by drawMask per `mode`; `region` (device px) bounds the composite, omitted = whole buffer.
  compositeMask(
    mode: MaskMode,
    drawContent: () => void,
    drawMask: () => void,
    region?: DeviceRect,
  ): void;

  // CSS filter composite; absent or unsupported degrades to drawing unfiltered.
  supportsFilter?(): boolean;
  compositeFilter?(
    filter: string,
    drawContent: () => void,
    region?: DeviceRect,
  ): void;
  // True = filter string is scaled by the node's local scale only (parent CTM applies the rest), not world scale.
  filtersUseUserSpace?(): boolean;

  // Composite raster cache: same key+signature+region blits the stored raster without running `draw`.
  supportsRasterCache?(): boolean;
  cacheComposite?(
    key: string,
    signature: string,
    region: DeviceRect,
    draw: () => void,
  ): void;

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
  // Empty array = solid; ignored while a trim is active.
  setDash(dashArray: number[], dashOffset: number): void;
  // Fill winding rule for the next path/star/polygon fill and clip.
  setFillRule(rule: FillRule): void;
  // Paint order for the next shape: 'stroke' draws stroke behind fill.
  setPaintOrder(order: PaintOrder): void;
  setOpacity(opacity: number): void;
  // CSS mix-blend-mode; the walk brackets a shape draw with mode then 'normal'.
  setBlendMode(mode: BlendMode): void;

  // Transform stack
  save(): void;
  restore(): void;
  transform(matrix: Matrix3x3): void; // multiply current transform by matrix
  setTransform(matrix: Matrix3x3): void;

  // Canvas dimensions
  getWidth(): number;
  getHeight(): number;
  // Resize the backing store to device px (host calls on layout/DPR change).
  resize(width: number, height: number): void;
}
