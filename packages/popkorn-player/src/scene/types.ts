import type { MachineRule, Value } from "@popkorn/parser";
import type { PropValue } from "../animation/registry.js";
import type {
  CornerRadii,
  GradientData,
  PathCommand,
} from "../renderer/types.js";
import type { MotionPath } from "./path-parser.js";

// `auto` follows the tangent; `angle` is an offset (auto) or fixed orientation.
export interface OffsetRotate {
  auto: boolean;
  angle: number; // degrees
}

// Insets resolve against the node's bounding box at render/hit-test (clip.ts).
export type ClipPathData =
  | { type: "circle"; r: number; x: number; y: number }
  | { type: "inset"; top: number; right: number; bottom: number; left: number }
  | { type: "path"; commands: PathCommand[] };

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

// Track-mask modes (Lottie tt); *-invert flips the source's alpha/luminance.
export const MASK_MODES = [
  "alpha",
  "alpha-invert",
  "luminance",
  "luminance-invert",
] as const;
export type MaskMode = (typeof MASK_MODES)[number];

// Lengths are local and scale with the node's world scale (CSS); color-adjust
// `amount` is a fraction (1 = 100%) except hue-rotate's, which is degrees.
export type FilterOp =
  | { type: "blur"; radius: number }
  | {
      type: "drop-shadow";
      dx: number;
      dy: number;
      blur: number;
      color: string;
      // box-shadow extras, realized in the shared walk (renderBoxShadows).
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
export const FILL_RULES = ["nonzero", "evenodd"] as const;
export type FillRule = (typeof FILL_RULES)[number];

// CSS mix-blend-mode; every keyword maps to all three backends.
// NOTE: per shape against the backdrop; no group isolation.
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

// Maps to CanvasRenderingContext2D.textAlign.
export const TEXT_ANCHORS = ["start", "middle", "end"] as const;
export type TextAnchor = (typeof TEXT_ANCHORS)[number];

export const STROKE_LINE_CAPS = ["butt", "round", "square"] as const;
export type StrokeLineCap = (typeof STROKE_LINE_CAPS)[number];

export const STROKE_LINE_JOINS = ["miter", "round", "bevel"] as const;
export type StrokeLineJoin = (typeof STROKE_LINE_JOINS)[number];

// 'stroke' paints stroke behind the fill (SVG `paint-order: stroke`).
export type PaintOrder = "normal" | "stroke";

// `none` excludes the whole subtree from hit-testing; `auto` can't re-enable it.
type PointerEvents = "auto" | "none";

export type InteractionState = "normal" | "hover" | "active";

// `property` is `all` or a transitionable group name; times in ms.
export interface TransitionSpec {
  property: string;
  duration: number; // ms
  easing: TimingFunction;
  delay: number; // ms
}

// Applies while its machine is in `name`; `machine: null` matches any machine.
export interface NodeStateStyle {
  machine: string | null;
  name: string;
  styles: StateStyles;
  animations: AnimationInstance[];
}

// Solid and gradient paint are exclusive per channel; `undefined` = not declared.
export interface StateStyles {
  fill?: string | null;
  stroke?: string | null;
  fillGradient?: GradientData | null;
  strokeGradient?: GradientData | null;
  strokeWidth?: number;
  opacity?: number;
  transform?: Partial<Transform>;
  // Registry-animatable overrides keyed by property name, snapped in applyStateStyles.
  overrides?: Record<string, PropValue>;
  // Discrete string overrides (content, font-family, …); base-reset reverts them.
  discrete?: ((node: SceneNode) => void)[];
  // Override node-level transitions when entering this state.
  transitions?: TransitionSpec[];
}

type TransformOriginUnit = "px" | "%";

export interface TransformOriginValue {
  value: number;
  unit: TransformOriginUnit;
}

export interface TransformOrigin {
  x: TransformOriginValue;
  y: TransformOriginValue;
}

export interface PropertyBinding {
  property: string; // e.g., 'cx', 'cy', 'r', 'opacity'
  value: Value; // The variable reference or input() function
  // String props: re-applies the resolved value via the builder's declaration switch.
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

  parent: SceneNode | null;
  children: SceneNode[];

  // Local, relative to parent
  transform: Transform;

  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;

  // Trim paths: stroke-only fractions (0..1) of the outline length; offset rotates.
  trimStart: number;
  trimEnd: number;
  trimOffset: number;
  strokeLineCap: StrokeLineCap;
  strokeLineJoin: StrokeLineJoin;
  // Canvas defaults to 10; SVG/Lottie use 4, so sharp corners bevel sooner.
  strokeMiterLimit: number;

  // Static dash pattern + animatable offset; trim wins over dashing when both set.
  strokeDashArray: number[];
  strokeDashOffset: number;

  // Applies to path/star/polygon fill, hit-test and clip.
  fillRule: FillRule;

  paintOrder: PaintOrder;

  // Shared walk brackets the shape draw with setBlendMode.
  mixBlendMode: BlendMode;

  pointerEvents: PointerEvents;

  // Lazy caches; the registry's geometry handlers set the dirty flags.
  cachedOutlineLength: number | null;
  outlineLengthDirty: boolean;

  cachedTextBounds: { width: number; height: number } | null;
  textBoundsDirty: boolean;

  cachedPolystarCommands: PathCommand[] | null;
  polystarDirty: boolean;

  // Wins over the solid color when set.
  fillGradient: GradientData | null;
  strokeGradient: GradientData | null;

  // Clips this node and its descendants.
  clipPath: ClipPathData | null;

  // Composited against `source`'s alpha/luminance (resolved by id at build).
  mask: { source: SceneNode; mode: MaskMode } | null;
  // Referenced as a mask source: only sampled, never painted in the walk.
  isMaskSource: boolean;

  // Composites the subtree offscreen through ctx.filter (loop renderFilter).
  filter: FilterOp[] | null;

  // Drop-shadow ops; spread/inset draw geometric shadows (renderBoxShadows).
  boxShadow: FilterOp[] | null;

  // Motion path (local space, arc-length cached); folded into computeLocalMatrix.
  offsetPath: MotionPath | null;
  offsetDistance: number;
  offsetRotate: OffsetRotate;

  // Subtree local time = (t - timeOffset) * timeScale; ms, scale > 0.
  timeOffset: number;
  timeScale: number;

  // Monotonic curve mapping inherited → local time (ms); replaces offset/scale.
  timeRemap: TimeRemapStop[] | null;

  // Pins subtree time to a fixed instant (ms); derived after the :state() merge.
  timeRemapValue: number | null;

  // Ascending z-index, document order breaks ties; drives paint and hit-test order.
  zIndex: number;

  // Per-frame sort cached by the resolve walk; see childrenInPaintOrder.
  sortedChildren: SceneNode[] | null;

  // Removes the subtree from render + hit-test; bindable (0 => none).
  displayNone: boolean;

  // Visibility window (ms) against the INHERITED time, before own time scoping;
  // `hidden` is its per-frame result.
  visibleFrom: number;
  visibleUntil: number;
  hidden: boolean;

  shapeData: ShapeData;

  animations: AnimationInstance[];

  // Immutable authored snapshot; live fields reset to it every frame.
  base: NodeBase;

  bindings: PropertyBinding[];

  interactionState: InteractionState;
  hoverStyles: StateStyles | null;
  activeStyles: StateStyles | null;
  interactive: boolean;
  // `cursor: pointer`: the component sets the canvas cursor on hover.
  cursorPointer: boolean;
  // Empty = state overrides snap; tween state lives in the InteractionManager.
  transitions: TransitionSpec[];
  // Children targeted by `&:hover > #c`; driven by this node's flip (interaction.ts).
  stateChildren: SceneNode[];

  // Own `&:state()` blocks plus a parent's `&:state() > #this`, merged in the walk.
  stateStyles: NodeStateStyle[];

  // 0..1 progress source (var()/input()) scrubbing this node's animations.
  animationTimeline: Value | null;

  // Root only; consumed by the StateMachineRunner.
  machines: MachineRule[];
}

// Complete authored snapshot of a node's animatable render state.
export interface NodeBase {
  transform: Transform;
  zIndex: number;
  displayNone: boolean;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  trimStart: number;
  trimEnd: number;
  trimOffset: number;
  strokeDashOffset: number;
  offsetDistance: number;
  timeRemapValue: number | null;
  shapeData: ShapeData;
  // Deep copies, so per-frame morphs never mutate the authored values.
  fillGradient: GradientData | null;
  strokeGradient: GradientData | null;
  clipPath: ClipPathData | null;
  filter: FilterOp[] | null;
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

// Source-bitmap sub-rect in image pixels (object-view-box `xywh()`).
export interface ImageViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// width/height 0 = natural size (or the viewBox crop's own size).
export interface ImageData {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  viewBox: ImageViewBox | null;
}

// Star or regular polygon, synthesized into a path (scene/polystar.ts); matches AE.
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
  // px; Skia leaves it a no-op (pinned divergence).
  letterSpacing: number;
  // Multi-line (`\n`) line box in px; 0 = auto (~1.2·fontSize).
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
  // Set only when corners differ; overrides rx/ry. Circular only (roundedRectPath).
  cornerRadii?: CornerRadii;
}

export interface CircleData {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
  // Builder-only scratch for `x`/`y` box sugar (resolveCircleEllipseBoxPosition).
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
}

export interface AnimationInstance {
  name: string;
  duration: number; // ms
  timingFunction: TimingFunction;
  iterationCount: number; // Infinity for infinite
  direction: AnimationDirection;
  delay: number;
  fillMode: AnimationFillMode;
  // Non-numeric channels fall back to 'replace'; not in the `animation` shorthand.
  composition: CompositeOperation;

  tracks: KeyframeTrack[];
}

export const COMPOSITE_OPERATIONS = ["replace", "add", "accumulate"] as const;
export type CompositeOperation = (typeof COMPOSITE_OPERATIONS)[number];

export const ANIMATION_DIRECTIONS = [
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
] as const;
export type AnimationDirection = (typeof ANIMATION_DIRECTIONS)[number];

export const ANIMATION_FILL_MODES = [
  "none",
  "forwards",
  "backwards",
  "both",
] as const;
export type AnimationFillMode = (typeof ANIMATION_FILL_MODES)[number];

export const EASING_KEYWORDS = [
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
] as const;

export type TimingFunction =
  | (typeof EASING_KEYWORDS)[number]
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

// `count` intervals; `step-start`/`step-end` are steps(1, jump-start/jump-end).
export const STEP_POSITIONS = [
  "jump-start",
  "jump-end",
  "jump-none",
  "jump-both",
] as const;
export type StepPosition = (typeof STEP_POSITIONS)[number];

export interface StepsEasing {
  type: "steps";
  count: number;
  position: StepPosition;
}

// linear() points: inputs sorted into [0,1] at build; outputs unclamped (overshoot).
export interface LinearEasingPoint {
  input: number;
  output: number;
}

export interface LinearEasing {
  type: "linear";
  points: LinearEasingPoint[];
}

// `easing` shapes the segment to the next stop (departing convention).
export interface TimeRemapStop {
  input: number;
  output: number;
  easing?: TimingFunction;
}

// One authored `@keyframes` block; regrouped into tracks by buildKeyframeTracks.
export interface KeyframeData {
  offset: number; // 0-1
  properties: Record<string, AnimatableValue>;
  easing?: TimingFunction; // Per-keyframe easing (controls transition FROM this keyframe to the next)
}

// `easing` shapes the segment to the next stop of the SAME track.
export interface KeyframeStop {
  offset: number; // 0-1
  value: AnimatableValue;
  easing?: TimingFunction;
}

// A property's own keyframes, so omitting it mid-way interpolates across (CSS/WAAPI).
export interface KeyframeTrack {
  property: string;
  stops: KeyframeStop[]; // at least one, ascending by offset
}

export type AnimatableValue =
  | number
  | string
  | Transform
  | GradientData
  | PathCommand[]
  | FilterOp[]
  | ImageViewBox;
