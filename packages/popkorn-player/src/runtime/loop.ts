import {
  isFunctionValue,
  isKeywordValue,
  type Value,
  type VariableDefinition,
} from "@popkorn/parser";
import { applyEasing, holdsAtStart } from "../animation/easing.js";
import { getPropHandler, type PropValue } from "../animation/registry.js";
import {
  AnimationScheduler,
  computeSceneDuration,
  sampleNodeAtProgress,
} from "../animation/scheduler.js";
import type { Renderer } from "../renderer/interface.js";
import type { TrimDescriptor } from "../renderer/types.js";
import type { DeviceRect } from "../scene/bounds.js";
import { maskDeviceBounds, subtreeDeviceBounds } from "../scene/bounds.js";
import {
  insetShadowCommands,
  shapeClip,
  shapeOutline,
} from "../scene/box-shadow.js";
import {
  extractImageViewBox,
  extractIndividualTransform,
  extractTransform,
} from "../scene/builder.js";
import { resolveClip } from "../scene/clip.js";
import { colorStringFromValue } from "../scene/color.js";
import type { Matrix3x3 } from "../scene/matrix.js";
import { IDENTITY_MATRIX, multiplyMatrices } from "../scene/matrix.js";
import { outlineLength } from "../scene/path-parser.js";
import { polystarCommands } from "../scene/polystar.js";
import {
  clamp01,
  computeLocalMatrix,
  computeWorldMatrixFromRoot,
  matrixScale,
} from "../scene/transform.js";
import type {
  ColorFilterFn,
  FilterOp,
  NodeStateStyle,
  SceneNode,
  TimeRemapStop,
} from "../scene/types.js";
import {
  childrenInPaintOrder,
  refreshSortedChildren,
  resetNodeToBase,
} from "../scene/types.js";
import { forEachNode, someNode } from "../scene/walk.js";
import { subtreeToken } from "./content-hash.js";
import { hitTest, hitTestClick } from "./hit-test.js";
import { InputTracker, inputPathOf } from "./inputs.js";
import {
  applyStateStyles,
  blendProp,
  InteractionManager,
  involvedStateKeys,
  readLiveProp,
  writeProp,
} from "./interaction.js";
import {
  type MachineOutput,
  type PointerTriggerEvent,
  type StateBlend,
  StateMachineRunner,
} from "./state-machine.js";
import { VariableResolver } from "./variables.js";

/** Flags for the TOP node of a mask composite pass only; never propagated, so nested mattes resolve independently. */
interface RenderOpts {
  /** Paint this node even though it is `isMaskSource`. */
  paintSource?: boolean;
  /** Skip this node's own `mask` redirect (already inside its composite). */
  skipMask?: boolean;
}

/** A filtered node's per-frame composite plan, keyed by the transform/flags it was derived under. */
interface FilterPlan {
  key: string;
  css: string | null;
  region: DeviceRect | null;
}

/** `popkorn:click` detail: hit node id, root→node id path, and scene-space point. */
export interface ClickDetail {
  id: string;
  path: string[];
  x: number;
  y: number;
}

/** rAF loop; per node per frame: base → bindings → animation → :hover/:active (fixed order). */
export class RenderLoop {
  private renderer: Renderer;
  private sceneRoot: SceneNode | null = null;
  private scheduler: AnimationScheduler;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private backgroundColor: string | null = null;
  private inputTracker = new InputTracker();
  private variableResolver = new VariableResolver();
  private interactionManager = new InteractionManager();
  // Evaluated once per live frame before the walk; its state is off the timeline, so seek() never touches it.
  private machineRunner = new StateMachineRunner();
  private machineEventCallback: ((output: MachineOutput) => void) | null = null;
  // Pointer-edge state for machine triggers (input-driven, off the timeline).
  private prevIsDown: boolean = false;
  private prevHit: SceneNode | null = null;
  private downHit: SceneNode | null = null;
  // Click target at the last pointerdown edge, matched on release to synthesize `popkorn:click`.
  private downClick: ReturnType<typeof hitTestClick> = null;
  private clickCallback: ((detail: ClickDetail) => void) | null = null;
  // Root transform (scene → device px); identity = no fit.
  private viewport: Matrix3x3 = IDENTITY_MATRIX;
  // Warn once when a `filter` can't be applied by the renderer; then draw unfiltered.
  private filterWarned: boolean = false;
  private sceneWidth: number = 0;
  private sceneHeight: number = 0;
  // Crop to the scene box unless `:root { overflow: visible }`; see `shouldClip`.
  private clipToScene: boolean = true;
  private looping: boolean = false;
  private sceneDuration: number = 0;
  // Infinite animation, bindings or hover/active present; drives `isStatic`.
  private sceneDynamic: boolean = false;
  // Some subtree remaps time, so `sceneDuration` (local-time ends) isn't a root-timeline bound.
  private sceneTimeScoped: boolean = false;
  // No finite end (machine/`:state()` or only-infinite animations): clock free-runs, never wraps/clamps.
  private sceneUnbounded: boolean = false;
  private frameCallback: ((time: number) => void) | null = null;
  // Latched once per pass; cleared when the clock drops back inside the clip.
  private completeCallback: (() => void) | null = null;
  private hasCompleted: boolean = false;
  // Stable beginNode/endNode keys; node.id isn't unique (classes, symbol expansion).
  private nodeKeys = new WeakMap<SceneNode, string>();
  private nextNodeKey = 0;
  // Per-frame memo (masks walk subtrees twice); cleared every frame, never caches across time.
  private filterPlans = new Map<SceneNode, FilterPlan>();
  // Per-frame memo of composite subtree content tokens; same lifetime as `filterPlans`.
  private contentTokens = new Map<SceneNode, string | null>();

