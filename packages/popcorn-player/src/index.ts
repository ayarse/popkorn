// Re-export parser

export type {
  CanvasConfig,
  Declaration,
  KeyframeRule,
  PseudoState,
  Rule,
  StateRule,
  StyleSheet,
  Value,
  VariableDefinition,
} from "@popcorn/parser";
export { parse } from "@popcorn/parser";
// Animation
export { applyEasing } from "./animation/easing";
export { interpolateKeyframes } from "./animation/keyframes";
export {
  AnimationScheduler,
  computeSceneDuration,
} from "./animation/scheduler";
// Web Component (main export)
export { PopcornPlayer, registerPopcornPlayer } from "./component";
// Renderer
export { Canvas2DRenderer } from "./renderer/canvas2d";
export type {
  ConformanceHarness,
  ConformanceTrace,
  MaskObs,
  NormGradient,
  PaintObs,
} from "./renderer/conformance";
// Cross-backend renderer conformance suite (shared spec-table; each backend's
// test package builds a harness and calls registerConformance).
export {
  CONFORMANCE_CASES,
  MASK_MODES,
  registerConformance,
} from "./renderer/conformance";
export type {
  PaintBox,
  ResolvedGradient,
  ResolvedLinearGradient,
  ResolvedRadialGradient,
} from "./renderer/gradient-geometry";
export { resolveGradient } from "./renderer/gradient-geometry";
export type { Renderer } from "./renderer/interface";
// Shared renderer paint semantics (consumed by every backend, incl. @popcorn/skia).
export { PaintStateRenderer } from "./renderer/paint-state";
export type { StrokeDashDecision } from "./renderer/stroke";
export { paintOrderSequence, resolveStrokeDash } from "./renderer/stroke";
export type {
  Color,
  GradientData,
  LinearGradientData,
  Matrix3x3,
  PathCommand,
  RadialGradientData,
  ResolvedClip,
  RGBAColor,
  TrimDescriptor,
} from "./renderer/types";
export {
  colorToCSS,
  IDENTITY_MATRIX,
  invertMatrix,
  LUMA_COEFFICIENTS,
  multiplyMatrices,
  parseColor,
  rotationMatrix,
  scaleMatrix,
  translationMatrix,
} from "./renderer/types";
export type { HitTestResult, Point } from "./runtime/hit-test";
export { hitTest } from "./runtime/hit-test";
export type { InputState } from "./runtime/inputs";
export { createInputTracker, InputTracker } from "./runtime/inputs";
export {
  createInteractionManager,
  InteractionManager,
} from "./runtime/interaction";
// Runtime
export { RenderLoop, wrapTime } from "./runtime/loop";
export { createVariableResolver, VariableResolver } from "./runtime/variables";
export type { FitMode, Viewport } from "./runtime/viewport";
export {
  computeViewport,
  deviceToScene,
  IDENTITY_VIEWPORT,
  viewportMatrix,
} from "./runtime/viewport";
export { buildSceneGraph, SceneBuilder } from "./scene/builder";
export type { PathSink } from "./scene/path-parser";
export {
  applyCommandsToPath,
  computePathBounds,
  parsePath,
} from "./scene/path-parser";
export {
  computeAllWorldTransforms,
  computeLocalMatrix,
  computeWorldMatrix,
  lerp,
} from "./scene/transform";
// Scene
export type {
  AnimatableValue,
  AnimationDirection,
  AnimationFillMode,
  AnimationInstance,
  CircleData,
  CubicBezier,
  EllipseData,
  FillRule,
  GroupData,
  InteractionState,
  KeyframeData,
  MaskMode,
  NodeBase,
  PaintOrder,
  PathData,
  PropertyBinding,
  RectData,
  SceneNode,
  ShapeData,
  ShapeType,
  StateStyles,
  StrokeLineCap,
  StrokeLineJoin,
  TextAnchor,
  TimingFunction,
  Transform,
} from "./scene/types";
export {
  cloneTransform,
  createDefaultTransform,
  createSceneNode,
  resetNodeToBase,
  snapshotNode,
} from "./scene/types";
