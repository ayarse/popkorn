import { isFunctionValue, isKeywordValue, type Value } from "@popcorn/parser";
import { applyEasing } from "../animation/easing";
import { getPropHandler } from "../animation/registry";
import {
  AnimationScheduler,
  computeSceneDuration,
  sampleNodeAtProgress,
} from "../animation/scheduler";
import type { Renderer } from "../renderer/interface";
import type { Matrix3x3, TrimDescriptor } from "../renderer/types";
import { IDENTITY_MATRIX, multiplyMatrices } from "../renderer/types";
import { resolveClip } from "../scene/clip";
import { outlineLength } from "../scene/path-parser";
import { polystarCommands } from "../scene/polystar";
import {
  clamp01,
  computeLocalMatrix,
  computeWorldMatrixFromRoot,
} from "../scene/transform";
import type {
  CircleData,
  EllipseData,
  FilterOp,
  ImageData,
  PathData,
  RectData,
  SceneNode,
  TextData,
  TimeRemapStop,
} from "../scene/types";
import { childrenInPaintOrder, resetNodeToBase } from "../scene/types";
import { hitTest } from "./hit-test";
import { createInputTracker, type InputTracker } from "./inputs";
import {
  applyStateStyles,
  createInteractionManager,
  type InteractionManager,
} from "./interaction";
import {
  createStateMachineRunner,
  type MachineOutput,
  type PointerTriggerEvent,
  type StateMachineRunner,
} from "./state-machine";
import { createVariableResolver, type VariableResolver } from "./variables";

/**
 * Flags set only on the TOP node of a mask composite pass (renderMask). Never
 * propagated to children, so nested mattes resolve independently.
 * - `paintSource`: paint this node even though it is `isMaskSource`.
 * - `skipMask`: skip this node's own `mask` redirect (we are already inside its
 *   composite) — a matte SOURCE is entered WITHOUT this so its own mask applies.
 */
interface RenderOpts {
  paintSource?: boolean;
  skipMask?: boolean;
}

/**
 * Main render loop.
 *
 * Drives requestAnimationFrame and, each frame, runs the value-resolution
 * pipeline per node: reset live fields to the authored base, then layer
 * bindings (var()/input()), animation (keyframe sampling at timeline time),
 * and interaction overrides (:hover/:active) — in that fixed order. The
 * renderer and hit-test read the resulting live fields unchanged.
 */
export class RenderLoop {
  private renderer: Renderer;
  private sceneRoot: SceneNode | null = null;
  private scheduler: AnimationScheduler;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private backgroundColor: string | null = null;
  private inputTracker: InputTracker;
  private variableResolver: VariableResolver;
  private interactionManager: InteractionManager;
  // State-machine runner: evaluated once per LIVE frame before the walk. Its
  // state lives off the timeline, so seek() never touches it.
  private machineRunner: StateMachineRunner = createStateMachineRunner();
  // Forwarded to the host (component) as statechange / machine-event DOM events.
  private machineEventCallback: ((output: MachineOutput) => void) | null = null;
  // Pointer-edge state for machine triggers (wall-clock/input driven, off the
  // timeline — like the InteractionManager's hover tracking).
  private prevIsDown: boolean = false;
  private prevHit: SceneNode | null = null;
  private downHit: SceneNode | null = null;
  // Fit-to-container: root transform (scene -> device px) applied each frame, plus
  // the scene box size the background fills. Default identity = 1:1, no fit.
  private viewport: Matrix3x3 = IDENTITY_MATRIX;
  // One-time guard: a node has a `filter` but the renderer can't apply it (old
  // Safari, or a backend without a filter concept). Warned once, then unfiltered.
  private filterWarned: boolean = false;
  private sceneWidth: number = 0;
  private sceneHeight: number = 0;
  // Looping: when on, the timeline wraps once it passes `sceneDuration`.
  private looping: boolean = false;
  private sceneDuration: number = 0;
  // Cached at setScene: does anything make this scene keep changing on its own
  // (infinite animation) or in response to input/interaction (bindings, hover/
  // active)? Drives `isStatic` — an embedder can stop repainting a settled scene.
  private sceneDynamic: boolean = false;
  // Cached at setScene: does any subtree remap inherited time (time-offset/
  // time-scale/time-remap)? When it does, `sceneDuration` (a max of animation
  // end times measured in each subtree's LOCAL time) is not the scene's end on
  // the root timeline, so the play-once clamp below can't trust it and stays off.
  private sceneTimeScoped: boolean = false;
  // Cached at setScene: does the scene have a state machine (or any `:state()`
  // set, which can be authored without a machine)? Such a scene is not a finite
  // clip — machine state lives off the timeline, so there's no end to hold, wrap,
  // or finish at. The clock free-runs monotonically; `sceneDuration` (a max of
  // BASE animation ends) is not a bound, and wrapping it would fold the clock
  // back BEFORE a later state's entry time, replaying that state's animation.
  private sceneUnbounded: boolean = false;
  // Fires once per rendered frame with the current timeline time (drives the
  // controls scrubber off the existing loop tick — no extra rAF).
  private frameCallback: ((time: number) => void) | null = null;
  // Fires once when a non-looping finite timeline first reaches its end. Latched
  // so the held-at-end frames don't re-fire it; the latch clears when the clock
  // drops back inside the clip (seek/reset), so a replay can complete again.
  private completeCallback: (() => void) | null = null;
  private hasCompleted: boolean = false;
  // Stable per-node keys for the retained-backend bracket (beginNode/endNode).
  // node.id is a CSS selector name and NOT unique (classes, symbol expansion),
  // so we stamp a monotonic key on first sight. Nodes are built once and live
  // for the scene's lifetime, so the WeakMap keeps keys stable across frames.
  private nodeKeys = new WeakMap<SceneNode, string>();
  private nextNodeKey = 0;

