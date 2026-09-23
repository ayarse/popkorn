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
} from "./interop.js";
import { SkiaRenderer } from "./skia-renderer.js";

export type { PopkornViewRef } from "./interop.js";

// SkiaViewApi is a native-injected global, the seam SkiaPictureView uses to push its `picture`.
const getSkiaViewApi = (): ISkiaViewApi | undefined =>
  (globalThis as unknown as { SkiaViewApi?: ISkiaViewApi }).SkiaViewApi;

export interface PopkornViewProps {
  /** Popkorn DSL source (the `.css` scene). */
  source: string;
  /** Layout size in px, also the Skia backing size (dpr 1). */
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
 * Renders a Popkorn scene through React Native Skia. Each frame's SkPicture is
 * pushed to the native view imperatively, so React re-renders only on source/size change.
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
    // Active viewport for mapping touches (scene <- device inverse).
    const vpRef = useRef<Viewport | null>(null);
    // Breaks the frame loop's dormancy (see `wake` below) after a touch / host call.
    const pokeRef = useRef<(() => void) | null>(null);

    // Event-out handlers read through refs so changing them never rebuilds the scene.
    const onStateChangeRef = useRef(onStateChange);
    const onMachineEventRef = useRef(onMachineEvent);
    onStateChangeRef.current = onStateChange;
    onMachineEventRef.current = onMachineEvent;

    // `paused` wins when given; otherwise `autoplay: false` starts paused.
    const wantPaused = paused ?? !autoplay;

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
      // Machine transitions/emits -> host props.
      rl.setMachineEventCallback(
        makeMachineEventCallback(() => ({
          onStateChange: onStateChangeRef.current,
          onMachineEvent: onMachineEventRef.current,
        })),
      );
      loopRef.current = rl;

      const bounds = Skia.XYWHRect(0, 0, width, height);
      let recorder = Skia.PictureRecorder();
      // After a static scene's resting frame is delivered the canvas is unbound, so ticks do nothing.
      let settled = false;

      // PictureRecorder is single-use, so each frame gets a fresh one.
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

      // Frozen timeline time while paused (null when live), so a paused scene can go dormant.
      let frozenAt: number | null = null;

      // Rebind so the next live tick (machines + input edges) paints; redraw() here would re-freeze before it.
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

      // A non-data: image still decoding at settle/freeze: wake when it lands.
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
          // First settled frame: deliver it, then unbind.
          push();
          renderer.setCanvas(null);
          settled = true;
          wakeWhenImagesSettle();
          return;
        }

        if (settled) {
          // Woke: canvas was unbound this tick; rebind and deliver next.
          settled = false;
          bind();
          return;
        }

        // Paused: deliver one frame at the frozen instant, then stay dormant until time moves or a wake.
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, width, height, loop]);

    // Pause/resume without teardown; rAF keeps running so touches and machines stay live.
    useEffect(() => {
      const rl = loopRef.current;
      if (!rl) return;
      if (wantPaused) rl.pause();
      else rl.resume();
    }, [wantPaused]);

    // Host API; getLoop/wake read through refs, so the handle is stable.
    useImperativeHandle(
      ref,
      () =>
        createHostApi(
          () => loopRef.current,
          () => pokeRef.current?.(),
        ),
      [],
    );

    // Touch -> shared cursor state; the loop derives click/pointer triggers and input(cursor.*). No hover on touch.
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
      // Latch the press so a tap released before the next frame still produces an edge.
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
