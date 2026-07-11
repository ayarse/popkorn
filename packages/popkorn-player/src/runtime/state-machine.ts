/**
 * State machine runner.
 *
 * One `StateMachineRunner` owns every `@machine` in a scene. Per frame, BEFORE
 * the node walk, `evaluate()` advances each machine at most once: any-state
 * (`*`) transitions are checked first, then the current state's, in declaration
 * order; the first whose trigger fired AND whose guards all pass wins. On a
 * transition the machine records `(newState, entryTime)`, recomputes its
 * `on complete` deadline, and emits `statechange` + any `emit`s.
 *
 * Machine state lives OFF the timeline (instance fields here, never on nodes and
 * never derived from the scheduler), exactly like the InteractionManager's hover
 * tweens. `seek()` therefore does not touch machines: a rendered frame is a pure
 * function of `(timelineTime, machineState)` (invariant 4, generalized).
 *
 * TIME BASE. `entryTime` and the `machineTime` handed to `evaluate()` are both
 * the GLOBAL timeline time (the root's inherited `t`, pre per-subtree scoping).
 * State animations are therefore anchored on the global clock — a per-subtree
 * `time-offset`/`time-scale`/`time-remap` retimes a node's own (base) animations
 * but NOT its state animations. In the common case (no time scoping on a
 * machine-driven node) machineTime == the node's local time, so there is no
 * observable difference; anchoring globally keeps entry a single clock event and
 * avoids threading a parallel scoped entry-time per machine down the walk.
 */

import type {
  MachineGuard,
  MachineRule,
  MachineTrigger,
} from "@popkorn/parser";
import { applyEasing, parseTimingString } from "../animation/easing";
import { animationsEndTime } from "../animation/scheduler";
import type { SceneNode, TimingFunction } from "../scene/types";
import type { VariableResolver } from "./variables";

// A pointer event detected this frame, credited to the top hit node (nearest
// interactive) — or null for empty canvas (still a `:root` occurrence). Built by
// the loop from the shared hit-tester; the runner only matches it to triggers.
export interface PointerTriggerEvent {
  event: "click" | "pointerdown" | "pointerup" | "hoverstart" | "hoverend";
  node: SceneNode | null;
}

// Side effects a transition produces, forwarded by the loop to the host
// (component) as `statechange` / `machine-event` DOM events.
export type MachineOutput =
  | { type: "statechange"; machine: string; from: string; to: string }
  | { type: "emit"; machine: string; name: string };

// Everything `evaluate()` needs to resolve a frame's triggers and guards.
export interface MachineEvalContext {
  variableResolver: VariableResolver;
  pointerEvents: PointerTriggerEvent[];
}

interface MachineInstance {
  def: MachineRule;
  current: string;
  entryTime: number; // global timeline ms at entry into `current`
  completeAt: number; // machineTime at which `current`'s animations finish (Infinity if none/looping)
  // Cross-fade (`mix`) bookkeeping, off the timeline like the rest of machine
  // state. `prevState` is the state we're fading OUT of; null when no mix is in
  // flight (a hard-cut transition clears it). The outgoing state keeps sampling
  // its own animations from `prevEntryTime` for the window's duration.
  prevState: string | null;
  prevEntryTime: number;
  mixDuration: number; // 0 => no mix
  mixEasing: TimingFunction;
}

// A `:state()` entry's contribution to a node this frame. `side` distinguishes
// the steady state (`solid`, weight 1) from the two ends of a running mix
// (`in` = fading in / incoming, `out` = fading out / outgoing). `weight` is the
// eased blend weight and `entryTime` anchors that state's own animations.
export interface StateBlend {
  weight: number;
  entryTime: number;
  side: "solid" | "in" | "out";
}

export class StateMachineRunner {
  private root: SceneNode | null = null;
  private instances: MachineInstance[] = [];
  // External `on event(name)` occurrences enqueued between frames (from
  // component.fire of a non-variable name); consumed at the end of evaluate().
  private queuedEvents: string[] = [];

  /**
   * Bind the runner to a freshly built scene. Resets every machine to its
   * initial state, anchored at `now` (the timeline time at scene start, 0 in the
   * normal case). Called from RenderLoop.setScene — NOT from seek().
   */
  setScene(root: SceneNode, now = 0): void {
    this.root = root;
    this.queuedEvents = [];
    this.instances = (root.machines ?? []).map((def) => {
      const inst: MachineInstance = {
        def,
        current: def.initial,
        entryTime: now,
        completeAt: Infinity,
        prevState: null,
        prevEntryTime: now,
        mixDuration: 0,
        mixEasing: "linear",
      };
      inst.completeAt = this.computeCompleteAt(def.name, def.initial, now);
      return inst;
    });
  }

