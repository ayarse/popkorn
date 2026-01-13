// Re-export parser
export { parse, initParser } from '@popcorn/parser';
export type { StyleSheet, Rule, Declaration, Value, KeyframeRule, CanvasConfig, VariableDefinition } from '@popcorn/parser';

// Web Component (main export)
export { PopcornPlayer, registerPopcornPlayer } from './component';

// Renderer
export { Canvas2DRenderer } from './renderer/canvas2d';
export type { Renderer } from './renderer/interface';
export type { Color, RGBAColor, PathCommand, Matrix3x3 } from './renderer/types';
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
  CubicBezier,
  AnimatableValue,
  PropertyBinding,
} from './scene/types';
export {
  createSceneNode,
  createDefaultTransform,
  cloneTransform,
} from './scene/types';
export { SceneBuilder, buildSceneGraph } from './scene/builder';
export { parsePath } from './scene/path-parser';
export {
  computeLocalMatrix,
  computeWorldMatrix,
  computeAllWorldTransforms,
  interpolateTransform,
  lerp,
  lerpAngle,
} from './scene/transform';

// Animation
export { applyEasing, EasingFunctions } from './animation/easing';
export { interpolateKeyframes } from './animation/keyframes';
export {
  AnimationScheduler,
  getAnimationScheduler,
  createAnimationScheduler,
} from './animation/scheduler';

// Runtime
export { RenderLoop, createRenderLoop } from './runtime/loop';
export { InputTracker, getInputTracker, createInputTracker } from './runtime/inputs';
export type { InputState } from './runtime/inputs';
export { VariableResolver, getVariableResolver, createVariableResolver } from './runtime/variables';
