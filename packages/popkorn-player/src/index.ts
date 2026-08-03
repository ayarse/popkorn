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
} from "@popkorn/parser";
export { parse } from "@popkorn/parser";
// Animation
export { applyEasing } from "./animation/easing.js";
export {
  buildKeyframeTracks,
  interpolateKeyframes,
} from "./animation/keyframes.js";
export {
  AnimationScheduler,
  computeSceneDuration,
} from "./animation/scheduler.js";
// Web Component (main export)
export type {
  TimelineAnimation,
  TimelineAnimationProperty,
  TimelineTrack,
} from "./component.js";
export { PopkornPlayer, registerPopkornPlayer } from "./component.js";
// Renderer
export { Canvas2DRenderer } from "./renderer/canvas2d.js";
export type {
  ClipObs,
  ConformanceHarness,
  ConformanceTrace,
  MaskObs,
  NormGradient,
  PaintObs,
} from "./renderer/conformance.js";
// Cross-backend renderer conformance suite (shared spec-table; each backend's
// test package builds a harness and calls registerConformance).
export {
  CONFORMANCE_CASES,
  MASK_MODES,
  registerConformance,
} from "./renderer/conformance.js";
export type {
  PaintBox,
  ResolvedGradient,
  ResolvedLinearGradient,
  ResolvedRadialGradient,
} from "./renderer/gradient-geometry.js";
export { resolveGradient } from "./renderer/gradient-geometry.js";
export type { Renderer } from "./renderer/interface.js";
// Shared renderer paint semantics (consumed by every backend, incl. @popkorn/react-native).
export { PaintStateRenderer } from "./renderer/paint-state.js";
export type { StrokeDashDecision } from "./renderer/stroke.js";
export { paintOrderSequence, resolveStrokeDash } from "./renderer/stroke.js";
export type {
  Color,
  CornerRadii,
  GradientData,
  LinearGradientData,
  Matrix3x3,
  PathCommand,
  RadialGradientData,
  ResolvedClip,
  RGBAColor,
  TrimDescriptor,
} from "./renderer/types.js";
export {
  colorToCSS,
  IDENTITY_MATRIX,
  invertMatrix,
  LUMA_COEFFICIENTS,
  multiplyMatrices,
  parseColor,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix,
} from "./renderer/types.js";
export type { HitTestResult, Point } from "./runtime/hit-test.js";
export { hitTest } from "./runtime/hit-test.js";
export type { InputState } from "./runtime/inputs.js";
export { createInputTracker, InputTracker } from "./runtime/inputs.js";
export {
  createInteractionManager,
  InteractionManager,
} from "./runtime/interaction.js";
// Runtime
export { RenderLoop, wrapTime } from "./runtime/loop.js";
export {
  createVariableResolver,
  VariableResolver,
} from "./runtime/variables.js";
export type { FitMode, Viewport } from "./runtime/viewport.js";
export {
  computeViewport,
  deviceToScene,
  IDENTITY_VIEWPORT,
  viewportMatrix,
} from "./runtime/viewport.js";
export { buildSceneGraph, SceneBuilder } from "./scene/builder.js";
export type { PathSink } from "./scene/path-parser.js";
export {
  applyCommandsToPath,
  computePathBounds,
  computePathLength,
  parsePath,
  roundedRectPath,
} from "./scene/path-parser.js";
export { polystarToCommands } from "./scene/polystar.js";
export type { TextMeasurer } from "./scene/transform.js";
export {
  computeLocalMatrix,
  computeWorldMatrix,
  lerp,
  setTextMeasurer,
} from "./scene/transform.js";
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
  KeyframeStop,
  KeyframeTrack,
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
} from "./scene/types.js";
export {
  cloneTransform,
  createDefaultTransform,
  createSceneNode,
  resetNodeToBase,
  snapshotNode,
} from "./scene/types.js";
