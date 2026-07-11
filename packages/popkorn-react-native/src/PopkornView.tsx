import type { Viewport } from "@popkorn/player";
import {
  buildSceneGraph,
  computeViewport,
  parse,
  RenderLoop,
  viewportMatrix,
} from "@popkorn/player";
import type { ISkiaViewApi } from "@shopify/react-native-skia";
import { Skia, SkiaPictureView } from "@shopify/react-native-skia";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { type GestureResponderEvent, View } from "react-native";
import {
  createHostApi,
  makeMachineEventCallback,
  type PopkornViewRef,
  touchToScene,
} from "./interop";
import { SkiaRenderer } from "./skia-renderer";

export type { PopkornViewRef } from "./interop";

// SkiaViewApi is a native-injected global (not a package export) — the same seam
// SkiaPictureView uses internally to push its `picture` prop. We read it off
// global to drive the view imperatively.
const getSkiaViewApi = (): ISkiaViewApi | undefined =>
  (globalThis as unknown as { SkiaViewApi?: ISkiaViewApi }).SkiaViewApi;

export interface PopkornViewProps {
  /** Popkorn DSL source (the `.css` scene). */
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
  /** A state machine transitioned (fires per `@machine` transition). */
  onStateChange?: (e: { machine: string; from: string; to: string }) => void;
  /** A state emitted an event (`emit: name` on entry). */
  onMachineEvent?: (e: { machine: string; name: string }) => void;
}

/**
 * Renders a Popkorn scene through React Native Skia.
 *
 * The SkiaPictureView mounts once; each frame the RenderLoop paints into a fresh
 * PictureRecorder and the finished SkPicture is pushed to the native view
 * IMPERATIVELY (SkiaViewApi.setJsiProperty + requestRedraw) — never through React
 * state, so React re-renders only when `source`/`width`/`height` change. This is
 * the same seam SkiaPictureView uses internally for its own `picture` prop.
 *
 * Touches feed the shared cursor input state (mapped to scene space), which lights
 * up `click()`/`pointerdown`/`pointerup` machine triggers and `input(cursor.*)`
 * bindings; the `ref` exposes `setVariable`/`getVariable`/`fire` for host-driven
 * state, and `onStateChange`/`onMachineEvent` report transitions back out.
 */
