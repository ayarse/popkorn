import type { PathCommand } from '../renderer/types';
import type { Value } from '@popcorn/parser';

// Scene node types
export type ShapeType = 'group' | 'rect' | 'circle' | 'ellipse' | 'path';

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
  shapeData: ShapeData;
}

export type ShapeData =
  | GroupData
  | RectData
  | CircleData
  | EllipseData
  | PathData;

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
  | CubicBezier;

export interface CubicBezier {
  type: 'cubic-bezier';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface KeyframeData {
  offset: number;  // 0-1
  properties: Record<string, AnimatableValue>;
  easing?: TimingFunction;  // Per-keyframe easing (controls transition FROM this keyframe to the next)
}

export type AnimatableValue = number | string | Transform;

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

// Capture the current authored render state of a node as its immutable base.
export function snapshotNode(node: SceneNode): NodeBase {
  return {
    transform: cloneTransform(node.transform),
    fill: node.fill,
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    opacity: node.opacity,
    shapeData: cloneShapeData(node.shapeData),
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
  Object.assign(node.shapeData, b.shapeData);
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
    shapeData: { type: 'group' },
    animations: [],
    base: {
      transform: cloneTransform(transform),
      fill: null,
      stroke: null,
      strokeWidth: 1,
      opacity: 1,
      shapeData: { type: 'group' },
    },
    bindings: [],
    interactionState: 'normal',
    hoverStyles: null,
    activeStyles: null,
    interactive: false,
  };
}
