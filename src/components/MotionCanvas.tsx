import { useRef, useEffect, useCallback } from 'react';
import { Canvas2DRenderer } from '../renderer/canvas2d';
import { parse } from '../parser/parser';
import { buildSceneGraph } from '../scene/builder';
import { createRenderLoop, RenderLoop } from '../runtime/loop';
import { createAnimationScheduler, AnimationScheduler } from '../animation/scheduler';
import type { InputTracker } from '../runtime/inputs';
import type { SceneNode } from '../scene/types';
import type { CanvasConfig } from '../parser/ast';

export interface MotionCanvasProps {
  /** CSS-like scene definition */
  source: string;
  /** Canvas width (overrides source) */
  width?: number;
  /** Canvas height (overrides source) */
  height?: number;
  /** Background color (overrides source) */
  backgroundColor?: string;
  /** Called when scene is parsed */
  onSceneReady?: (scene: SceneNode) => void;
  /** Called on parse error */
  onError?: (error: Error) => void;
  /** Additional class name */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
}

/**
 * React component for rendering motion scene graphs
 */
export function MotionCanvas({
  source,
  width: propsWidth,
  height: propsHeight,
  backgroundColor: propsBgColor,
  onSceneReady,
  onError,
  className,
  style,
}: MotionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderLoopRef = useRef<RenderLoop | null>(null);
  const schedulerRef = useRef<AnimationScheduler | null>(null);
  const inputTrackerRef = useRef<InputTracker | null>(null);
  const canvasConfigRef = useRef<CanvasConfig | null>(null);

  // Parse and build scene
  const buildScene = useCallback(() => {
    try {
      const stylesheet = parse(source);
      canvasConfigRef.current = stylesheet.canvas || null;
      const scene = buildSceneGraph(stylesheet);

      if (onSceneReady) {
        onSceneReady(scene);
      }

      return { scene, config: stylesheet.canvas, variables: stylesheet.variables };
    } catch (err) {
      if (onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
      return null;
    }
  }, [source, onSceneReady, onError]);

  // Initialize and start render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Build scene
    const result = buildScene();
    if (!result) return;

    const { scene, config, variables } = result;

    // Determine canvas size
    const width = propsWidth ?? config?.width ?? 800;
    const height = propsHeight ?? config?.height ?? 600;

    // Set canvas dimensions
    canvas.width = width;
    canvas.height = height;

    // Create renderer
    const renderer = new Canvas2DRenderer(canvas);

    // Create scheduler
    const scheduler = createAnimationScheduler();
    schedulerRef.current = scheduler;

    // Create render loop (it creates its own input tracker and variable resolver)
    const renderLoop = createRenderLoop(renderer, scheduler);
    renderLoopRef.current = renderLoop;

    // Set background color
    const bgColor = propsBgColor ?? config?.background ?? null;
    renderLoop.setBackgroundColor(bgColor);

    // Set scene
    renderLoop.setScene(scene);

    // Get input tracker from render loop and attach to canvas
    const inputTracker = renderLoop.getInputTracker();
    inputTrackerRef.current = inputTracker;
    inputTracker.attach(canvas);

    // Set variables in the variable resolver
    if (variables && variables.length > 0) {
      renderLoop.getVariableResolver().setVariables(variables);
    }

    // Start loop
    renderLoop.start();

    // Cleanup
    return () => {
      renderLoop.stop();
      inputTracker.detach();
      renderLoopRef.current = null;
      schedulerRef.current = null;
      inputTrackerRef.current = null;
    };
  }, [source, propsWidth, propsHeight, propsBgColor, buildScene]);

  // Calculate display dimensions
  const config = canvasConfigRef.current;
  const displayWidth = propsWidth ?? config?.width ?? 800;
  const displayHeight = propsHeight ?? config?.height ?? 600;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: 'block',
        width: displayWidth,
        height: displayHeight,
        ...style,
      }}
    />
  );
}

/**
 * Hook for using the motion scene graph imperatively
 */
export function useMotionScene(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const renderLoopRef = useRef<RenderLoop | null>(null);
  const schedulerRef = useRef<AnimationScheduler | null>(null);
  const sceneRef = useRef<SceneNode | null>(null);

  const initialize = useCallback((source: string, options?: {
    width?: number;
    height?: number;
    backgroundColor?: string;
  }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    try {
      // Parse and build scene
      const stylesheet = parse(source);
      const scene = buildSceneGraph(stylesheet);
      sceneRef.current = scene;

      // Set canvas dimensions
      const width = options?.width ?? stylesheet.canvas?.width ?? 800;
      const height = options?.height ?? stylesheet.canvas?.height ?? 600;
      canvas.width = width;
      canvas.height = height;

      // Create renderer and loop
      const renderer = new Canvas2DRenderer(canvas);
      const scheduler = createAnimationScheduler();
      const renderLoop = createRenderLoop(renderer, scheduler);

      schedulerRef.current = scheduler;
      renderLoopRef.current = renderLoop;

      // Set background and scene
      const bgColor = options?.backgroundColor ?? stylesheet.canvas?.background ?? null;
      renderLoop.setBackgroundColor(bgColor);
      renderLoop.setScene(scene);

      return scene;
    } catch (err) {
      console.error('Failed to initialize motion scene:', err);
      return null;
    }
  }, [canvasRef]);

  const start = useCallback(() => {
    renderLoopRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    renderLoopRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    renderLoopRef.current?.reset();
  }, []);

  const getScene = useCallback(() => {
    return sceneRef.current;
  }, []);

  const cleanup = useCallback(() => {
    renderLoopRef.current?.stop();
    renderLoopRef.current = null;
    schedulerRef.current = null;
    sceneRef.current = null;
  }, []);

  return {
    initialize,
    start,
    stop,
    reset,
    getScene,
    cleanup,
  };
}