  /** Whether the scene has any machines (lets the loop skip pointer detection). */
  hasMachines(): boolean {
    return this.instances.length > 0;
  }

  /** Enqueue an external named event for the next evaluate() (see MachineTrigger 'event'). */
  enqueueEvent(name: string): void {
    this.queuedEvents.push(name);
  }

  /** Current state of a machine by name (for tests / introspection). */
  currentState(machine: string): string | undefined {
    return this.instances.find((i) => i.def.name === machine)?.current;
  }

  /**
   * Is a `:state()` set active this frame? `machine === null` (un-namespaced
   * `:state(name)`) matches that state in ANY machine.
   */
  isStateActive(machine: string | null, name: string): boolean {
    for (const inst of this.instances) {
      if (
        inst.current === name &&
        (machine === null || inst.def.name === machine)
      )
        return true;
    }
    return false;
  }

  /** Entry time (global ms) of the machine currently in `name` (first match for null). */
  entryTimeFor(machine: string | null, name: string): number {
    for (const inst of this.instances) {
      if (
        inst.current === name &&
        (machine === null || inst.def.name === machine)
      )
        return inst.entryTime;
    }
    return 0;
  }

  /**
   * The blend contribution of a `:state()` entry `(machine, name)` this frame,
   * or null if that state is neither current nor a still-fading outgoing state.
   * Outside a mix window the current state returns a `solid` weight-1
   * contribution (the hard-cut fast path). During a mix, the incoming state
   * returns `side:"in"` at eased progress and the outgoing returns `side:"out"`
   * at `1 - progress`; once the window has elapsed the incoming state collapses
   * back to `solid`. Pure in `machineTime` — no instance mutation — so seek(t)
   * twice yields identical contributions.
   */
  stateBlend(
    machine: string | null,
    name: string,
    machineTime: number,
  ): StateBlend | null {
    for (const inst of this.instances) {
      if (machine !== null && inst.def.name !== machine) continue;
      const mixing = inst.prevState !== null && inst.mixDuration > 0;
      let p = 1;
      if (mixing) {
        const raw = (machineTime - inst.entryTime) / inst.mixDuration;
        p = raw <= 0 ? 0 : raw >= 1 ? 1 : applyEasing(raw, inst.mixEasing);
      }
      if (inst.current === name) {
        const solid = !mixing || p >= 1;
        return {
          weight: solid ? 1 : p,
          entryTime: inst.entryTime,
          side: solid ? "solid" : "in",
        };
      }
      if (mixing && p < 1 && inst.prevState === name) {
        return { weight: 1 - p, entryTime: inst.prevEntryTime, side: "out" };
      }
    }
    return null;
  }

  /**
   * Advance every machine at most once. Returns the transitions/emits produced,
   * in order. Consumes the external-event queue and the frame's pointer events
   * (the caller supplies a fresh `pointerEvents` list each frame).
   */
  evaluate(machineTime: number, ctx: MachineEvalContext): MachineOutput[] {
    const out: MachineOutput[] = [];
    for (const inst of this.instances) {
      this.step(inst, machineTime, ctx, out);
    }
    // Triggers are momentary: external events are consumed here; the pointer
    // list is owned (and dropped) by the caller after this returns.
    this.queuedEvents = [];
    return out;
  }

  private step(
    inst: MachineInstance,
    machineTime: number,
    ctx: MachineEvalContext,
    out: MachineOutput[],
  ): void {
    const def = inst.def;
    // Any-state (`*`) transitions are checked before the current state's.
    const anyState = def.states.find((s) => s.name === "*");
    const cur = def.states.find((s) => s.name === inst.current);
    const ordered = [
      ...(anyState?.transitions ?? []),
      ...(cur?.transitions ?? []),
    ];

    for (const tr of ordered) {
      if (!this.triggerFired(tr.trigger, inst, machineTime, ctx)) continue;
      if (!tr.guards.every((g) => this.guardPasses(g, inst, machineTime, ctx)))
        continue;

      const from = inst.current;
      const fromEntry = inst.entryTime;
      inst.current = tr.to;
      inst.entryTime = machineTime;
      if (tr.mix && tr.mix.duration > 0) {
        // Start (or, if one was already running, restart from) a cross-fade. On
        // an interrupted mix we simply re-anchor here: the new outgoing state is
        // whatever `current` just was — i.e. the interrupted mix's INCOMING
        // state — so the old outgoing contribution is dropped.
        // NOTE: acceptable v1 interrupt semantics — no multi-way blend snapshot.
        inst.prevState = from;
        inst.prevEntryTime = fromEntry;
        inst.mixDuration = tr.mix.duration;
        inst.mixEasing = parseTimingString(tr.mix.easing);
      } else {
        inst.prevState = null; // hard cut
      }
      inst.completeAt = this.computeCompleteAt(def.name, tr.to, machineTime);
      out.push({ type: "statechange", machine: def.name, from, to: tr.to });
      const toState = def.states.find((s) => s.name === tr.to);
      for (const name of toState?.emits ?? [])
        out.push({ type: "emit", machine: def.name, name });
      return; // at most one transition per machine per frame
    }
  }

