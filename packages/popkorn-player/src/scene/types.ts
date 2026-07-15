import type { MachineRule, Value } from "@popkorn/parser";
import type { PropValue } from "../animation/registry";
import type { CornerRadii, GradientData, PathCommand } from "../renderer/types";
import { cloneGradient } from "../renderer/types";
import type { MotionPath } from "./path-parser";

// CSS Motion Path offset-rotate: `auto` follows the path tangent; `angle` adds a
// fixed offset (auto + angle) or a fixed orientation (angle only, auto = false).
export interface OffsetRotate {
  auto: boolean;
  angle: number; // degrees
}

// Authored clip-path. Insets are stored relative to the node's bounding box and
// resolved to concrete geometry at render/hit-test time (see scene/clip.ts).
export type ClipPathData =
  | { type: "circle"; r: number; x: number; y: number }
  | { type: "inset"; top: number; right: number; bottom: number; left: number }
  | { type: "path"; commands: PathCommand[] };

// Scene node types
export type ShapeType =
  | "group"
  | "rect"
  | "circle"
  | "ellipse"
  | "path"
  | "text"
  | "star"
  | "polygon"
  | "image";

// Track-mask modes (Lottie tt): the mask source's alpha or luminance drives
// the masked node's visibility; the *-invert variants flip it.
export type MaskMode =
  | "alpha"
  | "alpha-invert"
  | "luminance"
  | "luminance-invert";

// CSS `filter` functions (the supported subset). blur/drop-shadow carry lengths
// authored in the node's LOCAL space; the renderer scales those by the node's
// world scale so a scaled element's blur/shadow scales with it (CSS semantics).
// The color-adjust functions (brightness…hue-rotate) are scale-free: `amount` is
// a fraction (1 = 100%) for all of them except hue-rotate, whose `amount` is an
// angle in degrees. The whole list animates via the registry's `filter` handler
// (per-op numeric lerp when two endpoints share the same function sequence, else
// a structural replace — see interpolateFilter).
export type FilterOp =
  | { type: "blur"; radius: number }
  | {
      type: "drop-shadow";
      dx: number;
      dy: number;
      blur: number;
      color: string;
      // box-shadow extras (a CSS `filter: drop-shadow()` leaves both at their
      // defaults). `spread` inflates the shadow shape; `inset` draws it inside
      // the box. Both are realized in the shared walk (see renderBoxShadows),
      // not expressible through the CSS-filter drop-shadow the outer/no-spread
      // case rides. The `box-shadow` list reuses this op so it animates through
      // the same interpolateFilter path as `filter`.
      spread?: number;
      inset?: boolean;
    }
  | { type: ColorFilterFn; amount: number };

// The single-scalar CSS filter functions that recolor rather than displace.
export type ColorFilterFn =
  | "brightness"
  | "contrast"
  | "saturate"
  | "grayscale"
  | "sepia"
  | "invert"
  | "opacity"
  | "hue-rotate";

// Fill winding rule; maps straight to CanvasFillRule / isPointInPath's ruleset.
export type FillRule = "nonzero" | "evenodd";

// CSS mix-blend-mode. Every keyword is shared by all three backends: Canvas2D
// globalCompositeOperation (normal -> 'source-over'), SVG `mix-blend-mode` style,
// Skia BlendMode. No CSS separable/non-separable mode is unmappable, so nothing
// is dropped. NOTE: applied per shape against the current backdrop (no group
// isolation) — a group's own mix-blend-mode doesn't composite its subtree as one.
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

// Text alignment; maps to CanvasRenderingContext2D.textAlign (left/center/right).
export type TextAnchor = "start" | "middle" | "end";

// Stroke line cap, maps straight to CanvasRenderingContext2D.lineCap.
export type StrokeLineCap = "butt" | "round" | "square";

// Stroke line join, maps straight to CanvasRenderingContext2D.lineJoin.
export type StrokeLineJoin = "miter" | "round" | "bevel";

// Paint order for a shape's own fill/stroke. 'normal' paints fill then stroke
// (stroke on top); 'stroke' paints stroke then fill (stroke behind the fill),
// matching SVG `paint-order: stroke`. Used when a Lottie group stroke sits below
// the fills it covers, so only the exposed edge (a seam) shows.
export type PaintOrder = "normal" | "stroke";

