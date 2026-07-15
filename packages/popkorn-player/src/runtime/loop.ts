import { isFunctionValue, isKeywordValue, type Value } from "@popkorn/parser";
import { applyEasing, holdsAtStart } from "../animation/easing";
import { getPropHandler } from "../animation/registry";
import {
  AnimationScheduler,
  computeSceneDuration,
  sampleNodeAtProgress,
} from "../animation/scheduler";
import type { Renderer } from "../renderer/interface";
import type { Matrix3x3, TrimDescriptor } from "../renderer/types";
import { IDENTITY_MATRIX, multiplyMatrices } from "../renderer/types";
import {
  insetShadowCommands,
  outerShadowCommands,
  shapeClip,
} from "../scene/box-shadow";
import { extractIndividualTransform, extractTransform } from "../scene/builder";
import { resolveClip } from "../scene/clip";
import { colorStringFromValue } from "../scene/color";
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
import { hitTest, hitTestClick } from "./hit-test";
import { createInputTracker, type InputTracker } from "./inputs";
import {
  applyStateStyles,
  blendProp,
  createInteractionManager,
  type InteractionManager,
  involvedStateKeys,
  readLiveProp,
  writeProp,
} from "./interaction";
import {
  createStateMachineRunner,
  type MachineOutput,
  type PointerTriggerEvent,
  type StateBlend,
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

/** Detail of a `popkorn:click` — the hit node's id, its ancestor id path (root
 *  → node), and the click point in scene coordinates. */
export interface ClickDetail {
  id: string;
  path: string[];
  x: number;
  y: number;
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
  // Full-tree click resolution (crediting the nearest interactive ancestor) at
  // the last pointerdown edge — matched against the release edge to synthesize a
  // `popkorn:click`. Runs on edges only, never per-frame.
  private downClick: ReturnType<typeof hitTestClick> = null;
  // Forwarded to the host (component) as a `popkorn:click` DOM event on a click
  // edge (press+release on the same node). Fires for machine-less scenes too.
  private clickCallback: ((detail: ClickDetail) => void) | null = null;
  // Fit-to-container: root transform (scene -> device px) applied each frame, plus
  // the scene box size the background fills. Default identity = 1:1, no fit.
  private viewport: Matrix3x3 = IDENTITY_MATRIX;
  // One-time guard: a node has a `filter` but the renderer can't apply it (old
  // Safari, or a backend without a filter concept). Warned once, then unfiltered.
  private filterWarned: boolean = false;
  private sceneWidth: number = 0;
  private sceneHeight: number = 0;
  // Artboard clipping: crop content to the scene box (AE-comp / Lottie default).
  // `hidden` unless `:root { overflow: visible }` turns it off. Only actually
  // clips when the scene is dimensioned (width+height > 0) — see `shouldClip`.
  private clipToScene: boolean = true;
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
  // Cached at setScene: is this scene not a finite clip? True for a state machine
  // (or any `:state()` set, authorable without a machine) — machine state lives
  // off the timeline — AND for a scene of only-infinite animations, which has no
  // honest end either. Such a scene's clock free-runs monotonically; `sceneDuration`
  // (a max of BASE animation ends) is not a bound, and wrapping it would fold the
  // clock back — replaying a later state's entry, or snapping every infinite
  // animation to phase 0 in lockstep. See `sceneIsPerpetual`.
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

  /** The current scene root (null before a scene is set). Read-only access. */
  getScene(): SceneNode | null {
    return this.sceneRoot;
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
    this.downClick = null;
    this.sceneDuration = computeSceneDuration(root);
    this.hasCompleted = false;
    this.sceneDynamic = sceneHasDynamicContent(root);
    this.sceneTimeScoped = sceneHasTimeScoping(root);
    // A scene of only-infinite animations free-runs like a state-machine scene:
    // no honest end to wrap or clamp at. Excluded when time-scoped — a time-remap
    // curve holds at its endpoints under a non-wrapping clock and needs the wrap.
    this.sceneUnbounded =
      sceneIsUnbounded(root) ||
      (!this.sceneTimeScoped && sceneIsPerpetual(root));
  }

  /** The scene's state-machine runner (host events, tests). */
  getStateMachineRunner(): StateMachineRunner {
    return this.machineRunner;
  }

  /** Register a callback for machine transitions/emits (component wiring). */
  setMachineEventCallback(cb: ((output: MachineOutput) => void) | null): void {
    this.machineEventCallback = cb;
  }

  /** Register a callback fired on a click edge with the hit node's id/path/point. */
  setClickCallback(cb: ((detail: ClickDetail) => void) | null): void {
    this.clickCallback = cb;
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

  /** Artboard clipping: `true` (default) crops content to the scene box; `false`
   *  (`:root { overflow: visible }`) lets it spill past the edge. */
  setClip(enabled: boolean): void {
    this.clipToScene = enabled;
  }

  /** Whether this frame actually clips: clipping on AND the scene is dimensioned.
   *  Unbounded/undimensioned scenes never clip (there's no artboard to clip to). */
  private shouldClip(): boolean {
    return this.clipToScene && this.sceneWidth > 0 && this.sceneHeight > 0;
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
    this.interactionManager.update(
      this.inputTracker.getState(),
      timestamp,
      this.shouldClip()
        ? { width: this.sceneWidth, height: this.sceneHeight }
        : null,
    );

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
      // Pointer edges drive machine triggers AND the `popkorn:click` DOM event.
      // detectPointerEvents runs every live frame (not just for machine scenes)
      // so clicks resolve with no opt-in; it only runs the expensive full-tree
      // click hit-test on press/release edges. Machine evaluation consumes its
      // (interactive-only) hover/pointer events, and is skipped when there are
      // no machines.
      if (live) {
        const events = this.detectPointerEvents();
        if (this.machineRunner.hasMachines()) {
          const outputs = this.machineRunner.evaluate(t, {
            variableResolver: this.variableResolver,
            pointerEvents: events,
          });
          if (this.machineEventCallback)
            for (const o of outputs) this.machineEventCallback(o);
        }
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
   * Merge every active `:state()` set on a node. Steady state (no `mix` in
   * flight) is a straight apply of each active entry — static declarations plus
   * entry-anchored animations. During a `mix` cross-fade window the outgoing and
   * incoming states are each fully resolved into the node in turn, then blended
   * channel-by-channel at the mix's eased progress (invariant #2: this all
   * happens inside the state-override step, between bindings and the node's own
   * animation sampling).
   */
  private applyMachineStates(node: SceneNode, machineTime: number): void {
    // Contribution of each active :state() entry, in document order.
    const active: {
      entry: SceneNode["stateStyles"][number];
      blend: StateBlend;
    }[] = [];
    let mixing = false;
    for (const entry of node.stateStyles) {
      const blend = this.machineRunner.stateBlend(
        entry.machine,
        entry.name,
        machineTime,
      );
      if (!blend) continue;
      if (blend.side !== "solid") mixing = true;
      active.push({ entry, blend });
    }
    if (active.length === 0) return;

    // Fast path: no cross-fade — apply every active state directly (also the
    // hard-cut path when a transition carried no `mix`).
    if (!mixing) {
      for (const { entry, blend } of active)
        this.applyStateEntry(node, entry, blend.entryTime, machineTime);
      return;
    }

    // Cross-fade. Solid contributions (other machines' steady states) apply
    // first and form the baseline both mix ends share.
    for (const { entry, blend } of active)
      if (blend.side === "solid")
        this.applyStateEntry(node, entry, blend.entryTime, machineTime);

    const keys = new Set<string>();
    for (const { entry, blend } of active)
      if (blend.side !== "solid") involvedStateKeys(entry, keys);

    // Baseline (post-bindings + solid states) each mix end starts from.
    const baseline = new Map<string, ReturnType<typeof readLiveProp>>();
    for (const key of keys) baseline.set(key, readLiveProp(node, key));

    // Outgoing end: apply the fading-out states, snapshot the result.
    for (const { entry, blend } of active)
      if (blend.side === "out")
        this.applyStateEntry(node, entry, blend.entryTime, machineTime);
    const from = new Map<string, ReturnType<typeof readLiveProp>>();
    for (const key of keys) from.set(key, readLiveProp(node, key));

    // Reset the involved channels to baseline, then apply the incoming end.
    for (const key of keys) writeProp(node, key, baseline.get(key) ?? null);
    for (const { entry, blend } of active)
      if (blend.side === "in")
        this.applyStateEntry(node, entry, blend.entryTime, machineTime);

    // Eased blend weight: the incoming ("in") weight is the mix progress; with
    // no incoming entry on this node it's 1 minus the outgoing weight.
    const inSide = active.find((a) => a.blend.side === "in");
    const outSide = active.find((a) => a.blend.side === "out");
    // NOTE: concurrent mixes on the same node (multiple machines) share this one
    // progress; rare enough to not warrant per-machine channel partitioning.
    const e = inSide
      ? inSide.blend.weight
      : outSide
        ? 1 - outSide.blend.weight
        : 1;

    // Blend each involved channel from the outgoing snapshot toward the incoming
    // (now-live) value. Incompatible gradients/paths step at the eased midpoint
    // (blendProp), matching the incompatible-gradient stepping precedent.
    for (const key of keys) {
      const handler = getPropHandler(key);
      if (!handler) continue;
      writeProp(
        node,
        key,
        blendProp(handler, from.get(key) ?? null, readLiveProp(node, key), e),
      );
    }
  }

  /**
   * Apply one `:state()` entry onto a node: its static declarations, then its
   * animations entry-anchored on the global machine clock (`machineTime -
   * entryTime`). Reuses the scheduler's documented `sampleNode(node, t -
   * entryTime)` anchoring by temporarily pointing `node.animations` at the
   * state's instances.
   */
  private applyStateEntry(
    node: SceneNode,
    entry: SceneNode["stateStyles"][number],
    entryTime: number,
    machineTime: number,
  ): void {
    applyStateStyles(node, entry.styles);
    if (entry.animations.length > 0) {
      const saved = node.animations;
      node.animations = entry.animations;
      this.scheduler.sampleNode(node, machineTime - entryTime);
      node.animations = saved;
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
    const resolve = (v: Value) => this.variableResolver.resolveNumeric(v);
    for (const binding of node.bindings) {
      // Transform channels aren't scalar-registry properties: re-extract the
      // whole transform value each frame, resolving var()/input() operands
      // through the live resolver (the reactive-transform binding path).
      if (binding.property === "transform") {
        extractTransform(
          binding.value,
          (key, val) => {
            node.transform[key] = val;
          },
          resolve,
        );
        continue;
      }
      if (
        binding.property === "translate" ||
        binding.property === "rotate" ||
        binding.property === "scale"
      ) {
        extractIndividualTransform(
          binding.property,
          binding.value,
          (key, val) => {
            node.transform[key] = val;
          },
          resolve,
        );
        continue;
      }
      // Paint channels carry colors, not numbers: resolve the bound var() to a
      // color string through the same live resolver and swap the solid paint.
      // (A gradient var() is out of scope — colors only. `none` clears paint.) A
      // non-color value (e.g. a string var in a paint slot) degrades to ignore.
      if (binding.property === "fill" || binding.property === "stroke") {
        const resolved = this.variableResolver.resolveValue(binding.value);
        const color = colorStringFromValue(resolved);
        if (color !== null) {
          if (binding.property === "fill") node.fill = color;
          else node.stroke = color;
        } else if (isKeywordValue(resolved) && resolved.value === "none") {
          if (binding.property === "fill") node.fill = null;
          else node.stroke = null;
        }
        continue;
      }
      // String/keyword properties (content, font-family, fill-rule, …): re-apply
      // the resolved, var-free value through the builder switch. Discrete — no
      // interpolation. A numeric var here degrades however that property parses.
      if (binding.applyString) {
        binding.applyString(
          node,
          this.variableResolver.resolveValue(binding.value),
        );
        continue;
      }
      const handler = getPropHandler(binding.property);
      // Remaining bindings resolve to numbers; skip anything without a numeric
      // handler (a mistyped var in a numeric slot resolves to 0 — see
      // resolveNumeric — which is the documented graceful-degradation path).
      if (!handler || handler.kind !== "number") continue;
      handler.apply(node, resolve(binding.value));
    }
  }

  /**
   * Detect this frame's pointer edges. Runs every LIVE frame (regardless of
   * machines) so the `popkorn:click` DOM event resolves with no opt-in, but the
   * expensive full-tree click hit-test only runs on press/release edges.
   *
   * Two hit-testers, kept distinct on purpose (invariant: no reimplemented
   * hit-testing):
   * - Machine triggers use the per-frame INTERACTIVE-only {@link hitTest} (only
   *   built when there are machines to feed) and its credited nearest-interactive
   *   node — machine pointer targets are flagged interactive at build time.
   * - `popkorn:click` uses the FULL-TREE {@link hitTestClick}, resolving the
   *   topmost shape and crediting the nearest interactive ancestor; run on edges
   *   only.
   *
   * Returns the machine trigger events (empty when there are no machines). Edge
   * state is wall-clock/input driven and lives off the timeline.
   */
  private detectPointerEvents(): PointerTriggerEvent[] {
    const events: PointerTriggerEvent[] = [];
    if (!this.sceneRoot) return events;
    const st = this.inputTracker.getState();
    const point = { x: st.cursor.x, y: st.cursor.y };
    // A clipped-out pointer can't hit content the artboard hides.
    const clippedOut = this.clippedOut(point.x, point.y);
    const hasMachines = this.machineRunner.hasMachines();

    // Interactive-only hover hit — only feeds machine hover/pointer triggers, so
    // it's skipped entirely for machine-less scenes (the :hover path itself
    // lives in InteractionManager and runs regardless).
    const hit =
      hasMachines && !clippedOut ? hitTest(this.sceneRoot, point) : null;
    if (hasMachines && hit !== this.prevHit) {
      if (this.prevHit) events.push({ event: "hoverend", node: this.prevHit });
      if (hit) events.push({ event: "hoverstart", node: hit });
    }

    const down = st.cursor.isDown;
    // `pressed` latches a press that happened since the last frame even if the
    // release already flipped `isDown` back to false — so a quick tap whose
    // down+up both land between two frames still produces a rising edge (and a
    // matching falling edge + click). Consumed here, once per frame.
    const pressed = st.cursor.pressed;
    st.cursor.pressed = false;
    const downEdge = (down || pressed) && !this.prevIsDown;
    const upEdge = !down && (this.prevIsDown || pressed);

    if (downEdge) {
      if (hasMachines) {
        events.push({ event: "pointerdown", node: hit });
        this.downHit = hit;
      }
      // Full-tree click resolution (edge only): topmost shape, credited to its
      // nearest interactive ancestor.
      this.downClick = clippedOut ? null : hitTestClick(this.sceneRoot, point);
    }
    if (upEdge) {
      if (hasMachines) {
        events.push({ event: "pointerup", node: hit });
        if (hit && hit === this.downHit)
          events.push({ event: "click", node: hit });
        this.downHit = null;
      }
      // Click edge: press and release resolved to the same credited node.
      const up = clippedOut ? null : hitTestClick(this.sceneRoot, point);
      if (up && this.downClick && up.node === this.downClick.node) {
        this.clickCallback?.({
          id: up.node.id,
          path: up.path,
          x: point.x,
          y: point.y,
        });
      }
      this.downClick = null;
    }

    if (hasMachines) this.prevHit = hit;
    this.prevIsDown = down;
    return events;
  }

  /** True when clipping is on and (x, y) scene coords fall outside the artboard,
   *  so a pointer there hits nothing (matches the visual crop). */
  private clippedOut(x: number, y: number): boolean {
    return (
      this.shouldClip() &&
      (x < 0 || y < 0 || x > this.sceneWidth || y > this.sceneHeight)
    );
  }

  private render(): void {
    this.renderer.beginFrame();

    // beginFrame clears the whole device buffer at identity, so letterbox
    // margins stay clear; the viewport (fit + DPR) then becomes the root
    // transform for the background and scene, which draw in scene space.
    this.renderer.setTransform(this.viewport);

    // Artboard clipping: crop the background + scene walk to the scene box, so
    // content never spills into the letterbox bands or past the stage (AE-comp /
    // Lottie default). Applied in scene space (post-viewport). Undimensioned or
    // `overflow: visible` scenes skip the clip. This lives ONLY in the shared
    // walk — backends just realize the `clip()` primitive (invariant 7).
    const clipping = this.shouldClip();
    if (clipping) {
      this.renderer.save();
      this.renderer.clip({
        type: "rect",
        x: 0,
        y: 0,
        width: this.sceneWidth,
        height: this.sceneHeight,
      });
    }

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

    if (clipping) this.renderer.restore();

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
    // Outer, no-spread box-shadows ride the SAME CSS drop-shadow filter path
    // (nearly free); spread/inset shadows draw geometrically in the normal walk.
    const filterOps = skipFilter ? null : effectiveFilterOps(node);
    if (filterOps) {
      if (this.renderer.supportsFilter?.() && this.renderer.compositeFilter) {
        this.renderFilter(node, opts, inheritedAlpha, filterOps);
        return;
      }
      // Renderer can't apply filters — warn once, then fall through to draw the
      // node unfiltered (preserving the normal transform discipline).
      if (!this.filterWarned) {
        this.filterWarned = true;
        console.warn(
          "[popkorn] filter: unsupported by this renderer; drawing unfiltered",
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

    // Outer geometric box-shadows (spread on a rect/circle/ellipse) paint behind
    // the shape — before its own paint state is set, so they can't disturb it.
    if (node.boxShadow) this.drawBoxShadows(node, alpha, false);

    // mix-blend-mode: composite this node's shape against the backdrop. Bracketed
    // tight around the shape (reset to 'normal' after) — simple per-shape blend,
    // no group isolation (see BlendMode NOTE).
    const blend = node.mixBlendMode;
    if (blend !== "normal") this.renderer.setBlendMode(blend);

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
        this.renderer.drawRect(
          r.x,
          r.y,
          r.width,
          r.height,
          r.rx,
          r.ry,
          r.cornerRadii,
        );
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
        // Multi-line: `\n` splits lines, stacked by line-height (auto = 1.2·em).
        // The decision lives here so backends stay single-line primitives.
        const lines = t.content.split("\n");
        const lh = t.lineHeight > 0 ? t.lineHeight : t.fontSize * 1.2;
        for (let i = 0; i < lines.length; i++) {
          this.renderer.drawText(
            lines[i],
            t.x,
            t.y + i * lh,
            t.fontSize,
            t.fontFamily,
            t.fontWeight,
            t.anchor,
            t.letterSpacing,
          );
        }
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

    // End the blend bracket before inset shadows / children so it doesn't leak.
    if (blend !== "normal") this.renderer.setBlendMode("normal");

    // Inset box-shadows paint on top of the shape, clipped to it (rim of colour).
    if (node.boxShadow) this.drawBoxShadows(node, alpha, true);

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
    ops: FilterOp[],
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
    if (!this.renderer.compositeFilter) return;
    const css = filterToCSS(ops, scale);
    this.renderer.compositeFilter(css, () => {
      this.renderer.setTransform(parentWorld);
      this.renderNode(node, opts, inheritedAlpha, true /* skipFilter */);
    });
  }

  /**
   * Draw the geometric box-shadows (spread outer, or inset) for one node, in the
   * `inset` phase requested. Each shadow is an inflated (outer) or punched-out
   * (inset, evenodd + clip) shape filled with the shadow colour and blurred via
   * the same compositeFilter path `filter` uses — so a backend without filters
   * (Skia) draws them sharp, consistent with its pinned no-filter divergence.
   * The shadow paint is set inside its own bracket; the sticky fill it leaves is
   * reset by the node's own setFill (outer runs before it) or by each child.
   */
  private drawBoxShadows(node: SceneNode, alpha: number, inset: boolean): void {
    if (!node.boxShadow) return;
    const shadows = node.boxShadow.filter(
      (s): s is Extract<FilterOp, { type: "drop-shadow" }> =>
        s.type === "drop-shadow" &&
        isGeometricShadow(node, s) &&
        (s.inset ?? false) === inset,
    );
    if (shadows.length === 0) return;
    const world = multiplyMatrices(
      this.viewport,
      computeWorldMatrixFromRoot(node),
    );
    const scale = matrixScale(world);
    const clip = inset ? shapeClip(node.shapeData) : null;
    // CSS paints the first-listed shadow on top; draw back-to-front.
    for (let i = shadows.length - 1; i >= 0; i--) {
      const s = shadows[i];
      const spread = s.spread ?? 0;
      const commands = inset
        ? insetShadowCommands(node.shapeData, s.dx, s.dy, spread)
        : outerShadowCommands(node.shapeData, s.dx, s.dy, spread);
      if (!commands) continue;
      const draw = () => {
        this.renderer.setTransform(world);
        this.renderer.save();
        this.renderer.setFill(s.color);
        this.renderer.setFillGradient(null);
        this.renderer.setStroke(null, 0);
        this.renderer.setStrokeGradient(null);
        this.renderer.setFillRule(inset ? "evenodd" : "nonzero");
        this.renderer.setOpacity(alpha);
        if (inset && clip) this.renderer.clip(clip);
        this.renderer.drawPath(commands);
        this.renderer.restore();
      };
      const blur = s.blur * scale;
      if (
        blur > 0 &&
        this.renderer.supportsFilter?.() &&
        this.renderer.compositeFilter
      ) {
        this.renderer.compositeFilter(`blur(${blur}px)`, draw);
      } else {
        this.renderer.save();
        draw();
        this.renderer.restore();
      }
    }
  }
}

/** Uniform device-space scale of a 3×3 affine matrix (geometric mean of its
 * axis scales, √|det| — a single-value approximation for the elliptical case). */
function matrixScale(m: Matrix3x3): number {
  const det = m[0] * m[4] - m[1] * m[3];
  return Math.sqrt(Math.abs(det));
}

// A box-shadow that must draw as a geometric shape rather than ride the CSS
// drop-shadow filter. Inset shadows always draw geometrically (clip to the shape
// + punched inverse) for any shape with an outline; outer shadows only when they
// carry spread AND the shape can be inflated exactly (rect/circle/ellipse).
// Everything else (outer/no-spread, outer-spread on a path) rides the filter.
function isGeometricShadow(node: SceneNode, s: FilterOp): boolean {
  if (s.type !== "drop-shadow") return false;
  const t = node.shapeData.type;
  const hasOutline =
    t === "rect" ||
    t === "circle" ||
    t === "ellipse" ||
    t === "path" ||
    t === "star" ||
    t === "polygon";
  const inflatable = t === "rect" || t === "circle" || t === "ellipse";
  if (s.inset ?? false) return hasOutline;
  return inflatable && (s.spread ?? 0) !== 0;
}

// The filter ops the CSS drop-shadow path renders for a node: its authored
// `filter` plus every box-shadow NOT handled geometrically. Inset shadows on a
// non-inflatable shape are unsupported and dropped (NOTE). Null when empty.
function effectiveFilterOps(node: SceneNode): FilterOp[] | null {
  const authored = node.filter ?? [];
  const shadows: FilterOp[] = [];
  if (node.boxShadow) {
    for (const s of node.boxShadow) {
      if (s.type !== "drop-shadow" || isGeometricShadow(node, s)) continue;
      if (s.inset) continue; // inset needs a clip we only do for inflatable shapes
      shadows.push(s);
    }
  }
  const ops = [...authored, ...shadows];
  return ops.length > 0 ? ops : null;
}

/** Build a CSS filter string from the ops, scaling every length to device px. */
function filterToCSS(ops: FilterOp[], scale: number): string {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.type === "blur") {
      parts.push(`blur(${op.radius * scale}px)`);
    } else if (op.type === "drop-shadow") {
      parts.push(
        `drop-shadow(${op.dx * scale}px ${op.dy * scale}px ${op.blur * scale}px ${op.color})`,
      );
    } else if (op.type === "hue-rotate") {
      // Scale-free (angle, not a length).
      parts.push(`hue-rotate(${op.amount}deg)`);
    } else {
      // Color-adjust functions: a scale-free plain-number multiplier.
      parts.push(`${op.type}(${op.amount})`);
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

/**
 * Is this scene nothing but perpetual animation — at least one animation, EVERY
 * animation in the tree `infinite`, and no node carrying a visibility window?
 * Such a scene has no honest end: `computeSceneDuration` counts each infinite
 * animation as ONE iteration, yielding an arbitrary finite period whose wrap
 * would snap every animation back to phase 0 in lockstep (a visible jump). Like
 * a state-machine scene it opts into a free-running clock (see `sceneUnbounded`)
 * so the animations cycle independently forever, as CSS `infinite` animations
 * do in a browser. A `visible-from`/`visible-until` window bars it: under a
 * monotonic clock that window would open once and never come round again.
 * (Callers additionally require the scene NOT be time-scoped — a time-remap
 * curve holds at its endpoints under a non-wrapping clock, so it needs the wrap.)
 */
export function sceneIsPerpetual(root: SceneNode): boolean {
  let sawAnimation = false;
  const visit = (node: SceneNode): boolean => {
    if (node.visibleFrom !== -Infinity || node.visibleUntil !== Infinity)
      return false;
    for (const a of node.animations) {
      if (a.iterationCount !== Infinity) return false;
      sawAnimation = true;
    }
    for (const child of node.children) if (!visit(child)) return false;
    return true;
  };
  return visit(root) && sawAnimation;
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
      if (holdsAtStart(a.easing)) f = 0;
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
