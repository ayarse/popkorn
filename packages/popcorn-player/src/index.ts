// Re-export parser
export { parse } from '@popcorn/parser';
export type { StyleSheet, Rule, Declaration, Value, KeyframeRule, CanvasConfig, VariableDefinition, PseudoState, StateRule } from '@popcorn/parser';

// Web Component (main export)
export { PopcornPlayer, registerPopcornPlayer } from './component';

// Renderer
export { Canvas2DRenderer } from './renderer/canvas2d';
export type { Renderer } from './renderer/interface';
export type {
  Color,
  RGBAColor,
  PathCommand,
  Matrix3x3,
  GradientData,
  LinearGradientData,
  RadialGradientData,
  ResolvedClip,
  TrimDescriptor,
} from './renderer/types';
export {
  colorToCSS,
  parseColor,
  multiplyMatrices,
  translationMatrix,
  rotationMatrix,
  scaleMatrix,
  IDENTITY_MATRIX
} from './renderer/types';

// Scene
export type {
  SceneNode,
  ShapeType,
  Transform,
  ShapeData,
  GroupData,
  RectData,
  CircleData,
  EllipseData,
  PathData,
  AnimationInstance,
  KeyframeData,
  TimingFunction,
  AnimationDirection,
  AnimationFillMode,
  CubicBezier,
  AnimatableValue,
  PropertyBinding,
  NodeBase,
  InteractionState,
  StateStyles,
} from './scene/types';
export {
  createSceneNode,
  createDefaultTransform,
  cloneTransform,
  snapshotNode,
  resetNodeToBase,
} from './scene/types';
export type {
  StrokeLineCap,
  StrokeLineJoin,
  TextAnchor,
  FillRule,
  MaskMode,
  PaintOrder,
} from './scene/types';
export { SceneBuilder, buildSceneGraph } from './scene/builder';
export { parsePath, applyCommandsToPath, computePathBounds } from './scene/path-parser';
export type { PathSink } from './scene/path-parser';
export {
  computeLocalMatrix,
  computeWorldMatrix,
  computeAllWorldTransforms,
  lerp,
} from './scene/transform';

// Animation
export { applyEasing } from './animation/easing';
export { interpolateKeyframes } from './animation/keyframes';
export {
  AnimationScheduler,
  computeSceneDuration,
} from './animation/scheduler';

// Runtime
export { RenderLoop, wrapTime } from './runtime/loop';
export { computeViewport, viewportMatrix, deviceToScene, IDENTITY_VIEWPORT } from './runtime/viewport';
export type { Viewport, FitMode } from './runtime/viewport';
export { InputTracker, createInputTracker } from './runtime/inputs';
export type { InputState } from './runtime/inputs';
export { VariableResolver, createVariableResolver } from './runtime/variables';
export { InteractionManager, createInteractionManager } from './runtime/interaction';
export { hitTest } from './runtime/hit-test';
export type { Point, HitTestResult } from './runtime/hit-test';