// CSS pointer-events (subset). `none` excludes a node's geometry from hit-testing
// AND removes its whole subtree from consideration — its descendants can't hit or
// bubble either. Static: not animatable, not state-block-overridable. Unlike CSS
// we do NOT support re-enabling: `pointer-events: auto` on a descendant of a
// `none` node is ignored (the subtree stays excluded).
export type PointerEvents = "auto" | "none";

// Interaction state types
export type InteractionState = "normal" | "hover" | "active";

// One resolved CSS transition: property `all` or a transitionable group name
// ('fill' | 'stroke' | 'stroke-width' | 'opacity' | 'transform'); duration/delay
// in ms. Governs how the property tweens when interaction state flips.
export interface TransitionSpec {
  property: string;
  duration: number; // ms
  easing: TimingFunction;
  delay: number; // ms
}

// A machine `:state()` conditional declaration set attached to a node. While the
// referenced machine is in the named state, `styles` (static declarations) apply
// and `animations` sample entry-anchored (see the StateMachineRunner + loop).
// `machine: null` = un-namespaced `:state(name)`, matching that state in ANY
// machine; a set name only matches its own machine.
export interface NodeStateStyle {
  machine: string | null;
  name: string;
  styles: StateStyles;
  animations: AnimationInstance[];
}

// State-specific styles for interactive elements. Paint comes in two mutually
// exclusive forms per channel: a solid `fill`/`stroke` string, OR a
// `fillGradient`/`strokeGradient` when the state declares a gradient. Whichever
// is present replaces the base paint outright (a gradient override clears the
// solid channel and vice-versa; see applyStateStyles). `undefined` = not
// declared by this state, leave the base paint alone.
export interface StateStyles {
  fill?: string | null;
  stroke?: string | null;
  fillGradient?: GradientData | null;
  strokeGradient?: GradientData | null;
  strokeWidth?: number;
  opacity?: number;
  transform?: Partial<Transform>;
  // Generic registry-backed overrides for every animatable property outside the
  // legacy channels above (geometry, trim, dash offset, offset-distance, `d`,
  // clip-path, filter, font-size, …). Keyed by CSS property name, valued by the
  // parsed endpoint the property's registry handler applies. Instant-snapped in
  // applyStateStyles (stage 1); replace semantics, same as fill.
  overrides?: Record<string, PropValue>;
  // Transitions declared inside this state block; when entering this state they
  // override the node-level transitions (CSS asymmetric enter/exit timing).
  transitions?: TransitionSpec[];
}

// Transform origin types
export type TransformOriginUnit = "px" | "%";

export interface TransformOriginValue {
  value: number;
  unit: TransformOriginUnit;
}

export interface TransformOrigin {
  x: TransformOriginValue;
  y: TransformOriginValue;
}

// Property binding - stores a variable reference for dynamic resolution
export interface PropertyBinding {
  property: string; // e.g., 'cx', 'cy', 'r', 'opacity'
  value: Value; // The variable reference or input() function
  // For string/keyword-valued properties (content, font-family, fill-rule, …)
  // that are neither numeric-registry nor color-paint bindings: re-apply the
  // resolved, var-free value through the builder's declaration switch each
  // frame. Set at build time for those properties; absent for transform/
  // numeric/color bindings, which applyBindings realizes inline.
  applyString?: (node: SceneNode, value: Value) => void;
}

export interface Transform {
  translateX: number;
  translateY: number;
  rotate: number; // degrees
  scaleX: number;
  scaleY: number;
  skewX: number; // degrees (CSS skewX / skew first arg)
  skewY: number; // degrees (CSS skewY / skew second arg)
  transformOrigin: TransformOrigin; // CSS transform-origin
}

export interface SceneNode {
  id: string;
  className?: string;
  type: ShapeType;

  // Hierarchy
  parent: SceneNode | null;
  children: SceneNode[];

  // Transform (local, relative to parent)
  transform: Transform;

  // Appearance
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;