  private triggerFired(
    trigger: MachineTrigger | null,
    inst: MachineInstance,
    machineTime: number,
    ctx: MachineEvalContext,
  ): boolean {
    if (!trigger) return true; // unconditional (guard-only, or immediate when guardless)
    switch (trigger.kind) {
      case "complete":
        return machineTime >= inst.completeAt; // completeAt Infinity => never fires
      case "event":
        return this.queuedEvents.includes(trigger.name);
      case "pointer":
        return ctx.pointerEvents.some(
          (pe) =>
            pe.event === trigger.event &&
            pointerTargetMatches(trigger.target, pe.node),
        );
    }
  }

  private guardPasses(
    g: MachineGuard,
    inst: MachineInstance,
    machineTime: number,
    ctx: MachineEvalContext,
  ): boolean {
    const left = this.resolveOperand(g.left, inst, machineTime, ctx);
    return compare(left, g.op, g.right);
  }

  private resolveOperand(
    left: MachineGuard["left"],
    inst: MachineInstance,
    machineTime: number,
    ctx: MachineEvalContext,
  ): number | boolean | string | undefined {
    switch (left.kind) {
      case "state-time":
        return machineTime - inst.entryTime;
      case "var":
        return ctx.variableResolver.getVariable(left.name);
      case "input":
        return ctx.variableResolver.resolveInput(left.path);
    }
  }

  // Union of every state animation for (machine, state) across the tree, then
  // the local time at which they all finish: `entryTime + animationsEndTime(...)`
  // (Infinity when the state has no animations or any loop forever — such states
  // never satisfy `on complete`, by design).
  private computeCompleteAt(
    machine: string,
    state: string,
    entryTime: number,
  ): number {
    const end = animationsEndTime(this.animationsForState(machine, state));
    return end === Infinity ? Infinity : entryTime + end;
  }

  private animationsForState(machine: string, state: string) {
    const acc: import("../scene/types").AnimationInstance[] = [];
    const visit = (n: SceneNode): void => {
      for (const e of n.stateStyles) {
        if (e.name === state && (e.machine === null || e.machine === machine))
          acc.push(...e.animations);
      }
      n.children.forEach(visit);
    };
    if (this.root) visit(this.root);
    return acc;
  }
}

/**
 * Does the pointer target name this event's node? `:root` matches anywhere on
 * the canvas (any occurrence, including empty-canvas null). An `#id` target
 * matches when it is the credited node or one of its ancestors (bubbling —
 * clicking a shape inside an interactive group counts as clicking the group).
 */
function pointerTargetMatches(
  target: { type: "id" | "root"; name: string },
  node: SceneNode | null,
): boolean {
  if (target.type === "root") return true;
  for (let n: SceneNode | null = node; n; n = n.parent) {
    if (n.id === target.name || n.id.endsWith("." + target.name)) return true;
  }
  return false;
}

// Flat comparison for a guard. Equality (`=`/`!=`) compares loosely across
// number/boolean/string; ordering (`<` `<=` `>` `>=`) coerces to number and
// fails on non-numeric operands. Booleans read as 1/0.
function compare(
  left: number | boolean | string | undefined,
  op: MachineGuard["op"],
  right: number | boolean | string,
): boolean {
  if (op === "=" || op === "!=") {
    const eq = looseEq(left, right);
    return op === "=" ? eq : !eq;
  }
  const l = toNum(left);
  const r = toNum(right);
  if (Number.isNaN(l) || Number.isNaN(r)) return false;
  switch (op) {
    case "<":
      return l < r;
    case "<=":
      return l <= r;
    case ">":
      return l > r;
    case ">=":
      return l >= r;
  }
}

function looseEq(
  a: number | boolean | string | undefined,
  b: number | boolean | string,
): boolean {
  if (typeof a === "boolean" || typeof b === "boolean")
    return toNum(a) === toNum(b);
  if (typeof a === "number" || typeof b === "number")
    return toNum(a) === toNum(b);
  return String(a) === String(b);
}

function toNum(v: number | boolean | string | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return parseFloat(v);
  return NaN;
}

export function createStateMachineRunner(): StateMachineRunner {
  return new StateMachineRunner();
}