  constructor(
    renderer: Renderer,
    scheduler?: AnimationScheduler,
    inputTracker?: InputTracker,
    variableResolver?: VariableResolver,
    interactionManager?: InteractionManager,
  ) {
    this.renderer = renderer;
    this.scheduler = scheduler || new AnimationScheduler();
    this.inputTracker = inputTracker || createInputTracker();
    this.variableResolver = variableResolver || createVariableResolver();
    this.interactionManager = interactionManager || createInteractionManager();
  }

  getInputTracker(): InputTracker {
    return this.inputTracker;
  }

  getVariableResolver(): VariableResolver {
    return this.variableResolver;
  }

  getInteractionManager(): InteractionManager {
    return this.interactionManager;
  }

  setScene(root: SceneNode): void {
    this.sceneRoot = root;
    this.nodeKeys = new WeakMap();
    this.nextNodeKey = 0;
    this.interactionManager.setScene(root);
    // Machines start at their initial states, anchored at timeline zero.
    this.machineRunner.setScene(root, 0);
    this.prevIsDown = false;
    this.prevHit = null;
    this.downHit = null;
    this.sceneDuration = computeSceneDuration(root);
    this.hasCompleted = false;
    this.sceneDynamic = sceneHasDynamicContent(root);
    this.sceneTimeScoped = sceneHasTimeScoping(root);
    this.sceneUnbounded = sceneIsUnbounded(root);
  }

  /** The scene's state-machine runner (host events, tests). */
  getStateMachineRunner(): StateMachineRunner {
    return this.machineRunner;
  }

  /** Register a callback for machine transitions/emits (component wiring). */
  setMachineEventCallback(cb: ((output: MachineOutput) => void) | null): void {
    this.machineEventCallback = cb;
  }

  /** Enqueue an external `on event(name)` occurrence for the next live frame. */
  enqueueMachineEvent(name: string): void {
    this.machineRunner.enqueueEvent(name);
  }

  setBackgroundColor(color: string | null): void {
    this.backgroundColor = color;
  }

  /** Intrinsic scene size (the :root stage box) the background fills and fit maps. */
  setSceneSize(width: number, height: number): void {
    this.sceneWidth = width;
    this.sceneHeight = height;
  }

  /** Root transform (scene -> device px) applied at the start of each frame. */
  setViewport(matrix: Matrix3x3): void {
    this.viewport = matrix;
  }

  /** Enable/disable timeline looping (wraps at `duration`). */
  setLoop(enabled: boolean): void {
    this.looping = enabled;
  }

  /** Register a per-frame callback (current timeline time in ms). */
  setFrameCallback(cb: ((time: number) => void) | null): void {
    this.frameCallback = cb;
  }

  /** Register a callback fired once when a play-once timeline reaches its end. */
  setCompleteCallback(cb: (() => void) | null): void {
    this.completeCallback = cb;
  }

  /** Scene duration in ms (max animation end time; infinite counts as one iteration). */
  get duration(): number {
    return this.sceneDuration;
  }

  /** Whether the rAF loop is currently running. */
  get running(): boolean {
    return this.isRunning;
  }

  /** Whether the timeline is frozen (paused). */
  get paused(): boolean {
    return this.scheduler.isPaused();
  }