  // Trim paths (Lottie-style): stroke-only, expressed as fractions 0..1 of the
  // outline length. start/end select the visible window; offset rotates the
  // start point around the outline (marching effect on closed shapes). All
  // three are animatable (see the registry's trim-* handlers).
  trimStart: number;
  trimEnd: number;
  trimOffset: number;
  strokeLineCap: StrokeLineCap;
  strokeLineJoin: StrokeLineJoin;
  // Miter limit for miter joins (maps to CanvasRenderingContext2D.miterLimit).
  // Canvas defaults to 10; SVG/Lottie default to 4, so sharp corners bevel
  // sooner. Only meaningful when strokeLineJoin is 'miter'.
  strokeMiterLimit: number;

  // Stroke dashing (independent of trim). strokeDashArray is static (a repeating
  // dash/gap pattern in local units); strokeDashOffset is animatable (registry).
  // When both a trim window and a dash array are present, trim wins and the dash
  // array is ignored (see canvas2d.applyFillAndStroke).
  strokeDashArray: number[];
  strokeDashOffset: number;

  // Fill winding rule (static); applies to path/star/polygon fill, hit-test and clip.
  fillRule: FillRule;

  // Paint order of this node's own fill/stroke (static). Default 'normal'.
  paintOrder: PaintOrder;

  // CSS mix-blend-mode: how this node's shape composites against the backdrop
  // already drawn. Default 'normal'. Set at build (or via a var() binding); the
  // shared walk brackets the shape draw with setBlendMode, backends realize it.
  mixBlendMode: BlendMode;

  // Whether this node (and its subtree) participate in hit-testing (static).
  // 'none' skips them entirely; see PointerEvents. Default 'auto'.
  pointerEvents: PointerEvents;

  // Cached total outline length (local units). Invalidated by the registry's
  // geometry apply functions (they set outlineLengthDirty); recomputed lazily
  // by outlineLength() so static shapes never pay per frame.
  cachedOutlineLength: number | null;
  outlineLengthDirty: boolean;

  // Cached measured text metrics (text nodes only; same lazy pattern as the
  // outline length). Invalidated when font-size animates (see the registry).
  cachedTextBounds: { width: number; height: number } | null;
  textBoundsDirty: boolean;

  // Cached synthesized path commands for star/polygon nodes (same lazy pattern
  // as the outline-length cache). Invalidated when an animatable polystar
  // geometry prop is applied (see the registry); recomputed by polystarCommands().
  cachedPolystarCommands: PathCommand[] | null;
  polystarDirty: boolean;

  // Gradient fill/stroke (static; when set, wins over the solid color above).
  fillGradient: GradientData | null;
  strokeGradient: GradientData | null;

  // Clip region for this node and its descendants (static).
  clipPath: ClipPathData | null;

  // Track mask: this node is composited against `source`'s alpha/luminance.
  // `source` is resolved by id at build time (any node in the scene). When set,
  // the renderer composites the two subtrees offscreen (see runtime/loop).
  mask: { source: SceneNode; mode: MaskMode } | null;
  // True when this node is referenced as some node's mask source: it is not
  // painted in the normal walk, only sampled as a mask.
  isMaskSource: boolean;

  // CSS `filter`: an ordered list of filter functions (blur/drop-shadow). When
  // set, the renderer composites this node's subtree to an offscreen and blits
  // it back through ctx.filter (see runtime/loop renderFilter). Null = no filter.
  filter: FilterOp[] | null;

  // CSS `box-shadow`: a list of drop-shadow FilterOps (each may carry spread /
  // inset). Rendered in the shared walk (renderBoxShadows) — outer, no-spread
  // shadows ride the same CSS-filter drop-shadow path as `filter`; spread and
  // inset draw geometric shadow shapes. Null = no box-shadow.
  boxShadow: FilterOp[] | null;

  // CSS Motion Path. offsetPath is the (static) motion path with a cached
  // arc-length table, in the node's local space; offsetDistance is the animated
  // position along it (0..1); offsetRotate controls tangent-following rotation.
  // Folded into computeLocalMatrix, so render and hit-test share it.
  offsetPath: MotionPath | null;
  offsetDistance: number;
  offsetRotate: OffsetRotate;

  // Per-subtree time scoping (static). During the per-frame walk this node's
  // inherited timeline time t is transformed to a local time
  // (t - timeOffset) * timeScale, applied to this node AND its descendants.
  // Defaults (0, 1) are the identity, so untouched nodes are unaffected.
  // timeOffset is in milliseconds; timeScale must be > 0.
  timeOffset: number;
  timeScale: number;

