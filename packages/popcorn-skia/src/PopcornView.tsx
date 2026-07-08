import { useEffect, useRef } from 'react';
import { Skia, SkiaPictureView } from '@shopify/react-native-skia';
import type { ISkiaViewApi } from '@shopify/react-native-skia';
import {
  parse,
  buildSceneGraph,
  RenderLoop,
  computeViewport,
  viewportMatrix,
} from '@popcorn/player';
import { SkiaRenderer } from './skia-renderer';

// SkiaViewApi is a native-injected global (not a package export) — the same seam
// SkiaPictureView uses internally to push its `picture` prop. We read it off
// global to drive the view imperatively.
const getSkiaViewApi = (): ISkiaViewApi | undefined =>
  (globalThis as unknown as { SkiaViewApi?: ISkiaViewApi }).SkiaViewApi;

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
  /** Freeze the timeline without tearing down the loop (e.g. behind a modal). */
  paused?: boolean;
}

/**
 * Renders a Popcorn scene through React Native Skia.
 *
 * The SkiaPictureView mounts once; each frame the RenderLoop paints into a fresh
 * PictureRecorder and the finished SkPicture is pushed to the native view
 * IMPERATIVELY (SkiaViewApi.setJsiProperty + requestRedraw) — never through React
 * state, so React re-renders only when `source`/`width`/`height` change. This is
 * the same seam SkiaPictureView uses internally for its own `picture` prop.
 */
export function PopcornView({ source, width, height, autoplay = true, loop = false, paused }: PopcornViewProps) {
  const viewRef = useRef<SkiaPictureView>(null);
  const loopRef = useRef<RenderLoop | null>(null);

  // Freeze the timeline (default) unless the caller is actively playing. `paused`
  // wins when given; otherwise `autoplay: false` starts paused.
  const wantPaused = paused ?? !autoplay;

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
    loopRef.current = rl;

    const bounds = Skia.XYWHRect(0, 0, width, height);
    let recorder = Skia.PictureRecorder();
    // Once the resting frame of a static (one-shot, non-interactive) scene is
    // delivered we unbind the canvas so further ticks paint and push nothing.
    let settled = false;

    // A PictureRecorder is single-use (finishRecordingAsPicture invalidates it),
    // so each frame gets a fresh one; the canvas it hands out is what render() paints.
    const bind = () => {
      recorder = Skia.PictureRecorder();
      renderer.setCanvas(recorder.beginRecording(bounds));
    };

    // Hand the just-recorded picture to the native view without touching React.
    const push = () => {
      const api = getSkiaViewApi();
      const id = viewRef.current?.nativeId;
      if (!api || id == null) return;
      api.setJsiProperty(id, 'picture', recorder.finishRecordingAsPicture());
      api.requestRedraw(id);
    };

    // Timeline time of the frame currently frozen on screen while paused; null
    // when the timeline is live. Lets a paused scene go dormant (the scheduler is
    // frozen, so every tick would otherwise re-record an identical picture).
    let frozenAt: number | null = null;

    bind();
    rl.setFrameCallback(() => {
      const isStatic = rl.isStatic();

      // Dormant: resting frame already on screen and this tick painted nothing.
      if (isStatic && settled) return;

      if (isStatic) {
        // First settled frame: render() just drew the resting state into `recorder`.
        // Deliver it, then unbind so subsequent ticks do no paint/JSI work.
        push();
        renderer.setCanvas(null);
        settled = true;
        return;
      }

      if (settled) {
        // Woke back up: the canvas was unbound so nothing was painted this tick.
        // Rebind and deliver on the next one.
        settled = false;
        bind();
        return;
      }

      // Paused (dynamic scene, so isStatic is false): the timeline is frozen.
      // Deliver one frame at the frozen instant, then unbind and stay dormant
      // until time moves again (resume or seek). Keying on currentTime means a
      // seek-while-paused wakes it; touch input is deferred in this PoC, so a
      // frozen scene has nothing else that could change.
      if (rl.paused) {
        const t = rl.currentTime;
        if (frozenAt === t) return;          // dormant, nothing changed
        if (frozenAt !== null) {             // dormant, but time moved (seek): rebind, deliver next tick
          frozenAt = null;
          bind();
          return;
        }
        push();                              // canvas was bound: this instant is recorded — deliver it
        renderer.setCanvas(null);
        frozenAt = t;
        return;
      }
      if (frozenAt !== null) {               // resumed from a dormant pause: rebind, deliver next tick
        frozenAt = null;
        bind();
        return;
      }

      push();
      bind();
    });

    rl.start();
    if (wantPaused) rl.pause();

    return () => {
      rl.stop();
      loopRef.current = null;
    };
    // wantPaused is read for the initial state only; runtime toggles go through
    // the pause effect below so a pause never rebuilds the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, width, height, loop]);

  // Pause/resume without tearing down the loop — the loop keeps its rAF so a
  // settled frame and (future) touch input stay live while frozen.
  useEffect(() => {
    const rl = loopRef.current;
    if (!rl) return;
    if (wantPaused) rl.pause();
    else rl.resume();
  }, [wantPaused]);

  // ponytail: touch input deferred. The seam is renderLoop.getInputTracker()
  // .getState().cursor (mutable) — map a touch via deviceToScene into it — but
  // wiring RN responder props cleanly needs react-native's types, out of scope
  // for this types-light PoC.
  return <SkiaPictureView ref={viewRef} style={{ width, height }} />;
}
