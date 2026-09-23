/** Runs every `@machine`: once per live frame, `*` then current-state transitions, first fired+guarded wins. */
// State is off the timeline (seek() never touches it) and anchored on the GLOBAL time, not per-subtree scoped time.

import type {
  MachineGuard,
  MachineRule,
  MachineTrigger,
} from "@popkorn/parser";
import { applyEasing, parseTimingString } from "../animation/easing.js";
import { animationsEndTime } from "../animation/scheduler.js";
import type {
  AnimationInstance,
  SceneNode,
  TimingFunction,
} from "../scene/types.js";
import type { VariableResolver } from "./variables.js";

// Credited to the nearest interactive hit node, or null for empty canvas (still a `:root` occurrence).
export interface PointerTriggerEvent {
  event: "click" | "pointerdown" | "pointerup" | "hoverstart" | "hoverend";
  node: SceneNode | null;
}

// Forwarded to the host as `statechange` / `machine-event` DOM events.
export type MachineOutput =
  | { type: "statechange"; machine: string; from: string; to: string }
  | { type: "emit"; machine: string; name: string };

export interface MachineEvalContext {
  variableResolver: VariableResolver;
  pointerEvents: PointerTriggerEvent[];
}

interface MachineInstance {
  def: MachineRule;
  current: string;
  entryTime: number; // global timeline ms at entry into `current`
  completeAt: number; // Infinity if none/looping
  // Outgoing `mix` state (null when none in flight); it keeps sampling from `prevEntryTime`.
  prevState: string | null;
  prevEntryTime: number;
  mixDuration: number; // 0 => no mix
  mixEasing: TimingFunction;
}

// `solid` = steady (weight 1); `in`/`out` = ends of a running mix at eased `weight`.
export interface StateBlend {
  weight: number;
  entryTime: number;
  side: "solid" | "in" | "out";
}

export class StateMachineRunner {
  private root: SceneNode | null = null;
  private instances: MachineInstance[] = [];
  // External `on event(name)` occurrences, consumed by evaluate().
  private queuedEvents: string[] = [];

  /** Reset every machine to its initial state at `now`; called from setScene, never seek(). */
  setScene(root: SceneNode, now = 0): void {
    this.root = root;
    this.queuedEvents = [];
    this.instances = root.machines.map((def) => {
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

  hasMachines(): boolean {
    return this.instances.length > 0;
  }

  enqueueEvent(name: string): void {
    this.queuedEvents.push(name);
  }

  currentState(machine: string): string | undefined {
    return this.instances.find((i) => i.def.name === machine)?.current;
  }

  /** Copy-safe snapshot of each machine's state and entry time, for timeline UIs. */
  snapshot(): { machine: string; state: string; entryTime: number }[] {
    return this.instances.map((i) => ({
      machine: i.def.name,
      state: i.current,
      entryTime: i.entryTime,
    }));
  }

  /** A state's contribution this frame, or null if neither current nor fading out; pure in `machineTime`. */
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

  /** Advance every machine at most once; consumes queued events. */
  evaluate(machineTime: number, ctx: MachineEvalContext): MachineOutput[] {
    const out: MachineOutput[] = [];
    for (const inst of this.instances) {
      this.step(inst, machineTime, ctx, out);
    }
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
        // NOTE: an interrupted mix re-anchors from its incoming state; no multi-way blend snapshot.
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

  // Infinity (never `on complete`) when the state has no animations or any loop forever.
  private computeCompleteAt(
    machine: string,
    state: string,
    entryTime: number,
  ): number {
    const end = animationsEndTime(this.animationsForState(machine, state));
    return end === Infinity ? Infinity : entryTime + end;
  }

  private animationsForState(machine: string, state: string) {
    const acc: AnimationInstance[] = [];
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

/** `:root` matches anywhere; `#id` matches the credited node or an ancestor (bubbling). */
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

// Equality is loose across number/boolean/string; ordering coerces to number (booleans 1/0).
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
