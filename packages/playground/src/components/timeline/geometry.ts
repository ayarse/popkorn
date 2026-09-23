import type {
  TimelineAnimation,
  TimelineAnimationProperty,
  TimingFunction,
} from "@popkorn/player";
import { snapMs } from "./scale";
import type { Clock } from "./use-player-timeline";

// Pure geometry / label helpers for the timeline rows (no React).

/** Fixed width (px) of the sticky-left label column, shared by ruler + rows. */
export const LABEL_W = 168;
/** Trailing slack (px) so the last pill/tick isn't flush against the edge. */
export const LANE_PAD = 48;
/** Shortest duration (ms) a trim can leave. */
export const MIN_DURATION = 10;

export type Keyframe = TimelineAnimationProperty["keyframes"][number];
export type MachineState = {
  machine: string;
  state: string;
  entryTime: number;
};

export type LaneHandler = (e: React.PointerEvent<HTMLDivElement>) => void;

/** Shared view context threaded to the (memoized) row components. */
export interface TimelineCtx {
  ppm: number;
  displayEnd: number;
  machineStates: MachineState[];
  clock: Clock;
  seek: (ms: number) => void;
  commitRetime: (
    selector: string,
    name: string,
    changes: { delay?: number; duration?: number },
  ) => void;
  commitKeyframe: (name: string, oldOffset: number, newOffset: number) => void;
  onLaneDown: LaneHandler;
  onLaneMove: LaneHandler;
}

/** Where an animation is anchored on the global timeline given the live machine
 * states. Un-stated animations (and active state animations) anchor at their
 * machine entry; an INACTIVE state animation anchors at 0 and renders dimmed. */
export function animAnchor(
  a: TimelineAnimation,
  machineStates: MachineState[],
): { active: boolean; entry: number } {
  if (!a.state) return { active: true, entry: 0 };
  const st = a.state;
  const m = machineStates.find(
    (s) =>
      s.state === st.state && (st.machine === null || s.machine === st.machine),
  );
  // Sampling of an active state is machineTime − entryTime, so its keys play
  // from `entryTime + delay`; inactive states never run, so anchor them at 0.
  return m ? { active: true, entry: m.entryTime } : { active: false, entry: 0 };
}

/** Timeline span (ms) of an animation, capping ∞ iterations at the display end. */
export function animSpan(
  a: Pick<TimelineAnimation, "delay" | "duration" | "iterationCount">,
  entry: number,
  displayEnd: number,
) {
  const start = entry + a.delay;
  const finite = Number.isFinite(a.iterationCount);
  const rawEnd = finite ? start + a.duration * a.iterationCount : displayEnd;
  return {
    start,
    end: Math.max(start, rawEnd),
    // Faded right edge when clipped by the scene/display end (∞ or overrun).
    faded: !finite || rawEnd > displayEnd,
  };
}

/** Left-cap trim: move the in-point by `dMs`, keeping the end fixed. */
export function trimStart(
  delay: number,
  duration: number,
  dMs: number,
): { delay: number; duration: number } {
  const end = delay + duration;
  const next = Math.min(
    snapMs(delay + Math.min(dMs, duration - MIN_DURATION)),
    end - MIN_DURATION,
  );
  return { delay: next, duration: end - next };
}

/** Human label for a timing function (keyword or cubic-bezier/steps/linear()). */
export function easingLabel(tf: TimingFunction): string {
  if (typeof tf === "string") return tf;
  if (tf.type === "cubic-bezier")
    return `cubic-bezier(${tf.x1}, ${tf.y1}, ${tf.x2}, ${tf.y2})`;
  if (tf.type === "steps") return `steps(${tf.count}, ${tf.position})`;
  return "linear()";
}

/** Anything but the identity `linear` keyword gets an easing glyph. */
export function isNonLinear(tf: TimingFunction): boolean {
  return typeof tf === "string" ? tf !== "linear" : true;
}

/** Badge text for a state animation: `machine·state` (or just `state`). */
export function stateBadge(a: TimelineAnimation): string {
  if (!a.state) return "";
  return a.state.machine
    ? `${a.state.machine}·${a.state.state}`
    : a.state.state;
}

export function toggle<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