  constructor(renderer: Renderer, scheduler = new AnimationScheduler()) {
    this.renderer = renderer;
    this.scheduler = scheduler;
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

  getScene(): SceneNode | null {
    return this.sceneRoot;
  }

  setScene(root: SceneNode): void {
    this.sceneRoot = root;
    this.nodeKeys = new WeakMap();
    this.nextNodeKey = 0;
    this.interactionManager.setScene(root);
    this.machineRunner.setScene(root, 0);
    this.prevIsDown = false;
    this.prevHit = null;
    this.downHit = null;
    this.downClick = null;
    // Batch same-structure calc() bindings (repeat clones); pure optimization of the bindings step.
    this.variableResolver.planCalcBatches(collectBindingValues(root));
    this.sceneDuration = computeSceneDuration(root);
    this.hasCompleted = false;
    this.sceneDynamic = sceneHasDynamicContent(root);
    this.sceneTimeScoped = sceneHasTimeScoping(root);
    // Not when time-scoped: a time-remap curve holds at its endpoints without the wrap.
    this.sceneUnbounded =
      sceneIsUnbounded(root) ||
      (!this.sceneTimeScoped && sceneIsPerpetual(root));
  }

  getStateMachineRunner(): StateMachineRunner {
    return this.machineRunner;
  }

  setMachineEventCallback(cb: ((output: MachineOutput) => void) | null): void {
    this.machineEventCallback = cb;
  }

  /** Fires on press+release over the same node; machine-less scenes too. */
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

  setSceneSize(width: number, height: number): void {
    this.sceneWidth = width;
    this.sceneHeight = height;
  }

  setViewport(matrix: Matrix3x3): void {
    this.viewport = matrix;
  }

  setClip(enabled: boolean): void {
    this.clipToScene = enabled;
  }

  /** Undimensioned scenes never clip. */
  private shouldClip(): boolean {
    return this.clipToScene && this.sceneWidth > 0 && this.sceneHeight > 0;
  }

  setLoop(enabled: boolean): void {
    this.looping = enabled;
  }

  setFrameCallback(cb: ((time: number) => void) | null): void {
    this.frameCallback = cb;
  }

  /** Fires once when a play-once timeline reaches its end. */
  setCompleteCallback(cb: (() => void) | null): void {
    this.completeCallback = cb;
  }

  /** Ms; `Infinity` for unbounded scenes, else max animation end (infinite counts once). */
  get duration(): number {
    if (this.sceneUnbounded) return Infinity;
    return this.sceneDuration;
  }

  get running(): boolean {
    return this.isRunning;
  }

  get paused(): boolean {
    return this.scheduler.isPaused();
  }

  /** True when no further visual change is possible; only a finished one-shot, non-reactive scene settles. */
  isStatic(): boolean {
    if (!this.sceneRoot) return true;
    if (this.looping || this.sceneDynamic || this.sceneUnbounded) return false;
    return this.currentTime >= this.sceneDuration;
  }

  /** Repaint at the current time (resize while paused/stopped). */
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
    this.scheduler.start();
    if (!this.isRunning) this.drawFrame(performance.now());
  }

  /** Freeze the timeline; the loop keeps running so interaction stays live. */
  pause(): void {
    this.scheduler.stop();
  }

  resume(): void {
    this.scheduler.resume();
  }

  /** Jump to `ms` and render that instant — works while paused or stopped. */
  seek(ms: number): void {
    const now = performance.now();
    this.scheduler.seek(ms, now);
    // Draw synchronously: a paused/backgrounded loop may never get another rAF tick.
    this.drawFrame(now);
  }

  get currentTime(): number {
    return this.scheduler.time();
  }

