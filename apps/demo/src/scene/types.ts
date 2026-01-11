import type { PathCommand } from '../renderer/types';
import type { Value } from '@popcorn/parser';

// Scene node types
export type ShapeType = 'group' | 'rect' | 'circle' | 'ellipse' | 'path';

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
  anchorX: number;      // pivot point
  anchorY: number;
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

  // Base values (for animation reset)
  baseTransform: Transform;
  baseFill: string | null;
  baseOpacity: number;

  // Dynamic property bindings (variables, input() functions)
  bindings: PropertyBinding[];
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

  // Runtime state
  startTime: number;
  currentTime: number;
  isRunning: boolean;

  // Keyframe data
  keyframes: KeyframeData[];
}

export type AnimationDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';

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
}

export type AnimatableValue = number | string | Transform;

// Helper to create default transform
export function createDefaultTransform(): Transform {
  return {
    translateX: 0,
    translateY: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    anchorX: 0,
    anchorY: 0,
  };
}

// Helper to clone transform
export function cloneTransform(t: Transform): Transform {
  return { ...t };
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
    baseTransform: cloneTransform(transform),
    baseFill: null,
    baseOpacity: 1,
    bindings: [],
  };
}