  /**
   * True when the scene can produce no further visual change on its own, so an
   * embedder may stop repainting until a prop change re-mounts the loop. Honest
   * about reactivity: a looping timeline, any infinite animation, or any
   * input()/var() binding or :hover/:active style keeps it non-static — only a
   * one-shot scene whose timeline has run past its duration settles.
   */
  isStatic(): boolean {
    if (!this.sceneRoot) return true;
    // An unbounded (state-machine) scene never finishes — it can always still
    // transition — so it's never static regardless of the clock.
    if (this.looping || this.sceneDynamic || this.sceneUnbounded) return false;
    return this.currentTime >= this.sceneDuration;
  }

  /** Repaint one frame at the current timeline time (for resize while paused/stopped). */
  redraw(): void {
    this.drawFrame(performance.now());
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduler.start();
    this.loop(performance.now());
  }

  stop(): void {
    this.isRunning = false;
    this.scheduler.stop();
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  reset(): void {
    this.scheduler.reset();
    if (!this.isRunning) this.drawFrame(performance.now());
  }

  /** Freeze the timeline; the loop keeps running so interaction stays live. */
  pause(): void {
    this.scheduler.pause();
  }

  /** Resume the timeline from where it was paused. */
  resume(): void {
    this.scheduler.resume();
  }

  /** Jump to `ms` and render that instant — works while paused or stopped. */
  seek(ms: number): void {
    const now = performance.now();
    this.scheduler.seek(ms, now);
    // Render exactly one frame at the seeked instant, synchronously. seek is a
    // pure function of time (invariant 4) and that includes the canvas: a paused
    // loop may never get another rAF tick (a backgrounded tab throttles rAF to
    // nothing), so relying on the next frame leaves the displayed frame stale.
    // While playing, this one extra draw is idempotent and the loop continues.
    this.drawFrame(now);
  }

  /** Current timeline time in milliseconds. */
  get currentTime(): number {
    return this.scheduler.time();
  }

  private loop = (timestamp: number): void => {
    if (!this.isRunning) return;

    // Update input state
    this.inputTracker.update(timestamp);
    this.variableResolver.updateInputState(this.inputTracker.getState());

    // Update interaction state (hover, active). `timestamp` anchors any
    // transition a state flip starts.
    this.interactionManager.update(this.inputTracker.getState(), timestamp);

    // Resolve the whole scene at the current timeline time, then paint. `live`
    // gates the parts that must run only on a real rAF tick — machine evaluation
    // and momentary-trigger reset — so seek()/redraw() stay pure functions of
    // (time, machineState).
    this.drawFrame(timestamp, true);

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  /** Resolve every node's live values at the current timeline time and render. */
  private drawFrame(now: number, live: boolean = false): void {
    if (this.sceneRoot) {
      let t = this.scheduler.time(now);
      // Clear the completion latch whenever the clock sits inside the clip, so a
      // seek-back or reset lets `complete` fire again on the next pass.
      if (t < this.sceneDuration) this.hasCompleted = false;
      // Looping: once the timeline runs past the scene's duration, fold it back
      // into [0, duration) and re-anchor the scheduler. Re-anchoring (rather than
      // just sampling the wrapped t) resets fill-forward states cleanly and keeps
      // currentTime bounded. Skipped while paused so scrubbing to the end holds.
      // Unbounded (state-machine) scenes opt out of BOTH the wrap and the
      // play-once clamp: the clock is monotonic so state-animation entry anchors
      // (machineTime - entryTime) never fold negative and replay. The `loop`
      // attribute is inert for them. (Sits alongside the sceneTimeScoped opt-out
      // below — same "sceneDuration isn't a root-timeline bound" reasoning.)
      if (this.looping && !this.scheduler.isPaused() && !this.sceneUnbounded) {
        const wrapped = wrapTime(t, this.sceneDuration, true);
        if (wrapped !== t) {
          this.scheduler.seek(wrapped, now);
          t = wrapped;
        }
      } else if (
        !this.looping &&
        !this.sceneTimeScoped &&
        !this.sceneUnbounded &&
        this.sceneDuration > 0 &&
        t > this.sceneDuration
      ) {
        // Not looping: hold at the end of one full pass ("play once and stop").
        // Without this, t free-runs past duration and any infinite animation
        // keeps cycling. Re-anchor (like the wrap above) so currentTime stays
        // bounded and the frozen frame is a pure function of time — seeking past
        // the end shows this same clamped final frame whether playing or paused.
        // Skipped for time-scoped scenes (see sceneTimeScoped): their duration
        // isn't a root-timeline bound, so they keep their old free-run behavior.
        this.scheduler.seek(this.sceneDuration, now);
        t = this.sceneDuration;
        if (!this.hasCompleted) {
          this.hasCompleted = true;
          this.completeCallback?.();
        }
      }

      // Machines evaluate once per LIVE frame, BEFORE the node walk. `t` (the
      // wrapped/clamped timeline time) is the machine time base — the same value
      // the walk anchors state animations against. Pointer triggers come from
      // the shared hit-tester; the outputs are forwarded to the host.
      if (live && this.machineRunner.hasMachines()) {
        const outputs = this.machineRunner.evaluate(t, {
          variableResolver: this.variableResolver,
          pointerEvents: this.detectPointerEvents(),
        });
        if (this.machineEventCallback)
          for (const o of outputs) this.machineEventCallback(o);
      }

      this.resolveNode(this.sceneRoot, t, now, t);
    }
    this.render();
    // Momentary triggers (fire()) read `true` for exactly this frame; reset them
    // after the whole walk so both machine guards and node bindings saw them.
    if (live) this.variableResolver.endFrame();
    this.frameCallback?.(this.currentTime);
  }

  /**
   * Value-resolution pipeline for one node:
   * base -> bindings -> machine :state() merge -> animation -> interaction.
   * `machineTime` is the global timeline time (threaded unchanged) used to
   * anchor state animations; `t` is this node's inherited (scoped) time.
   */
  private resolveNode(
    node: SceneNode,
    t: number,
    now: number,
    machineTime: number,
  ): void {
    // Visibility window: a node outside [from, until) is hidden this frame, and
    // the render walk / hit-testing skip it and its subtree. Evaluated against
    // the INCOMING time `t` (this node's containing scope) — not the local time
    // below — because a layer's visibility lives in its parent comp's timeline,
    // while time-offset/time-scale only remap time for the node's own content.
    node.hidden = t < node.visibleFrom || t >= node.visibleUntil;

    // Per-subtree time scoping: shift then scale the inherited time into this
    // node's local timeline, which applies to the node and all descendants.
    // Nested scopes compose because the scoped time is what recurses down.
    // Defaults (0, 1) leave `t` unchanged. A time-remap curve, when present,
    // fully defines the local time (it subsumes offset/scale) by mapping the
    // inherited time through its monotonic stops — Lottie `tm` semantics.
    const local = node.timeRemap
      ? sampleTimeRemap(node.timeRemap, t)
      : (t - node.timeOffset) * node.timeScale;

    resetNodeToBase(node);
    this.applyBindings(node);
    // Machine :state() sets merge in here (static decls + entry-anchored state
    // animations), between bindings and the node's own animation sampling.
    if (node.stateStyles.length > 0) this.applyMachineStates(node, machineTime);
    // Base (node-level) animations: scrub to a 0..1 timeline reference when the
    // node declares animation-timeline, else sample on the clock at local time.
    if (node.animationTimeline && node.animations.length > 0) {
      sampleNodeAtProgress(
        node,
        clamp01(this.resolveTimelineProgress(node.animationTimeline)),
      );
    } else {
      this.scheduler.sampleNode(node, local);
    }
    this.interactionManager.applyOverrides(node, now);

    for (const child of node.children) {
      this.resolveNode(child, local, now, machineTime);
    }
  }

  /**
   * Merge every active `:state()` set on a node: apply its static declarations,
   * then sample its animations entry-anchored on the global machine clock
   * (`machineTime - entryTime`). Reuses the scheduler's clock sampling by
   * temporarily pointing node.animations at the state's instances — the
   * scheduler's documented `sampleNode(node, t - entryTime)` anchoring, with the
   * state's set as `node.animations`.
   */
  private applyMachineStates(node: SceneNode, machineTime: number): void {
    for (const entry of node.stateStyles) {
      if (!this.machineRunner.isStateActive(entry.machine, entry.name))
        continue;
      applyStateStyles(node, entry.styles);
      if (entry.animations.length > 0) {
        const entryTime = this.machineRunner.entryTimeFor(
          entry.machine,
          entry.name,
        );
        const saved = node.animations;
        node.animations = entry.animations;
        this.scheduler.sampleNode(node, machineTime - entryTime);
        node.animations = saved;
      }
    }
  }

  /**
   * Resolve an `animation-timeline` value source to a raw 0..1 progress.
   * `var(--x)` (and literals) go through the variable resolver; `input(path)`
   * uses its public per-path input reader (kept in sync via updateInputState).
   */
  private resolveTimelineProgress(value: Value): number {
    if (isFunctionValue(value) && value.name === "input") {
      const arg = value.args[0];
      if (arg && isKeywordValue(arg))
        return this.variableResolver.resolveInput(arg.value);
      return 0;
    }
    return this.variableResolver.resolveNumeric(value);
  }

  private applyBindings(node: SceneNode): void {
    for (const binding of node.bindings) {
      const handler = getPropHandler(binding.property);
      // Bindings resolve to numbers; skip anything without a numeric handler.
      if (!handler || handler.kind !== "number") continue;
      handler.apply(node, this.variableResolver.resolveNumeric(binding.value));
    }
  }

  /**
   * Detect this frame's pointer events for machine triggers, reusing the shared
   * hit-tester (invariant: no reimplemented hit-testing). Returns hover
   * enter/leave, down/up, and a synthetic click (down+up crediting the same top
   * node). The credited node is the nearest interactive ancestor — machine
   * pointer targets are flagged interactive at build time so they qualify. Edge
   * state is wall-clock/input driven and lives off the timeline.
   */
  private detectPointerEvents(): PointerTriggerEvent[] {
    const events: PointerTriggerEvent[] = [];
    if (!this.sceneRoot) return events;
    const st = this.inputTracker.getState();
    const hit = hitTest(this.sceneRoot, { x: st.cursor.x, y: st.cursor.y });

    if (hit !== this.prevHit) {
      if (this.prevHit) events.push({ event: "hoverend", node: this.prevHit });
      if (hit) events.push({ event: "hoverstart", node: hit });
    }

    const down = st.cursor.isDown;
    if (down && !this.prevIsDown) {
      events.push({ event: "pointerdown", node: hit });
      this.downHit = hit;
    }
    if (!down && this.prevIsDown) {
      events.push({ event: "pointerup", node: hit });
      if (hit && hit === this.downHit)
        events.push({ event: "click", node: hit });
      this.downHit = null;
    }

    this.prevHit = hit;
    this.prevIsDown = down;
    return events;
  }

  private render(): void {
    this.renderer.beginFrame();

    // beginFrame clears the whole device buffer at identity, so letterbox
    // margins stay clear; the viewport (fit + DPR) then becomes the root
    // transform for the background and scene, which draw in scene space.
    this.renderer.setTransform(this.viewport);

    // Draw background — fills the scene box (not the device buffer) so it
    // letterboxes with the scene under contain/none.
    if (this.backgroundColor) {
      this.renderer.setFill(this.backgroundColor);
      this.renderer.setFillGradient(null);
      this.renderer.setStroke(null, 0);
      this.renderer.setStrokeGradient(null);
      this.renderer.setTrim(null);
      const w = this.sceneWidth || this.renderer.getWidth();
      const h = this.sceneHeight || this.renderer.getHeight();
      this.renderer.drawRect(0, 0, w, h);
    }

    // Render scene graph
    if (this.sceneRoot) {
      this.renderNode(this.sceneRoot);
    }

    this.renderer.endFrame();
  }

  private renderNode(
    node: SceneNode,
    opts: RenderOpts = {},
    inheritedAlpha: number = 1,
    skipFilter: boolean = false,
  ): void {
    // `paintSource` and `skipMask` are set only on the TOP node of a composite
    // pass (renderMask) and must NOT propagate to descendants — a nested matte
    // still needs its source skipped and its own mask composited.
    const paintSource = opts.paintSource ?? false;
    const skipMask = opts.skipMask ?? false;

    // Outside its visibility window the node (and subtree) paints nothing.
    if (node.hidden) return;

    // A mask source is painted only via its dependent's composite; `paintSource`
    // is the composite pass telling it to paint the source (or the masked
    // content, which may itself be a source) rather than skip it.
    if (!paintSource && node.isMaskSource) return;

    // filter is the outermost visual wrapper: composite this node's subtree
    // offscreen and blit it back through ctx.filter (so it wraps the masked
    // result too). skipFilter guards the re-entry from renderFilter itself.
    if (!skipFilter && node.filter) {
      if (this.renderer.supportsFilter?.() && this.renderer.compositeFilter) {
        this.renderFilter(node, opts, inheritedAlpha);
        return;
      }
      // Renderer can't apply filters — warn once, then fall through to draw the
      // node unfiltered (preserving the normal transform discipline).
      if (!this.filterWarned) {
        this.filterWarned = true;
        console.warn(
          "[popcorn] filter: unsupported by this renderer; drawing unfiltered",
        );
      }
    }

    // A node with a mask is composited offscreen against its source. `skipMask`
    // is set only when re-entering the very node whose composite we are already
    // inside (avoids infinite recursion); a matte SOURCE that carries its own
    // mask is entered with skipMask=false so its mask composites correctly —
    // this is what stops a chained/nested matte source from painting whole.
    if (!skipMask && node.mask) {
      this.renderMask(node);
      return;
    }

    // Retained-backend bracket: opens this node's element before its own
    // save/transform and closes it after its subtree. Placed on the normal draw
    // path (past the filter/mask redirects), so a filtered/masked node is still
    // bracketed exactly once — inside the composite closure that re-enters here.
    this.renderer.beginNode?.(this.nodeKey(node));

    this.renderer.save();

    // Cascade opacity: a group's opacity should dim its children too, so we
    // carry the accumulated product down the walk rather than setting each
    // node's opacity in isolation.
    // NOTE: this multiplies alpha per-node rather than compositing the
    // group offscreen and fading it as one, so overlapping children in a
    // translucent group show through each other (wrong per CSS/Lottie
    // semantics) — upgrade path is an offscreen group composite.
    const alpha = inheritedAlpha * node.opacity;

    // Apply the node's local transform (translate/rotate/scale around transform-origin).
    // Multiplying onto the current (parent) transform yields the world transform.
    this.renderer.transform(computeLocalMatrix(node));

    // Fill rule is set before the clip so a multi-path (union) mask clips with
    // the intended winding, then reused by the shape fill below.
    this.renderer.setFillRule(node.fillRule);

    // Clip this node and its descendants (applied in local space, after the
    // transform, before drawing — the save/restore below brackets it).
    const clip = resolveClip(node);
    if (clip) this.renderer.clip(clip);

    // Set style
    this.renderer.setFill(node.fill);
    this.renderer.setFillGradient(node.fillGradient);
    this.renderer.setStroke(node.stroke, node.strokeWidth);
    this.renderer.setStrokeGradient(node.strokeGradient);
    this.renderer.setStrokeLineCap(node.strokeLineCap);
    this.renderer.setStrokeLineJoin(node.strokeLineJoin);
    this.renderer.setStrokeMiterLimit(node.strokeMiterLimit);
    this.renderer.setTrim(computeTrim(node));
    this.renderer.setDash(node.strokeDashArray, node.strokeDashOffset);
    this.renderer.setPaintOrder(node.paintOrder);
    this.renderer.setOpacity(alpha);

    // Draw shape
    switch (node.shapeData.type) {
      case "rect": {
        const r = node.shapeData as RectData;
        this.renderer.drawRect(r.x, r.y, r.width, r.height, r.rx, r.ry);
        break;
      }
      case "circle": {
        const c = node.shapeData as CircleData;
        this.renderer.drawCircle(c.cx, c.cy, c.r);
        break;
      }
      case "ellipse": {
        const e = node.shapeData as EllipseData;
        this.renderer.drawEllipse(e.cx, e.cy, e.rx, e.ry);
        break;
      }
      case "path": {
        const p = node.shapeData as PathData;
        this.renderer.drawPath(p.commands);
        break;
      }
      case "star":
      case "polygon":
        this.renderer.drawPath(polystarCommands(node));
        break;
      case "text": {
        const t = node.shapeData as TextData;
        this.renderer.drawText(
          t.content,
          t.x,
          t.y,
          t.fontSize,
          t.fontFamily,
          t.fontWeight,
          t.anchor,
        );
        break;
      }
      case "image": {
        const im = node.shapeData as ImageData;
        this.renderer.drawImage(im.src, im.x, im.y, im.width, im.height);
        break;
      }
      case "group":
        // Groups don't render themselves, just their children
        break;
    }

    // Render children in paint order (z-index ascending, document order ties).
    for (const child of childrenInPaintOrder(node)) {
      this.renderNode(child, undefined, alpha);
    }

    this.renderer.restore();
    this.renderer.endNode?.();
  }

  /** Stable retained-backend key for a node (monotonic, stamped on first sight). */
  private nodeKey(node: SceneNode): string {
    let key = this.nodeKeys.get(node);
    if (key === undefined) {
      key = "n" + this.nextNodeKey++;
      this.nodeKeys.set(node, key);
    }
    return key;
  }

  /**
   * Composite a node against its track-mask source. Both subtrees are rendered
   * in the canvas-root frame (each closure re-establishes its own world
   * transform), so alignment is exact regardless of where the source lives.
   */
  private renderMask(node: SceneNode): void {
    const source = node.mask!.source;
    // Fold the viewport into each subtree's world transform: the mask closures
    // call setTransform (bypassing the render-root viewport), so without this the
    // mask would render at 1:1 while the rest of the scene is fit-scaled.
    const contentParent = multiplyMatrices(
      this.viewport,
      computeWorldMatrixFromRoot(node.parent),
    );
    const maskParent = multiplyMatrices(
      this.viewport,
      computeWorldMatrixFromRoot(source.parent),
    );
    const contentAlpha = worldAlpha(node.parent);
    const maskAlpha = worldAlpha(source.parent);
    this.renderer.compositeMask(
      node.mask!.mode,
      // Content: paint it (even if it is itself a source), but skip its own mask
      // redirect — we ARE that composite. Source: paint it, but keep its own mask
      // (skipMask=false) so a chained matte composites instead of painting solid.
      () => {
        this.renderer.setTransform(contentParent);
        this.renderNode(
          node,
          { paintSource: true, skipMask: true },
          contentAlpha,
        );
      },
      () => {
        this.renderer.setTransform(maskParent);
        this.renderNode(source, { paintSource: true }, maskAlpha);
      },
    );
  }

  /**
   * Composite a node's subtree offscreen and blit it back through ctx.filter.
   * The content is rendered at its full world transform (viewport folded in, like
   * renderMask), so the offscreen holds device-space pixels; the filter is then
   * applied at the blit in device space. We therefore pre-scale the filter's
   * lengths (blur radius, shadow offset/blur) by the node's world scale, so a
   * scaled element's blur scales with it — matching CSS, and independent of
   * whether the platform ctx.filter honors the CTM (browsers diverge on that).
   * The re-entry passes skipFilter=true so it doesn't recurse on this same node
   * (its mask, if any, still composites inside the offscreen).
   */
  private renderFilter(
    node: SceneNode,
    opts: RenderOpts,
    inheritedAlpha: number,
  ): void {
    const parentWorld = multiplyMatrices(
      this.viewport,
      computeWorldMatrixFromRoot(node.parent),
    );
    const world = multiplyMatrices(
      this.viewport,
      computeWorldMatrixFromRoot(node),
    );
    // Device-space blit (Canvas): prescale by the full world scale. User-space
    // CSS filter (SVG): the wrapper sits at parentWorld, so the browser scales by
    // the parent's scale — hand it only the node's own (local) scale and the two
    // multiply back to the world scale, matching Canvas.
    const scale = this.renderer.filtersUseUserSpace?.()
      ? matrixScale(world) / (matrixScale(parentWorld) || 1)
      : matrixScale(world);
    const css = filterToCSS(node.filter!, scale);
    this.renderer.compositeFilter!(css, () => {
      this.renderer.setTransform(parentWorld);
      this.renderNode(node, opts, inheritedAlpha, true /* skipFilter */);
    });
  }
}

/** Uniform device-space scale of a 3×3 affine matrix (geometric mean of its
 * axis scales, √|det| — a single-value approximation for the elliptical case). */
function matrixScale(m: Matrix3x3): number {
  const det = m[0] * m[4] - m[1] * m[3];
  return Math.sqrt(Math.abs(det));
}

/** Build a CSS filter string from the ops, scaling every length to device px. */
function filterToCSS(ops: FilterOp[], scale: number): string {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.type === "blur") {
      parts.push(`blur(${op.radius * scale}px)`);
    } else {
      parts.push(
        `drop-shadow(${op.dx * scale}px ${op.dy * scale}px ${op.blur * scale}px ${op.color})`,
      );
    }
  }
  return parts.join(" ");
}