export const PopkornView = forwardRef<PopkornViewRef, PopkornViewProps>(
  function PopkornView(
    {
      source,
      width,
      height,
      autoplay = true,
      loop = false,
      paused,
      onStateChange,
      onMachineEvent,
    },
    ref,
  ) {
    const viewRef = useRef<SkiaPictureView>(null);
    const loopRef = useRef<RenderLoop | null>(null);
    // The active viewport (scene<-device inverse) for mapping touches; set with the
    // scene so a touch handler never reimplements the fit/DPR math.
    const vpRef = useRef<Viewport | null>(null);
    // Breaks the frame loop's dormancy (see `wake` below) after a touch / host call.
    const pokeRef = useRef<(() => void) | null>(null);

    // Latest event-out handlers, read through refs so changing them never rebuilds
    // the scene (the loop wires one stable callback that dereferences these).
    const onStateChangeRef = useRef(onStateChange);
    const onMachineEventRef = useRef(onMachineEvent);
    onStateChangeRef.current = onStateChange;
    onMachineEventRef.current = onMachineEvent;

    // Freeze the timeline (default) unless the caller is actively playing. `paused`
    // wins when given; otherwise `autoplay: false` starts paused.
    const wantPaused = paused ?? !autoplay;

    // wantPaused is read for the initial state only; runtime toggles go through
    // the pause effect below so a pause never rebuilds the scene. Excluding it is
    // deliberate — adding it would tear down and rebuild the whole scene on every
    // pause/resume.
    // biome-ignore lint/correctness/useExhaustiveDependencies: wantPaused is init-only; runtime toggles use the pause effect below.
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
      const vp = computeViewport(sceneW, sceneH, width, height, 1, "contain");
      vpRef.current = vp;
      rl.setViewport(viewportMatrix(vp));
      rl.getVariableResolver().setVariables(ast.variables);
      if (ast.canvas?.background) rl.setBackgroundColor(ast.canvas.background);
      // Machine transitions/emits -> host props (same detail shapes as the web
      // component's statechange / machine-event events).
      rl.setMachineEventCallback(
        makeMachineEventCallback(() => ({
          onStateChange: onStateChangeRef.current,
          onMachineEvent: onMachineEventRef.current,
        })),
      );
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
        api.setJsiProperty(id, "picture", recorder.finishRecordingAsPicture());
        api.requestRedraw(id);
      };

      // Timeline time of the frame currently frozen on screen while paused; null
      // when the timeline is live. Lets a paused scene go dormant (the scheduler is
      // frozen, so every tick would otherwise re-record an identical picture).
      let frozenAt: number | null = null;

      // Break dormancy after input: rebind the canvas so the next rAF *live* tick
      // (which evaluates machines + input edges — redraw() does not) paints and
      // pushes the result. The rAF loop keeps running while paused, so we only need
      // to reopen the canvas; we deliberately do NOT redraw() here, which would
      // re-freeze before the live tick processes the pending pointer/machine event.
      const wake = () => {
        if (settled) {
          settled = false;
          bind();
        } else if (frozenAt !== null) {
          frozenAt = null;
          bind();
        }
      };
      pokeRef.current = wake;

      // If a non-data: image was still decoding when a frame settled/froze,
      // schedule a wake-up for when it lands — otherwise the view stays
      // dormant on the blank-image frame until an unrelated touch/host call
      // happens to poke it.
      const wakeWhenImagesSettle = () => {
        if (!renderer.hasPendingImages()) return;
        renderer.whenImagesSettled().then(() => pokeRef.current?.());
      };

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
          wakeWhenImagesSettle();
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
        // until time moves again (resume/seek) or a touch/host call wakes us.
        if (rl.paused) {
          const t = rl.currentTime;
          if (frozenAt === t) return; // dormant, nothing changed
          if (frozenAt !== null) {
            // dormant, but time moved (seek/wake): rebind, deliver next tick
            frozenAt = null;
            bind();
            return;
          }
          push(); // canvas was bound: this instant is recorded — deliver it
          renderer.setCanvas(null);
          frozenAt = t;
          wakeWhenImagesSettle();
          return;
        }
        if (frozenAt !== null) {
          // resumed from a dormant pause: rebind, deliver next tick
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
        vpRef.current = null;
        pokeRef.current = null;
      };
      // wantPaused is read for the initial state only; runtime toggles go through
      // the pause effect below so a pause never rebuilds the scene.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, width, height, loop]);

    // Pause/resume without tearing down the loop — the loop keeps its rAF so a
    // settled frame, touch input, and machine transitions stay live while frozen.
    useEffect(() => {
      const rl = loopRef.current;
      if (!rl) return;
      if (wantPaused) rl.pause();
      else rl.resume();
    }, [wantPaused]);

    // Host API (setVariable / getVariable / fire). getLoop/wake are read lazily
    // through refs, so the handle is stable and works regardless of when the loop
    // is created relative to this commit.
    useImperativeHandle(
      ref,
      () =>
        createHostApi(
          () => loopRef.current,
          () => pokeRef.current?.(),
        ),
      [],
    );

    // Touch -> shared cursor input state (scene space). The running loop turns the
    // isDown edges into click/pointerdown/pointerup machine triggers via its own
    // hit-tester, and resolves input(cursor.*) bindings; `wake` breaks dormancy so
    // a frozen scene repaints. hoverstart/hoverend can't fire on touch — that's
    // what media.hover is for.
    const onTouch = (e: GestureResponderEvent) => {
      const rl = loopRef.current;
      const vp = vpRef.current;
      if (!rl || !vp) return;
      const { locationX, locationY } = e.nativeEvent;
      const p = touchToScene(vp, locationX, locationY);
      const cursor = rl.getInputTracker().getState().cursor;
      cursor.x = p.x;
      cursor.y = p.y;
      cursor.isDown = true;
      // Latch the press so a quick tap (grant+release between two frames) still
      // produces a pointerdown/click edge — the loop samples isDown once per
      // live frame and would otherwise miss a release that beats the next frame.
      cursor.pressed = true;
      pokeRef.current?.();
    };

    const onTouchEnd = () => {
      const rl = loopRef.current;
      if (!rl) return;
      rl.getInputTracker().getState().cursor.isDown = false;
      pokeRef.current?.();
    };

    return (
      <View
        style={{ width, height }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onTouch}
        onResponderMove={onTouch}
        onResponderRelease={onTouchEnd}
        onResponderTerminate={onTouchEnd}
      >
        {/* pointerEvents: the Skia native view swallows touches on iOS (Android
            passes them through), which starved the responder — taps must land
            on the wrapper View, which owns all input. */}
        <SkiaPictureView
          ref={viewRef}
          style={{ width, height, pointerEvents: "none" }}
        />
      </View>
    );
  },
);
