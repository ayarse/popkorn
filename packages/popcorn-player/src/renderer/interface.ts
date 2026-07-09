import type {
  FillRule,
  MaskMode,
  PaintOrder,
  StrokeLineCap,
  StrokeLineJoin,
  TextAnchor,
} from "../scene/types";
import type {
  Color,
  GradientData,
  Matrix3x3,
  PathCommand,
  ResolvedClip,
  TrimDescriptor,
} from "./types";

/**
 * Abstract renderer interface (ThorVG-style)
 * This interface allows swapping between Canvas2D (PoC) and ThorVG (future)
 */
export interface Renderer {
  // Frame lifecycle
  clear(): void;
  beginFrame(): void;
  endFrame(): void;

  // Retained-backend hook: brackets all draw calls belonging to one scene node.
  // Keys are stable across frames and nest to mirror the tree, so a retained
  // backend (SVG) can get-or-create one element per node and diff it. Immediate-
  // mode backends (Canvas2D/Skia) omit these entirely.
  beginNode?(key: string): void;
  endNode?(): void;

  // Shape rendering
  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    rx?: number,
    ry?: number,
  ): void;
  drawCircle(cx: number, cy: number, r: number): void;
  drawEllipse(cx: number, cy: number, rx: number, ry: number): void;
  drawPath(commands: PathCommand[]): void;
  drawText(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    fontFamily: string,
    fontWeight: string,
    anchor: TextAnchor,
  ): void;
  // Draw a cached image (by src) into the x/y/w/h box. w/h <= 0 means natural
  // size. Loading/caching is the renderer's concern; nothing paints until the
  // image decodes (the running loop repaints it in naturally).
  drawImage(src: string, x: number, y: number, w: number, h: number): void;
  // Optional: resolves once no image decodes are in flight (immediately if
  // none). A seek-driven offline export awaits this between seek and re-render
  // so decoded images paint; the live loop needn't call it. Callers feature-detect.
  whenImagesSettled?(): Promise<void>;

  // Clip the current node and its descendants to a region (in local space).
  clip(clip: ResolvedClip): void;

  // Track-mask composite. Paints `drawContent` and `drawMask` into offscreen
  // buffers (each closure sets its own world transform and draws a subtree),
  // masks the content by the mask per `mode`, and blits the result to the main
  // canvas. Degrades to drawing the content alone when offscreen isn't available.
  compositeMask(
    mode: MaskMode,
    drawContent: () => void,
    drawMask: () => void,
  ): void;

  // CSS filter compositing. Optional so backends without a filter concept (or
  // where the platform ctx.filter is unsupported) simply omit it and the loop
  // degrades to drawing unfiltered. `supportsFilter` feature-detects at runtime;
  // `compositeFilter` paints `drawContent` (a subtree, at its own world
  // transform) into an offscreen and blits it back through `filter` (a CSS
  // filter string already scaled to device space by the caller).
  supportsFilter?(): boolean;
  compositeFilter?(filter: string, drawContent: () => void): void;
  // A device-space-blit backend (Canvas2D) wants the filter string pre-scaled by
  // the node's full world scale. A retained backend that applies the string as a
  // CSS `filter` on a group in the node's *parent* user space (SVG) instead gets
  // the CTM's scale for free, so it wants the string scaled by only the node's
  // own local scale. Return true for the latter. Feature-detected; default false.
  filtersUseUserSpace?(): boolean;

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
  // Stroke dash pattern + offset. Empty array => solid stroke. Ignored while a
  // trim window is active (trim wins).
  setDash(dashArray: number[], dashOffset: number): void;
  // Fill winding rule for the next path/star/polygon fill and clip.
  setFillRule(rule: FillRule): void;
  // Paint order for the next shape: 'stroke' draws stroke behind fill.
  setPaintOrder(order: PaintOrder): void;
  setOpacity(opacity: number): void;

  // Transform stack
  save(): void;
  restore(): void;
  transform(matrix: Matrix3x3): void; // multiply current transform by matrix
  setTransform(matrix: Matrix3x3): void;

  // Canvas dimensions
  getWidth(): number;
  getHeight(): number;
  // Resize the render surface's backing store to device px. Canvas2D sizes the
  // canvas element; SVG rewrites width/height + viewBox; Skia updates its
  // tracked dimensions. Called by the host on layout/DPR changes.
  resize(width: number, height: number): void;
}