/**
 * Does any node in the tree keep the scene changing beyond a one-shot timeline —
 * an infinite (looping) animation, a var()/input() binding, an interactive
 * :hover/:active style, a state machine that could still transition, a
 * conditional `:state()` set, or an animation-timeline scrub binding? Scanned
 * once at setScene so `isStatic` stays O(1).
 */
function sceneHasDynamicContent(root: SceneNode): boolean {
  // Any machine (root only) keeps the loop live so it can still transition.
  if (root.machines.length > 0) return true;
  if (root.bindings.length > 0) return true;
  if (root.hoverStyles || root.activeStyles || root.interactive) return true;
  if (root.stateStyles.length > 0 || root.animationTimeline) return true;
  for (const a of root.animations)
    if (a.iterationCount === Infinity) return true;
  for (const child of root.children)
    if (sceneHasDynamicContent(child)) return true;
  return false;
}

/**
 * Does any node remap inherited time (a time-remap curve, or a non-default
 * time-offset/time-scale)? Such a subtree measures its animation end times in a
 * local timeline, so `computeSceneDuration` (which maxes those local ends) isn't
 * the scene's end on the root clock. Scanned once at setScene.
 */
function sceneHasTimeScoping(root: SceneNode): boolean {
  if (root.timeRemap || root.timeOffset !== 0 || root.timeScale !== 1)
    return true;
  for (const child of root.children)
    if (sceneHasTimeScoping(child)) return true;
  return false;
}