  // Per-subtree time remap (static): a monotonic keyframe curve mapping the
  // inherited timeline time (ms) to a local time (ms) for this node AND its
  // descendants. When present it REPLACES timeOffset/timeScale (a remap curve
  // already defines the full time mapping). Stops are sorted by input; outside
  // the domain the endpoints hold. Null = no remap.
  timeRemap: TimeRemapStop[] | null;

  // Sibling paint order (static). Siblings paint in ascending z-index (document
  // order breaks ties); the same order drives hit-testing. Default 0. Negative
  // values are valid and are the main use — painting a node behind its siblings.
  zIndex: number;

  // Visibility window in milliseconds, compared against the time this node
  // INHERITS (its containing/parent scope), before this node's own
  // time-offset/time-scale apply — visibility lives in the parent comp's
  // timeline. Outside [visibleFrom, visibleUntil) the node and its subtree are
  // skipped by both the render walk and hit-testing. Defaults (-Infinity,
  // +Infinity) => always visible. `hidden` is the per-frame evaluation, set
  // during the resolve walk.
  visibleFrom: number;
  visibleUntil: number;
  hidden: boolean;

  // Shape-specific data
  shapeData: ShapeData;

  // Animation state
  animations: AnimationInstance[];

  // Immutable authored snapshot. The value-resolution pipeline resets the live
  // fields to this every frame before layering bindings/animation/interaction.
  base: NodeBase;

  // Dynamic property bindings (variables, input() functions)
  bindings: PropertyBinding[];

  // Interaction state
  interactionState: InteractionState;
  hoverStyles: StateStyles | null;
  activeStyles: StateStyles | null;
  interactive: boolean; // Whether this node responds to mouse events
  // `cursor: pointer` — static, non-animatable. Also sets `interactive` so the
  // node is hit-tested; the component reads this on the hovered node to set the
  // canvas CSS cursor to `pointer`.
  cursorPointer: boolean;
  // Node-level CSS transitions (apply to interaction state changes, both enter
  // and exit). Empty = state overrides snap. Runtime tween state is held in the
  // InteractionManager, so the timeline stays a pure function of time.
  transitions: TransitionSpec[];
  // Direct children this node's &:state blocks target (`#p:hover > #c {…}`).
  // When this node's interaction state flips, each child's hover/activeStyles
  // apply/unapply too, anchored on THIS node's flip (see interaction.ts). The
  // children stay non-`interactive` — being targeted doesn't make them
  // independently hit-testable.
  stateChildren: SceneNode[];

  // Machine `:state()` conditional declaration sets targeting this node (its own
  // `&:state(...)` blocks plus any parent's `&:state(...) > #this`). Merged in
  // during the resolve walk when the owning machine is in the matching state.
  stateStyles: NodeStateStyle[];

  // `animation-timeline: var(--x) | input(path)` reference (a 0..1 value source).
  // When set, this node's own `animation:`s scrub to that progress via
  // sampleNodeAtProgress instead of playing on the clock. Null = clock-driven.
  animationTimeline: Value | null;

  // Scene-level interactive state machines. Populated on the ROOT node only
  // (empty elsewhere); consumed by the StateMachineRunner.
  machines: MachineRule[];
}

// Complete authored snapshot of a node's animatable render state.
export interface NodeBase {
  transform: Transform;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  trimStart: number;
  trimEnd: number;
  trimOffset: number;
  strokeDashOffset: number;
  offsetDistance: number;
  shapeData: ShapeData;
  // Gradient paints are animatable in @keyframes; the base holds a deep copy so
  // per-frame interpolation never mutates authored stops (see reset/snapshot).
  fillGradient: GradientData | null;
  strokeGradient: GradientData | null;
  // Clip region; animatable when authored as path() keyframes (Lottie animated
  // masks). Held as a copy so per-frame command morphs never mutate the authored
  // clip (same discipline as gradients above).
  clipPath: ClipPathData | null;
  // Filter list (blur/drop-shadow). Copied per frame so the registry's `filter`
  // handler can morph the blur radius on the live node without touching the base.
  filter: FilterOp[] | null;
  // box-shadow list, copied per frame like `filter` so an animated shadow writes
  // into the node copy, never the authored base.
  boxShadow: FilterOp[] | null;
}

