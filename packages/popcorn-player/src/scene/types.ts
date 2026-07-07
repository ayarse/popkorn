import type { PathCommand, GradientData } from '../renderer/types';
import { cloneGradient } from '../renderer/types';
import type { MotionPath } from './path-parser';
import type { Value } from '@popcorn/parser';

// CSS Motion Path offset-rotate: `auto` follows the path tangent; `angle` adds a
// fixed offset (auto + angle) or a fixed orientation (angle only, auto = false).
export interface OffsetRotate {
  auto: boolean;
  angle: number; // degrees
}

// Authored clip-path. Insets are stored relative to the node's bounding box and
// resolved to concrete geometry at render/hit-test time (see scene/clip.ts).
export type ClipPathData =
  | { type: 'circle'; r: number; x: number; y: number }
  | { type: 'inset'; top: number; right: number; bottom: number; left: number }
  | { type: 'path'; commands: PathCommand[] };

// Scene node types
export type ShapeType = 'group' | 'rect' | 'circle' | 'ellipse' | 'path' | 'text' | 'star' | 'polygon' | 'image';

// Track-matte modes (Lottie tt): the matte source's alpha or luminance drives
// the masked node's visibility; the *-invert variants flip it.
export type MatteMode = 'alpha' | 'alpha-invert' | 'luma' | 'luma-invert';

// Fill winding rule; maps straight to CanvasFillRule / isPointInPath's ruleset.
export type FillRule = 'nonzero' | 'evenodd';

// Text alignment; maps to CanvasRenderingContext2D.textAlign (left/center/right).
export type TextAnchor = 'start' | 'middle' | 'end';

// Stroke line cap, maps straight to CanvasRenderingContext2D.lineCap.
export type StrokeLineCap = 'butt' | 'round' | 'square';

// Stroke line join, maps straight to CanvasRenderingContext2D.lineJoin.
export type StrokeLineJoin = 'miter' | 'round' | 'bevel';

// Paint order for a shape's own fill/stroke. 'normal' paints fill then stroke
// (stroke on top); 'stroke' paints stroke then fill (stroke behind the fill),
// matching SVG `paint-order: stroke`. Used when a Lottie group stroke sits below
// the fills it covers, so only the exposed edge (a seam) shows.
export type PaintOrder = 'normal' | 'stroke';

// Interaction state types
export type InteractionState = 'normal' | 'hover' | 'active';

// State-specific styles for interactive elements
export interface StateStyles {
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  opacity?: number;
  transform?: Partial<Transform>;
}

// Transform origin types
export type TransformOriginUnit = 'px' | '%';

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
  property: string;  // e.g., 'cx', 'cy', 'r', 'opacity'
  value: Value;      // The variable reference or input() function
}

export interface Transform {
  translateX: number;
  translateY: number;
  rotate: number;       // degrees
  scaleX: number;
  scaleY: number;
  transformOrigin: TransformOrigin;  // CSS transform-origin
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

  // Track matte: this node is composited against `source`'s alpha/luminance.
  // `source` is resolved by id at build time (any node in the scene). When set,
  // the renderer composites the two subtrees offscreen (see runtime/loop).
  matte: { source: SceneNode; mode: MatteMode } | null;
  // True when this node is referenced as some node's matte source: it is not
  // painted in the normal walk, only sampled as a matte.
  isMatteSource: boolean;

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

  // Visibility window in scene-local milliseconds (compared against the same
  // scoped time the scheduler samples this node at). Outside [visibleFrom,
  // visibleUntil) the node and its subtree are skipped by both the render walk
  // and hit-testing. Defaults (-Infinity, +Infinity) => always visible. `hidden`
  // is the per-frame evaluation, set during the resolve walk.
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
  interactive: boolean;  // Whether this node responds to mouse events
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
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
}

// Star (alternating outer/inner radius over 2·points vertices) or regular
// polygon (points vertices at the outer radius). Synthesized into PathCommand[]
// at render/hit-test time (see scene/polystar.ts), so it reuses the whole path
// pipeline (trim, bounds, fill-rule, hit-test). Geometry matches lottie/AE.
export interface PolystarData {
  type: 'star' | 'polygon';
  points: number;         // vertex count (static)
  outerRadius: number;
  innerRadius: number;    // star only
  rotation: number;       // degrees; 0 points up (matches Lottie/AE)
  cx: number;
  cy: number;
  outerRoundness: number; // percent (Lottie os); 0 => straight edges
  innerRoundness: number; // percent (Lottie is); star only
}

export interface TextData {
  type: 'text';
  x: number;
  y: number;
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;   // keyword ('bold') or numeric weight as a string ('700')
  anchor: TextAnchor;
}

export interface GroupData {
  type: 'group';
}

export interface RectData {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
}

export interface CircleData {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface EllipseData {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface PathData {
  type: 'path';
  commands: PathCommand[];
  d: string;  // Original SVG path string
}

// Animation types
export interface AnimationInstance {
  name: string;
  duration: number;         // ms
  timingFunction: TimingFunction;
  iterationCount: number;   // Infinity for infinite
  direction: AnimationDirection;
  delay: number;
  fillMode: AnimationFillMode;

  // Keyframe data
  keyframes: KeyframeData[];
}

export type AnimationDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';

export type AnimationFillMode = 'none' | 'forwards' | 'backwards' | 'both';

export type TimingFunction =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'step-end'
  | CubicBezier;

export interface CubicBezier {
  type: 'cubic-bezier';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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
  offset: number;  // 0-1
  properties: Record<string, AnimatableValue>;
  easing?: TimingFunction;  // Per-keyframe easing (controls transition FROM this keyframe to the next)
}

// A keyframe endpoint value. Beyond scalars/colors/transforms, gradients
// (fill/stroke) and path command lists (`d`, morphing) are animatable; the
// registry dispatches interpolation by value type.
export type AnimatableValue = number | string | Transform | GradientData | PathCommand[];

// Default transform origin (0 0, matching CSS behavior)
export function createDefaultTransformOrigin(): TransformOrigin {
  return {
    x: { value: 0, unit: 'px' },
    y: { value: 0, unit: 'px' },
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
  if (clip.type === 'path') return { type: 'path', commands: clip.commands.slice() };
  return { ...clip };
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
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
    strokeMiterLimit: 4,
    strokeDashArray: [],
    strokeDashOffset: 0,
    fillRule: 'nonzero',
    paintOrder: 'normal',
    cachedOutlineLength: null,
    outlineLengthDirty: true,
    cachedTextBounds: null,
    textBoundsDirty: true,
    cachedPolystarCommands: null,
    polystarDirty: true,
    fillGradient: null,
    strokeGradient: null,
    clipPath: null,
    matte: null,
    isMatteSource: false,
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
    shapeData: { type: 'group' },
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
      shapeData: { type: 'group' },
      fillGradient: null,
      strokeGradient: null,
      clipPath: null,
    },
    bindings: [],
    interactionState: 'normal',
    hoverStyles: null,
    activeStyles: null,
    interactive: false,
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