/**
 * Is this scene driven by a state machine — a `@machine` on the root, or any
 * `:state()` set on a node (which the parser allows even without a machine, in
 * which case it simply never activates)? Such a scene is unbounded: it has no
 * clip end to hold, wrap, or finish at. Scanned once at setScene.
 */
function sceneIsUnbounded(root: SceneNode): boolean {
  if (root.machines.length > 0) return true;
  return subtreeHasStateStyles(root);
}

function subtreeHasStateStyles(node: SceneNode): boolean {
  if (node.stateStyles.length > 0) return true;
  for (const child of node.children)
    if (subtreeHasStateStyles(child)) return true;
  return false;
}

/** Accumulated (multiplied) opacity of a node's ancestor chain, root down to `node` inclusive. */
function worldAlpha(node: SceneNode | null): number {
  let alpha = 1;
  for (let n: SceneNode | null = node; n; n = n.parent) alpha *= n.opacity;
  return alpha;
}

/**
 * Fold a timeline time into [0, duration) for looping. A no-op when looping is
 * off, the scene has no duration, or `t` is still within the first pass.
 */
export function wrapTime(t: number, duration: number, loop: boolean): number {
  if (loop && duration > 0 && t >= duration) return t % duration;
  return t;
}

/**
 * Evaluate a time-remap curve: map the inherited time `t` (ms) to a local time
 * (ms). A pure function of `t` (invariant 4), mirroring keyframe sampling —
 * bracket by input, ease the local fraction with the departing stop's easing,
 * lerp the outputs. Outside the domain the endpoints hold. `stops` must be
 * sorted by input (the builder guarantees this).
 */
