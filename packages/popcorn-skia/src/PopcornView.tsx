import { useEffect, useState } from 'react';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import {
  parse,
  buildSceneGraph,
  RenderLoop,
  computeViewport,
  viewportMatrix,
} from '@popcorn/player';
import { SkiaRenderer } from './skia-renderer';

type SkPicture = import('@shopify/react-native-skia').SkPicture;

export interface PopcornViewProps {
  /** Popcorn DSL source (the `.css` scene). */
  source: string;
  /** Layout size in px (also the Skia backing size for the PoC — dpr 1). */
  width: number;
  height: number;
  /** Start the timeline on mount (default true). */
  autoplay?: boolean;
  /** Wrap the timeline at the scene duration (default false). */
  loop?: boolean;
}

/**
 * Renders a Popcorn scene through React Native Skia. Consumable from React
 * Native and, via react-native-web + CanvasKit, the browser.
 *
 * Each RAF tick the RenderLoop paints into a fresh PictureRecorder canvas; the
 * finished SkPicture is pushed into <Picture> for display. The loop's public API
 * (start/pause/setFrameCallback) drives everything — no bespoke scheduler.
 */
export function PopcornView({ source, width, height, autoplay = true, loop = false }: PopcornViewProps) {
  const [picture, setPicture] = useState<SkPicture | null>(null);

  useEffect(() => {
    const ast = parse(source);
    const sceneW = ast.canvas?.width ?? width;
    const sceneH = ast.canvas?.height ?? height;
    const sceneRoot = buildSceneGraph(ast);

    const renderer = new SkiaRenderer(Skia, { width, height });
    const rl = new RenderLoop(renderer);
    rl.setScene(sceneRoot);
    rl.setSceneSize(sceneW, sceneH);
    rl.setLoop(loop);
    rl.setViewport(viewportMatrix(computeViewport(sceneW, sceneH, width, height, 1, 'contain')));
    rl.getVariableResolver().setVariables(ast.variables);
    if (ast.canvas?.background) rl.setBackgroundColor(ast.canvas.background);

    const bounds = Skia.XYWHRect(0, 0, width, height);
    let recorder = Skia.PictureRecorder();

    // Bind the canvas the NEXT frame paints into. render() runs before the frame
    // callback fires, so the very first canvas is bound before start().
    const bind = () => {
      recorder = Skia.PictureRecorder();
      renderer.setCanvas(recorder.beginRecording(bounds));
    };

    bind();
    rl.setFrameCallback(() => {
      setPicture(recorder.finishRecordingAsPicture());
      bind();
    });

    rl.start();
    if (!autoplay) rl.pause();

    return () => rl.stop();
  }, [source, width, height, autoplay, loop]);

  // ponytail: touch input deferred. The seam is renderLoop.getInputTracker()
  // .getState().cursor (mutable) — map a touch via deviceToScene into it — but
  // wiring RN responder props cleanly needs react-native's types, out of scope
  // for this types-light PoC.
  return (
    <Canvas style={{ width, height }}>
      {picture ? <Picture picture={picture} /> : null}
    </Canvas>
  );
}