export type ShapeData =
  | GroupData
  | RectData
  | CircleData
  | EllipseData
  | PathData
  | TextData
  | PolystarData
  | ImageData;

// Image node: draws `src` into the x/y/width/height box. width/height of 0 mean
// "use the loaded image's natural size" (resolved in the renderer once decoded).
export interface ImageData {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
}

// Star (alternating outer/inner radius over 2·sides vertices) or regular
// polygon (sides vertices at the outer radius). Synthesized into PathCommand[]
// at render/hit-test time (see scene/polystar.ts), so it reuses the whole path
// pipeline (trim, bounds, fill-rule, hit-test). Geometry matches lottie/AE.
export interface PolystarData {
  type: "star" | "polygon";
  sides: number; // vertex count (static)
  outerRadius: number;
  innerRadius: number; // star only
  rotation: number; // degrees; 0 points up (matches Lottie/AE)
  cx: number;
  cy: number;
  outerRoundness: number; // percent (Lottie os); 0 => straight edges
  innerRoundness: number; // percent (Lottie is); star only
}

export interface TextData {
  type: "text";
  x: number;
  y: number;
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string; // keyword ('bold') or numeric weight as a string ('700')
  anchor: TextAnchor;
  // Extra advance between glyphs, px (CSS letter-spacing). Default 0. Canvas2D
  // realizes it via ctx.letterSpacing, SVG via the letter-spacing attribute;
  // Skia leaves it a no-op (pinned divergence, like its text-measure).
  letterSpacing: number;
  // Line box height in px for multi-line content (`\n`-separated). 0 = auto,
  // resolved to ~1.2·fontSize at render/measure time.
  lineHeight: number;
}

export interface GroupData {
  type: "group";
}

export interface RectData {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
  // Per-corner radii (CSS `border-radius: tl tr br bl`). Set only when the four
  // corners differ; a uniform radius stays on rx/ry (native roundRect / rect
  // rx). When present it overrides rx/ry. Circular only — see roundedRectPath.
  cornerRadii?: CornerRadii;
}

export interface CircleData {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
  // Builder-internal scratch for `x`/`y` bounding-box sugar (left/top alias
  // input). Never read past buildNode — see resolveCircleEllipseBoxPosition.
  __boxX?: number;
  __boxY?: number;
  __cxSet?: boolean;
  __cySet?: boolean;
}

export interface EllipseData {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  __boxX?: number;
  __boxY?: number;
  __cxSet?: boolean;
  __cySet?: boolean;
}

export interface PathData {
  type: "path";
  commands: PathCommand[];
  d: string; // Original SVG path string
}

// Animation types
export interface AnimationInstance {
  name: string;
  duration: number; // ms
  timingFunction: TimingFunction;
  iterationCount: number; // Infinity for infinite
  direction: AnimationDirection;
  delay: number;
  fillMode: AnimationFillMode;
  // CSS animation-composition: how this animation's sampled value composites with
  // the value already written this frame (base + bindings + prior animations).
  // 'add'/'accumulate' add numeric channels; color/gradient/path fall back to
  // 'replace' (see interpolateKeyframes). Not part of the `animation` shorthand.
  composition: CompositeOperation;

  // Keyframe data
  keyframes: KeyframeData[];
}

export type CompositeOperation = "replace" | "add" | "accumulate";

export type AnimationDirection =
  | "normal"
  | "reverse"
  | "alternate"
  | "alternate-reverse";

export type AnimationFillMode = "none" | "forwards" | "backwards" | "both";

export type TimingFunction =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "step-start"
  | "step-end"
  | CubicBezier
  | StepsEasing
  | LinearEasing;