  private loop = (timestamp: number): void => {
    if (!this.isRunning) return;

    // `timestamp` anchors any transition a hover/active flip starts.
    this.interactionManager.update(
      this.inputTracker.getState(),
      timestamp,
      this.shouldClip()
        ? { width: this.sceneWidth, height: this.sceneHeight }
        : null,
    );

    // `live` gates machine evaluation and trigger reset so seek()/redraw() stay pure.
    this.drawFrame(timestamp, true);
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private drawFrame(now: number, live: boolean = false): void {
    // Invalidate the per-frame var() memo before machines or nodes resolve.
    this.variableResolver.beginFrame();
    if (this.sceneRoot) {
      let t = this.scheduler.time(now);
      if (t < this.sceneDuration) this.hasCompleted = false;
      // Wrap by re-anchoring the scheduler (keeps currentTime bounded); not while paused or unbounded.
      if (this.looping && !this.scheduler.isPaused() && !this.sceneUnbounded) {
        const wrapped = wrapTime(t, this.sceneDuration);
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
        // Play once: hold at the end, re-anchored so the frozen frame is a pure function of time.
        this.scheduler.seek(this.sceneDuration, now);
        t = this.sceneDuration;
        if (!this.hasCompleted) {
          this.hasCompleted = true;
          this.completeCallback?.();
        }
      }

      // input(time) reads timeline time, so seek/pause/export drive it too.
      this.inputTracker.update(t);
      this.variableResolver.updateInputState(this.inputTracker.getState());

      // Machines evaluate before the walk with `t` as time base; pointer edges also drive `popkorn:click`.
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
    // fire() triggers read true for exactly this frame; reset after the whole walk.
    if (live) this.variableResolver.endFrame();
    this.frameCallback?.(this.currentTime);
  }

  /** base → bindings → :state() → animation → interaction; `t` is inherited scoped time, `machineTime` global. */
  private resolveNode(
    node: SceneNode,
    t: number,
    now: number,
    machineTime: number,
  ): void {
    // Visibility uses the incoming (parent-scope) time; time scoping remaps only this node's content.
    node.hidden = t < node.visibleFrom || t >= node.visibleUntil;

    resetNodeToBase(node);
    this.applyBindings(node);
    if (node.stateStyles.length > 0) this.applyMachineStates(node, machineTime);

    // After the :state() merge so a machine-set time-remap is this frame's; scalar > curve > offset/scale.
    const local =
      node.timeRemapValue !== null
        ? node.timeRemapValue
        : node.timeRemap
          ? sampleTimeRemap(node.timeRemap, t)
          : (t - node.timeOffset) * node.timeScale;

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

    // Paint order once z-indexes resolve; render walk and hit-testing both read it.
    refreshSortedChildren(node);
  }

  /** Apply active `:state()` sets; during a `mix`, resolve both ends and blend per channel. */
  private applyMachineStates(node: SceneNode, machineTime: number): void {
    const active: {
      entry: NodeStateStyle;
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

    if (!mixing) {
      for (const { entry, blend } of active)
        this.applyStateEntry(node, entry, blend.entryTime, machineTime);
      return;
    }

    // Solid states (other machines) form the baseline both mix ends share.
    for (const { entry, blend } of active)
      if (blend.side === "solid")
        this.applyStateEntry(node, entry, blend.entryTime, machineTime);

    const keys = new Set<string>();
    for (const { entry, blend } of active)
      if (blend.side !== "solid") involvedStateKeys(entry, keys);

    const baseline = new Map<string, PropValue | null>();
    for (const key of keys) baseline.set(key, readLiveProp(node, key));

    for (const { entry, blend } of active)
      if (blend.side === "out")
        this.applyStateEntry(node, entry, blend.entryTime, machineTime);
    const from = new Map<string, PropValue | null>();
    for (const key of keys) from.set(key, readLiveProp(node, key));

    for (const key of keys) writeProp(node, key, baseline.get(key) ?? null);
    for (const { entry, blend } of active)
      if (blend.side === "in")
        this.applyStateEntry(node, entry, blend.entryTime, machineTime);

    const inSide = active.find((a) => a.blend.side === "in");
    const outSide = active.find((a) => a.blend.side === "out");
    // NOTE: concurrent mixes on one node share this progress; per-machine partitioning if needed.
    const e = inSide
      ? inSide.blend.weight
      : outSide
        ? 1 - outSide.blend.weight
        : 1;

    // Incompatible gradients/paths step at the eased midpoint (blendProp).
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

  /** Static decls, then animations anchored at `machineTime - entryTime` via a temporary `node.animations` swap. */
  private applyStateEntry(
    node: SceneNode,
    entry: NodeStateStyle,
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

  /** Raw 0..1 progress of an `animation-timeline` source (var/literal or `input(path)`). */
  private resolveTimelineProgress(value: Value): number {
    const path = inputPathOf(value);
    if (path !== null) return this.variableResolver.resolveInput(path);
    return this.variableResolver.resolveNumeric(value);
  }

  private readonly resolveNumeric = (v: Value): number =>
    this.variableResolver.resolveNumeric(v);

  private applyBindings(node: SceneNode): void {
    const resolve = this.resolveNumeric;
    const setTransform: Parameters<typeof extractTransform>[1] = (key, val) => {
      node.transform[key] = val;
    };
    for (const binding of node.bindings) {
      // Transforms aren't scalar-registry props: re-extract the whole value each frame.
      if (binding.property === "transform") {
        extractTransform(binding.value, setTransform, resolve);
        continue;
      }
      // Re-extract xywh() live so a host `--frame` can page a sprite sheet.
      if (binding.property === "object-view-box") {
        if (node.shapeData.type === "image") {
          node.shapeData.viewBox = extractImageViewBox(binding.value, resolve);
        }
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
          setTransform,
          resolve,
        );
        continue;
      }
      // Solid colors or `none` only; gradients and non-colors are ignored.
      if (binding.property === "fill" || binding.property === "stroke") {
        const resolved = this.variableResolver.resolveValue(binding.value);
        const color =
          colorStringFromValue(resolved) ??
          (isKeywordValue(resolved) && resolved.value === "none"
            ? null
            : undefined);
        if (color !== undefined) node[binding.property] = color;
        continue;
      }
      // String/keyword props re-apply through the builder switch (discrete).
      if (binding.applyString) {
        binding.applyString(
          node,
          this.variableResolver.resolveValue(binding.value),
        );
        continue;
      }
      const handler = getPropHandler(binding.property);
      if (!handler || handler.kind !== "number") continue;
      handler.apply(node, resolve(binding.value));
    }
  }

  /** Pointer edges: machine triggers use interactive-only hitTest; `popkorn:click` uses full-tree hitTestClick on edges only. */
  private detectPointerEvents(): PointerTriggerEvent[] {
    const events: PointerTriggerEvent[] = [];
    if (!this.sceneRoot) return events;
    const st = this.inputTracker.getState();
    const point = { x: st.cursor.x, y: st.cursor.y };
    const clippedOut = this.clippedOut(point.x, point.y);
    const hasMachines = this.machineRunner.hasMachines();

    const hit =
      hasMachines && !clippedOut ? hitTest(this.sceneRoot, point) : null;
    if (hasMachines && hit !== this.prevHit) {
      if (this.prevHit) events.push({ event: "hoverend", node: this.prevHit });
      if (hit) events.push({ event: "hoverstart", node: hit });
    }

    const down = st.cursor.isDown;
    // Latched press so a tap whose down+up land between frames still edges; consumed here.
    const pressed = st.cursor.pressed;
    st.cursor.pressed = false;
    const downEdge = (down || pressed) && !this.prevIsDown;
    const upEdge = !down && (this.prevIsDown || pressed);

    if (downEdge) {
      if (hasMachines) {
        events.push({ event: "pointerdown", node: hit });
        this.downHit = hit;
      }
      this.downClick = clippedOut ? null : hitTestClick(this.sceneRoot, point);
    }
    if (upEdge) {
      if (hasMachines) {
        events.push({ event: "pointerup", node: hit });
        if (hit && hit === this.downHit)
          events.push({ event: "click", node: hit });
        this.downHit = null;
      }
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

  /** Pointer outside the clipped artboard hits nothing. */
  private clippedOut(x: number, y: number): boolean {
    return (
      this.shouldClip() &&
      (x < 0 || y < 0 || x > this.sceneWidth || y > this.sceneHeight)
    );
  }

  /** Raster-cached composite; `signature` must cover everything the pixels depend on besides the content token. */
  // NOTE: pure translations miss the cache; offset blits would only be sound for whole-pixel deltas.
  private composite(
    node: SceneNode,
    kind: string,
    signature: () => string,
    region: DeviceRect,
    draw: () => void,
  ): void {
    const token = this.renderer.cacheComposite ? this.contentToken(node) : null;
    if (token === null) {
      draw();
      return;
    }
    this.renderer.cacheComposite!(
      `${this.nodeKey(node)}:${kind}`,
      `${token}|${signature()}`,
      region,
      draw,
    );
  }

  /** Memoized per frame; null when the subtree can't be hashed. */
  private contentToken(node: SceneNode): string | null {
    let token = this.contentTokens.get(node);
    if (token === undefined) {
      token = subtreeToken(node);
      this.contentTokens.set(node, token);
    }
    return token;
  }

  private render(): void {
    this.filterPlans.clear();
    this.contentTokens.clear();
    this.renderer.beginFrame();

    // beginFrame cleared the device buffer at identity; the viewport is now the root transform.
    this.renderer.setTransform(this.viewport);

    // Artboard clip in scene space; lives only in the shared walk.
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

    // Background fills the scene box, not the device buffer, so it letterboxes.
    if (this.backgroundColor) {
      this.solidPaint(this.backgroundColor);
      this.renderer.setTrim(null);
      const w = this.sceneWidth || this.renderer.getWidth();
      const h = this.sceneHeight || this.renderer.getHeight();
      this.renderer.drawRect(0, 0, w, h);
    }
    if (this.sceneRoot) {
      this.renderNode(this.sceneRoot);
    }

    if (clipping) this.renderer.restore();

    this.renderer.endFrame();
  }

  // NOTE: a fresh `{}` default is sunk by the JIT; a shared constant measured slower in bun.
  private renderNode(
    node: SceneNode,
    opts: RenderOpts = {},
    inheritedAlpha: number = 1,
    skipFilter: boolean = false,
  ): void {
    const paintSource = opts.paintSource ?? false;
    const skipMask = opts.skipMask ?? false;

    if (node.hidden || node.displayNone) return;

    // Mask sources paint only via their dependent's composite.
    if (!paintSource && node.isMaskSource) return;

    // Filter is the outermost wrapper (also wraps the mask); outer no-spread box-shadows ride it.
    const filterOps = skipFilter ? null : effectiveFilterOps(node);
    if (filterOps) {
      if (this.canFilter()) {
        this.renderFilter(node, opts, inheritedAlpha, filterOps);
        return;
      }
      if (!this.filterWarned) {
        this.filterWarned = true;
        console.warn(
          "[popkorn] filter: unsupported by this renderer; drawing unfiltered",
        );
      }
    }

    // A masked matte source is entered with skipMask=false so chained mattes composite.
    if (!skipMask && node.mask) {
      this.renderMask(node);
      return;
    }

    // Past the filter/mask redirects, so a composited node is bracketed exactly once.
    this.renderer.beginNode?.(this.nodeKey(node));

    this.renderer.save();

    // NOTE: per-node alpha product, not a group composite; overlapping children show through.
    const alpha = inheritedAlpha * node.opacity;

    this.renderer.transform(computeLocalMatrix(node));

    // Before the clip so a union clip-path uses the intended winding.
    this.renderer.setFillRule(node.fillRule);

    const clip = resolveClip(node);
    if (clip) this.renderer.clip(clip);

    // Outer geometric shadows paint behind, before the node's paint state is set.
    if (node.boxShadow) this.drawBoxShadows(node, alpha, false);

    // Per-shape blend, no group isolation.
    const blend = node.mixBlendMode;
    if (blend !== "normal") this.renderer.setBlendMode(blend);
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
    switch (node.shapeData.type) {
      case "rect": {
        const r = node.shapeData;
        // An unset radius follows the other one, as in SVG (rx alone rounds both axes).
        this.renderer.drawRect(
          r.x,
          r.y,
          r.width,
          r.height,
          r.rx || r.ry,
          r.ry || r.rx,
          r.cornerRadii,
        );
        break;
      }
      case "circle": {
        const c = node.shapeData;
        this.renderer.drawCircle(c.cx, c.cy, c.r);
        break;
      }
      case "ellipse": {
        const e = node.shapeData;
        this.renderer.drawEllipse(e.cx, e.cy, e.rx, e.ry);
        break;
      }
      case "path": {
        const p = node.shapeData;
        this.renderer.drawPath(p.commands);
        break;
      }
      case "star":
      case "polygon":
        this.renderer.drawPath(polystarCommands(node));
        break;
      case "text": {
        const t = node.shapeData;
        // Lines split here so backends stay single-line primitives.
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
        const im = node.shapeData;
        const vb = im.viewBox;
        if (vb) {
          if (vb.width <= 0 || vb.height <= 0) break;
          // A 0 dest size falls back to the crop's size, not the bitmap's.
          const dw = im.width > 0 ? im.width : vb.width;
          const dh = im.height > 0 ? im.height : vb.height;
          this.renderer.drawImage(
            im.src,
            im.x,
            im.y,
            dw,
            dh,
            vb.x,
            vb.y,
            vb.width,
            vb.height,
          );
        } else {
          this.renderer.drawImage(im.src, im.x, im.y, im.width, im.height);
        }
        break;
      }
      case "group":
        break;
    }

    if (blend !== "normal") this.renderer.setBlendMode("normal");

    if (node.boxShadow) this.drawBoxShadows(node, alpha, true);

    for (const child of childrenInPaintOrder(node)) {
      this.renderNode(child, undefined, alpha);
    }

    this.renderer.restore();
    this.renderer.endNode?.();
  }

  /** Scene → device px for `node` (setTransform bypasses the root viewport, so it's folded in). */
  private deviceMatrix(node: SceneNode | null): Matrix3x3 {
    return multiplyMatrices(this.viewport, computeWorldMatrixFromRoot(node));
  }

  /** Filter composites need both the capability probe and the method. */
  private canFilter(): boolean {
    return !!(
      this.renderer.supportsFilter?.() && this.renderer.compositeFilter
    );
  }

  /** Flat solid fill, no stroke. */
  private solidPaint(color: string): void {
    this.renderer.setFill(color);
    this.renderer.setFillGradient(null);
    this.renderer.setStroke(null, 0);
    this.renderer.setStrokeGradient(null);
  }

  private nodeKey(node: SceneNode): string {
    let key = this.nodeKeys.get(node);
    if (key === undefined) {
      key = "n" + this.nextNodeKey++;
      this.nodeKeys.set(node, key);
    }
    return key;
  }

  /** Each closure sets its own world transform, so content/source align wherever the source lives. */
  private renderMask(node: SceneNode): void {
    const source = node.mask!.source;
    const contentParent = this.deviceMatrix(node.parent);
    const maskParent = this.deviceMatrix(source.parent);
    const contentAlpha = worldAlpha(node.parent);
    const maskAlpha = worldAlpha(source.parent);

    // Region = content box, intersected with the mask box only when not inverted.
    const mode = node.mask!.mode;
    const inverted = mode === "alpha-invert" || mode === "luminance-invert";
    const w = this.renderer.getWidth();
    const h = this.renderer.getHeight();
    const region = maskDeviceBounds(
      subtreeDeviceBounds(node, contentParent, w, h, true),
      inverted ? null : subtreeDeviceBounds(source, maskParent, w, h, true),
      inverted,
    );
    if (!region) return;

    this.composite(
      node,
      "mask",
      () =>
        `${mode}|${contentParent.join(",")}|${maskParent.join(",")}|${contentAlpha}|${maskAlpha}|${regionKey(region)}`,
      region,
      () =>
        this.renderer.compositeMask(
          mode,
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
          region,
        ),
    );
  }

  /** Offscreen at device space; filter lengths are pre-scaled by world scale since ctx.filter CTM handling varies. */
  private renderFilter(
    node: SceneNode,
    opts: RenderOpts,
    inheritedAlpha: number,
    ops: FilterOp[],
  ): void {
    const parentWorld = this.deviceMatrix(node.parent);
    const paintSource = opts.paintSource ?? false;
    const planKey = `${parentWorld.join(",")}|${paintSource}`;
    let plan = this.filterPlans.get(node);
    if (!plan || plan.key !== planKey) {
      plan = {
        key: planKey,
        ...this.planFilter(node, parentWorld, ops, paintSource),
      };
      this.filterPlans.set(node, plan);
    }
    // All ops identity at this scale: draw inline, skip the offscreen.
    const { css, region } = plan;
    if (css === null) {
      this.renderNode(node, opts, inheritedAlpha, true /* skipFilter */);
      return;
    }
    if (!region) return;
    this.composite(
      node,
      // Variant in the key so mask-content and normal-walk rasters don't evict each other.
      `filter${paintSource ? "S" : ""}${opts.skipMask ? "M" : ""}`,
      () =>
        `${css}|${parentWorld.join(",")}|${inheritedAlpha}|${regionKey(region)}`,
      region,
      () =>
        this.renderer.compositeFilter!(
          css,
          () => {
            this.renderer.setTransform(parentWorld);
            this.renderNode(node, opts, inheritedAlpha, true /* skipFilter */);
          },
          region,
        ),
    );
  }

  private planFilter(
    node: SceneNode,
    parentWorld: Matrix3x3,
    ops: FilterOp[],
    paintSource: boolean,
  ): { css: string | null; region: DeviceRect | null } {
    const world = this.deviceMatrix(node);
    // User-space filters (SVG) already get the parent's scale; pass only the local part.
    const scale = this.renderer.filtersUseUserSpace?.()
      ? matrixScale(world) / (matrixScale(parentWorld) || 1)
      : matrixScale(world);
    const css = filterToCSS(ops, scale);
    if (css === null) return { css: null, region: null };
    const region = subtreeDeviceBounds(
      node,
      parentWorld,
      this.renderer.getWidth(),
      this.renderer.getHeight(),
      paintSource,
    );
    return { css, region };
  }

  /** Inflated (outer) or punched-out (inset) shapes, blurred via compositeFilter; sharp without filter support. */
  private drawBoxShadows(node: SceneNode, alpha: number, inset: boolean): void {
    if (!node.boxShadow) return;
    const shadows = node.boxShadow.filter(
      (s): s is Extract<FilterOp, { type: "drop-shadow" }> =>
        s.type === "drop-shadow" &&
        isGeometricShadow(node, s) &&
        (s.inset ?? false) === inset,
    );
    if (shadows.length === 0) return;
    const world = this.deviceMatrix(node);
    const scale = matrixScale(world);
    const clip = inset ? shapeClip(node.shapeData) : null;
    // CSS paints the first-listed shadow on top; draw back-to-front.
    for (let i = shadows.length - 1; i >= 0; i--) {
      const s = shadows[i];
      const spread = s.spread ?? 0;
      const commands = inset
        ? insetShadowCommands(node.shapeData, s.dx, s.dy, spread)
        : shapeOutline(node.shapeData, s.dx, s.dy, spread);
      if (!commands) continue;
      const draw = () => {
        this.renderer.setTransform(world);
        this.renderer.save();
        this.solidPaint(s.color);
        this.renderer.setFillRule(inset ? "evenodd" : "nonzero");
        this.renderer.setOpacity(alpha);
        if (inset && clip) this.renderer.clip(clip);
        this.renderer.drawPath(commands);
        this.renderer.restore();
      };
      const blur = s.blur * scale;
      // NOTE: no region, so this claims the full buffer; pass the shadow's device rect to fix.
      if (blur > 0 && this.canFilter()) {
        this.renderer.compositeFilter!(`blur(${blur}px)`, draw);
      } else {
        this.renderer.save();
        draw();
        this.renderer.restore();
      }
    }
  }
}

// Inset (any outlined shape) or spread-on-rect/circle/ellipse shadows draw geometrically; others ride the filter.
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

// Authored `filter` plus non-geometric shadows. NOTE: non-geometric inset shadows are dropped.
function effectiveFilterOps(node: SceneNode): FilterOp[] | null {
  const authored = node.filter ?? [];
  const shadows: FilterOp[] = [];
  if (node.boxShadow) {
    for (const s of node.boxShadow) {
      if (s.type !== "drop-shadow" || isGeometricShadow(node, s)) continue;
      if (s.inset) continue;
      shadows.push(s);
    }
  }
  const ops = [...authored, ...shadows];
  return ops.length > 0 ? ops : null;
}

/** Sub-half-pixel device blur is invisible, so it counts as identity. */
const MIN_DEVICE_BLUR_PX = 0.5;

/** The amount at which each single-scalar color function is a no-op. */
const COLOR_FN_IDENTITY: Record<ColorFilterFn, number> = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  opacity: 1,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  "hue-rotate": 0,
};

function isTransparentColor(color: string): boolean {
  if (color === "transparent") return true;
  const rgba = color.match(/^rgba?\(([^)]*)\)$/);
  if (rgba) {
    const parts = rgba[1].split(/[,/]/);
    return parts.length === 4 && Number(parts[3].trim()) === 0;
  }
  if (/^#[0-9a-f]{4}$/i.test(color)) return color[4] === "0";
  if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(7) === "00";
  return false;
}

// A zero-offset shadow still paints under translucent content, so only a transparent one is identity.
function isIdentityOp(op: FilterOp, scale: number): boolean {
  if (op.type === "blur") return op.radius * scale < MIN_DEVICE_BLUR_PX;
  if (op.type === "drop-shadow") return isTransparentColor(op.color);
  if (op.type === "hue-rotate") return op.amount % 360 === 0;
  return op.amount === COLOR_FN_IDENTITY[op.type];
}

/** Device-px filter string or null if all identity; adjacent blurs merge (σ = √Σσᵢ²), safe as bounds.ts pads 3σ per blur. */
export function filterToCSS(ops: FilterOp[], scale: number): string | null {
  const parts: string[] = [];
  let blurSigmaSq = 0;
  const flushBlur = (): void => {
    const sigma = Math.sqrt(blurSigmaSq);
    if (sigma >= MIN_DEVICE_BLUR_PX) parts.push(`blur(${sigma}px)`);
    blurSigmaSq = 0;
  };
  for (const op of ops) {
    if (op.type === "blur") {
      const radius = op.radius * scale;
      blurSigmaSq += radius * radius;
      continue;
    }
    flushBlur();
    if (isIdentityOp(op, scale)) continue;
    if (op.type === "drop-shadow") {
      parts.push(
        `drop-shadow(${op.dx * scale}px ${op.dy * scale}px ${op.blur * scale}px ${op.color})`,
      );
    } else if (op.type === "hue-rotate") {
      parts.push(`hue-rotate(${op.amount}deg)`);
    } else {
      parts.push(`${op.type}(${op.amount})`);
    }
  }
  flushBlur();
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Every binding value and nested operand, flattened for the calc() batch planner. */
function collectBindingValues(root: SceneNode): Value[] {
  const out: Value[] = [];
  const push = (v: Value): void => {
    out.push(v);
    if (isFunctionValue(v)) for (const a of v.args) push(a);
    else if (v.type === "list") for (const a of v.values) push(a);
  };
  forEachNode(root, (node) => {
    for (const b of node.bindings) push(b.value);
  });
  return out;
}

/** Anything that changes beyond a one-shot timeline; scanned once so `isStatic` is O(1). */
function sceneHasDynamicContent(root: SceneNode): boolean {
  return someNode(
    root,
    (n) =>
      n.machines.length > 0 ||
      n.bindings.length > 0 ||
      !!(n.hoverStyles || n.activeStyles || n.interactive) ||
      n.stateStyles.length > 0 ||
      !!n.animationTimeline ||
      n.animations.some((a) => a.iterationCount === Infinity),
  );
}

/** Any time-remap/offset/scale, which makes `computeSceneDuration` a local-time max, not a root bound. */
function sceneHasTimeScoping(root: SceneNode): boolean {
  return someNode(
    root,
    (n) =>
      !!n.timeRemap ||
      n.timeRemapValue !== null ||
      n.timeOffset !== 0 ||
      n.timeScale !== 1,
  );
}

/** A `@machine` or any `:state()` set (legal without a machine): no clip end to hold, wrap or finish at. */
function sceneIsUnbounded(root: SceneNode): boolean {
  if (root.machines.length > 0) return true;
  return someNode(root, (n) => n.stateStyles.length > 0);
}

/** All animations `infinite` and no visibility windows: free-runs rather than snapping to phase 0 at a nominal wrap. */
export function sceneIsPerpetual(root: SceneNode): boolean {
  const finite = someNode(
    root,
    (n) =>
      n.visibleFrom !== -Infinity ||
      n.visibleUntil !== Infinity ||
      n.animations.some((a) => a.iterationCount !== Infinity),
  );
  return !finite && someNode(root, (n) => n.animations.length > 0);
}

/** Does `value` read an input() whose path passes `test`, directly or through var()? */
export function readsInput(
  value: Value,
  variables: readonly VariableDefinition[],
  test: (path: string) => boolean,
): boolean {
  const seen = new Set<string>();
  const visit = (v: unknown): boolean => {
    if (!v || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some(visit);
    const o = v as { type?: string; name?: string; args?: Value[] };
    if (o.type === "function" && o.name === "input") {
      const path = inputPathOf(v as Value);
      return path !== null && test(path);
    }
    if (o.type === "variable" && o.name && !seen.has(o.name)) {
      seen.add(o.name);
      const def = variables.find((d) => d.name === o.name);
      if (def && visit(def.value)) return true;
    }
    return Object.values(o).some(visit);
  };
  return visit(value);
}

function subtreeReadsTime(
  root: SceneNode,
  variables: readonly VariableDefinition[],
): boolean {
  return someNode(root, (n) =>
    n.bindings.some((b) => readsInput(b.value, variables, (p) => p === "time")),
  );
}

const MAX_SEAMLESS_LOOP_MS = 30_000;
const DEFAULT_TIME_EXPORT_MS = 5_000;

/** LCM of cycle periods (`alternate` counts two). NOTE: positive delays make this not seamless. */
function seamlessLoopMs(root: SceneNode): number {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let lcm = 1;
  forEachNode(root, (node) => {
    for (const a of node.animations) {
      const alt =
        a.direction === "alternate" || a.direction === "alternate-reverse";
      const period = Math.round(a.duration) * (alt ? 2 : 1);
      if (period > 0 && lcm <= MAX_SEAMLESS_LOOP_MS)
        lcm = (lcm / gcd(lcm, period)) * period;
    }
  });
  return lcm;
}

export type ExportLength =
  | { fixed: true; ms: number }
  | { fixed: false; suggestedMs: number };

/** Offline export range: `fixed` has an honest end (0 = one frame); open suggests a length; null = machine without timeline animation. */
export function sceneExportLength(
  root: SceneNode,
  variables: readonly VariableDefinition[],
): ExportLength | null {
  const nominal = computeSceneDuration(root);
  const machine = sceneIsUnbounded(root);
  if (nominal <= 0) {
    if (subtreeReadsTime(root, variables))
      return { fixed: false, suggestedMs: DEFAULT_TIME_EXPORT_MS };
    return machine ? null : { fixed: true, ms: 0 };
  }
  const perpetual = !sceneHasTimeScoping(root) && sceneIsPerpetual(root);
  if (!machine && !perpetual) return { fixed: true, ms: nominal };
  const loop = perpetual ? seamlessLoopMs(root) : 0;
  return {
    fixed: false,
    suggestedMs: loop > 0 && loop <= MAX_SEAMLESS_LOOP_MS ? loop : nominal,
  };
}

function regionKey(r: DeviceRect): string {
  return `${r.x},${r.y},${r.width},${r.height}`;
}

/** Product of opacities from `node` up to the root. */
function worldAlpha(node: SceneNode | null): number {
  let alpha = 1;
  for (let n: SceneNode | null = node; n; n = n.parent) alpha *= n.opacity;
  return alpha;
}

export function wrapTime(t: number, duration: number): number {
  if (duration > 0 && t >= duration) return t % duration;
  return t;
}

/** Inherited → local ms via the departing stop's easing; endpoints hold; `stops` sorted by input. */
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

/** trim-* → dash descriptor; null when untrimmed. Negative dashOffset handles seam wrap on closed shapes. */
export function computeTrim(node: SceneNode): TrimDescriptor | null {
  const start = clamp01(node.trimStart);
  const end = clamp01(node.trimEnd);
  const offset = clamp01(node.trimOffset);

  if (start <= 0 && end >= 1 && offset === 0) return null;

  const total = outlineLength(node);
  if (total <= 0) return null;

  if (end <= start) return { visible: false, dashArray: [], dashOffset: 0 };

  if (start <= 0 && end >= 1)
    return { visible: true, dashArray: [], dashOffset: 0 };

  const visible = (end - start) * total;
  const startPos = start + offset;

  // Non-wrapping window: 2x gap, since an exact period leaves a round-cap dot at either end.
  if (end + offset <= 1) {
    return {
      visible: true,
      dashArray: [visible, 2 * total],
      dashOffset: -startPos * total,
    };
  }

  return {
    visible: true,
    dashArray: [visible, total - visible],
    dashOffset: -startPos * total,
  };
}