export function sampleTimeRemap(stops: TimeRemapStop[], t: number): number {
  const n = stops.length;
  if (n === 0) return t;
  if (t <= stops[0].input) return stops[0].output;
  if (t >= stops[n - 1].input) return stops[n - 1].output;
  for (let i = 0; i < n - 1; i++) {
    const a = stops[i],
      b = stops[i + 1];
    if (t >= a.input && t <= b.input) {
      const range = b.input - a.input;
      let f = range > 0 ? (t - a.input) / range : 0;
      if (a.easing === "step-end") f = 0;
      else if (a.easing) f = applyEasing(f, a.easing);
      return a.output + (b.output - a.output) * f;
    }
  }
  return stops[n - 1].output;
}

/**
 * Resolve a node's trim-* fractions into a stroke dash descriptor, or null when
 * the whole outline is stroked (the common, untrimmed case). Inputs are clamped
 * to [0,1]; start >= end yields an empty (invisible) stroke. The dash pattern
 * [visible, hidden] plus a negative dashOffset naturally handles wrap-around for
 * closed shapes (marching via trim-offset).
 */
export function computeTrim(node: SceneNode): TrimDescriptor | null {
  const start = clamp01(node.trimStart);
  const end = clamp01(node.trimEnd);
  const offset = clamp01(node.trimOffset);

  // Untrimmed: stroke the whole outline, no dashing needed.
  if (start <= 0 && end >= 1 && offset === 0) return null;

  const total = outlineLength(node);
  if (total <= 0) return null;

  // Empty window -> nothing to stroke.
  if (end <= start) return { visible: false, dashArray: [], dashOffset: 0 };

  // Full window (offset has no visible effect when everything is drawn).
  if (start <= 0 && end >= 1)
    return { visible: true, dashArray: [], dashOffset: 0 };

  const visible = (end - start) * total;
  const startPos = start + offset;

  // A window anchored at the path start (offset 0, start 0) never wraps the seam,
  // so pad its trailing gap out to a full `total`. This keeps Canvas's dash
  // traversal — which measures a marginally *longer* arc than our sampled
  // outlineLength — from repeating the pattern and painting a round-cap sliver
  // (a stray dot) at the path's end. The marching case below keeps the exact
  // [visible, hidden] period so its window can still wrap a closed shape's seam.
  if (startPos <= 0) {
    return { visible: true, dashArray: [visible, total], dashOffset: 0 };
  }

  return {
    visible: true,
    dashArray: [visible, total - visible],
    dashOffset: -startPos * total,
  };
}
