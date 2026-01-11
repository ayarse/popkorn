// Main entry point for motion-scene-graph-poc

// React component
export { MotionCanvas, useMotionScene } from './components';
export type { MotionCanvasProps } from './components';

// Parser
export { parse, initParser, isParserReady } from '@popcorn/parser';
export type {
  StyleSheet,
  Rule,
  Declaration,
  Value,
  KeyframeRule,
  KeyframeBlock,
  CanvasConfig,
} from '@popcorn/parser';

// Scene Graph
export { buildSceneGraph, SceneBuilder } from './scene';
export type {
  SceneNode,
  ShapeType,
  Transform,
  AnimationInstance,
  KeyframeData,
  TimingFunction,
} from './scene';

// Renderer
export { Canvas2DRenderer } from './renderer';
export type { Renderer } from './renderer';
export type { Color, PathCommand, Matrix3x3 } from './renderer';

// Animation
export { AnimationScheduler, createAnimationScheduler, applyEasing } from './animation';

// Runtime
export { RenderLoop, createRenderLoop, InputTracker, createInputTracker } from './runtime';