export interface CubicBezier {
  type: "cubic-bezier";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// CSS steps() easing (Easing Level 1). `count` is the number of intervals; the
// jump position controls whether the stair jumps at the start/end/both/neither
// of the [0,1] domain. `step-start`/`step-end` keywords are steps(1, jump-start)
// / steps(1, jump-end).
export type StepPosition =
  | "jump-start"
  | "jump-end"
  | "jump-none"
  | "jump-both";

export interface StepsEasing {
  type: "steps";
  count: number;
  position: StepPosition;
}

// CSS linear() easing (Easing Level 2): a piecewise-linear curve through
// control points. `input` positions are normalized to [0,1] and sorted
// ascending (with equal inputs allowed for flat/discontinuous segments) at
// build time; `output` values are unclamped so a linear() can overshoot 1 to
// approximate springs/bounces. The `linear` keyword (a string) stays distinct.
export interface LinearEasingPoint {
  input: number;
  output: number;
}

export interface LinearEasing {
  type: "linear";
  points: LinearEasingPoint[];
}

// One stop of a `time-remap` curve: at inherited time `input` (ms) the local
// timeline reads `output` (ms). `easing` (departing-keyframe convention, like
// KeyframeData.easing) shapes the segment from this stop to the next.
export interface TimeRemapStop {
  input: number;
  output: number;
  easing?: TimingFunction;
}

export interface KeyframeData {
  offset: number; // 0-1
  properties: Record<string, AnimatableValue>;
  easing?: TimingFunction; // Per-keyframe easing (controls transition FROM this keyframe to the next)
}

// A keyframe endpoint value. Beyond scalars/colors/transforms, gradients
// (fill/stroke) and path command lists (`d`, morphing) are animatable; the
// registry dispatches interpolation by value type.
export type AnimatableValue =
  | number
  | string
  | Transform
  | GradientData
  | PathCommand[]
  | FilterOp[];

// Default transform origin (0 0, matching CSS behavior)
export function createDefaultTransformOrigin(): TransformOrigin {
  return {
    x: { value: 0, unit: "px" },
    y: { value: 0, unit: "px" },
  };
}

// Helper to create default transform
export function createDefaultTransform(): Transform {
  return {
    translateX: 0,
    translateY: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    transformOrigin: createDefaultTransformOrigin(),
  };
}

// Helper to clone transform
export function cloneTransform(t: Transform): Transform {
  return {
    ...t,
    transformOrigin: {
      x: { ...t.transformOrigin.x },
      y: { ...t.transformOrigin.y },
    },
  };
}

// Copy a transform's fields into an existing target (no allocation).
export function copyTransform(src: Transform, dst: Transform): void {
  dst.translateX = src.translateX;
  dst.translateY = src.translateY;
  dst.rotate = src.rotate;
  dst.scaleX = src.scaleX;
  dst.scaleY = src.scaleY;
  dst.skewX = src.skewX;
  dst.skewY = src.skewY;
  dst.transformOrigin.x.value = src.transformOrigin.x.value;
  dst.transformOrigin.x.unit = src.transformOrigin.x.unit;
  dst.transformOrigin.y.value = src.transformOrigin.y.value;
  dst.transformOrigin.y.unit = src.transformOrigin.y.unit;
}

// Shallow clone of shape data (numeric geometry + type; path commands shared).
export function cloneShapeData(sd: ShapeData): ShapeData {
  return { ...sd };
}

// Clone a clip-path for the base snapshot. The `path` variant's command list is
// copied (the array reference is swapped, never mutated in place, by the
// registry's clip-path apply) so an animated clip can't corrupt the authored
// base; circle/inset carry only numbers.
export function cloneClipPath(clip: ClipPathData | null): ClipPathData | null {
  if (!clip) return null;
  if (clip.type === "path")
    return { type: "path", commands: clip.commands.slice() };
  return { ...clip };
}

// Deep-copy a filter list so the registry's per-frame blur-radius morph writes
// into a node-local copy, never the authored base (same discipline as gradients).
export function cloneFilter(filter: FilterOp[] | null): FilterOp[] | null {
  return filter ? filter.map((f) => ({ ...f })) : null;
}

// Capture the current authored render state of a node as its immutable base.
export function snapshotNode(node: SceneNode): NodeBase {
  return {
    transform: cloneTransform(node.transform),
    fill: node.fill,
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    opacity: node.opacity,
    trimStart: node.trimStart,
    trimEnd: node.trimEnd,
    trimOffset: node.trimOffset,
    strokeDashOffset: node.strokeDashOffset,
    offsetDistance: node.offsetDistance,
    shapeData: cloneShapeData(node.shapeData),
    fillGradient: cloneGradient(node.fillGradient),
    strokeGradient: cloneGradient(node.strokeGradient),
    clipPath: cloneClipPath(node.clipPath),
    filter: cloneFilter(node.filter),
    boxShadow: cloneFilter(node.boxShadow),
  };
}

// Reset a node's live render fields to its base, in place (per-frame, hot path).
export function resetNodeToBase(node: SceneNode): void {
  const b = node.base;
  copyTransform(b.transform, node.transform);
  node.fill = b.fill;
  node.stroke = b.stroke;
  node.strokeWidth = b.strokeWidth;
  node.opacity = b.opacity;
  node.trimStart = b.trimStart;
  node.trimEnd = b.trimEnd;
  node.trimOffset = b.trimOffset;
  node.strokeDashOffset = b.strokeDashOffset;
  node.offsetDistance = b.offsetDistance;
  Object.assign(node.shapeData, b.shapeData);
  // Deep-copy gradients so a per-frame gradient interpolation writing into
  // node.fillGradient can never corrupt the authored base stops.
  node.fillGradient = cloneGradient(b.fillGradient);
  node.strokeGradient = cloneGradient(b.strokeGradient);
  // Fresh clip copy each frame so an animated clip-path morph writes into a node
  // copy, never the authored base (mirrors the gradient reset above).
  node.clipPath = cloneClipPath(b.clipPath);
  // Fresh filter copy each frame so an animated blur radius writes into a node
  // copy, never the authored base.
  node.filter = cloneFilter(b.filter);
  node.boxShadow = cloneFilter(b.boxShadow);
}

// Helper to create a default scene node
export function createSceneNode(id: string, type: ShapeType): SceneNode {
  const transform = createDefaultTransform();
  return {
    id,
    type,
    parent: null,
    children: [],
    transform,
    fill: null,
    stroke: null,
    strokeWidth: 1,
    opacity: 1,
    trimStart: 0,
    trimEnd: 1,
    trimOffset: 0,
    strokeLineCap: "butt",
    strokeLineJoin: "miter",
    strokeMiterLimit: 4,
    strokeDashArray: [],
    strokeDashOffset: 0,
    fillRule: "nonzero",
    paintOrder: "normal",
    mixBlendMode: "normal",
    pointerEvents: "auto",
    cachedOutlineLength: null,
    outlineLengthDirty: true,
    cachedTextBounds: null,
    textBoundsDirty: true,
    cachedPolystarCommands: null,
    polystarDirty: true,
    fillGradient: null,
    strokeGradient: null,
    clipPath: null,
    mask: null,
    isMaskSource: false,
    filter: null,
    boxShadow: null,
    offsetPath: null,
    offsetDistance: 0,
    offsetRotate: { auto: true, angle: 0 },
    timeOffset: 0,
    timeScale: 1,
    timeRemap: null,
    zIndex: 0,
    visibleFrom: -Infinity,
    visibleUntil: Infinity,
    hidden: false,
    shapeData: { type: "group" },
    animations: [],
    base: {
      transform: cloneTransform(transform),
      fill: null,
      stroke: null,
      strokeWidth: 1,
      opacity: 1,
      trimStart: 0,
      trimEnd: 1,
      trimOffset: 0,
      strokeDashOffset: 0,
      offsetDistance: 0,
      shapeData: { type: "group" },
      fillGradient: null,
      strokeGradient: null,
      clipPath: null,
      filter: null,
      boxShadow: null,
    },
    bindings: [],
    interactionState: "normal",
    hoverStyles: null,
    activeStyles: null,
    interactive: false,
    cursorPointer: false,
    transitions: [],
    stateChildren: [],
    stateStyles: [],
    animationTimeline: null,
    machines: [],
  };
}

/**
 * Children in paint order: ascending z-index, document order breaking ties.
 * Both the render walk and hit-testing use this so painted stacking and hit
 * priority always agree. Returns the original array untouched (no allocation)
 * in the common case where every child sits at the default z-index 0.
 */
export function childrenInPaintOrder(node: SceneNode): SceneNode[] {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    if (children[i].zIndex !== 0) {
      // Array.prototype.sort is stable, so equal z-indexes keep document order.
      return [...children].sort((a, b) => a.zIndex - b.zIndex);
    }
  }
  return children;
}
