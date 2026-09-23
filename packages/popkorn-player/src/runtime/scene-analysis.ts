import {
  isFunctionValue,
  type Value,
  type VariableDefinition,
} from "@popkorn/parser";
import { computeSceneDuration } from "../animation/scheduler.js";
import type { SceneNode } from "../scene/types.js";
import { forEachNode, someNode } from "../scene/walk.js";
import { inputPathOf } from "./inputs.js";

/** Every binding value and nested operand, flattened for the calc() batch planner. */
export function collectBindingValues(root: SceneNode): Value[] {
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
export function sceneHasDynamicContent(root: SceneNode): boolean {
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
export function sceneHasTimeScoping(root: SceneNode): boolean {
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
export function sceneIsUnbounded(root: SceneNode): boolean {
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
