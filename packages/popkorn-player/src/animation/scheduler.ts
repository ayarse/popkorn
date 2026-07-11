import type {
  AnimationDirection,
  AnimationInstance,
  SceneNode,
} from "../scene/types";
import { interpolateKeyframes } from "./keyframes";

/**
 * Animation scheduler.
 *
 * A single global timeline: every animation instance is anchored to one
 * timeline zero (set at play/reset), so sampling is a pure function of time.
 * The scheduler owns nothing on the nodes — given a time `t` it writes the
 * animation layer of the value-resolution pipeline onto nodes that have already
 * been reset to base. This makes seek/pause/resume trivial and deterministic.
 */
export class AnimationScheduler {
  // performance.now() value that corresponds to timeline t = 0.
  private timelineZero: number = 0;
  private paused: boolean = false;
  // Timeline time held while paused / after an explicit seek.
  private pausedTime: number = 0;

  /** Begin a fresh timeline at t = 0. */
  start(now: number = performance.now()): void {
    this.timelineZero = now;
    this.paused = false;
    this.pausedTime = 0;
  }

  /** Freeze the timeline (position preserved). */
  stop(now: number = performance.now()): void {
    if (!this.paused) {
      this.pausedTime = now - this.timelineZero;
      this.paused = true;
    }
  }

  pause(now: number = performance.now()): void {
    this.stop(now);
  }

  resume(now: number = performance.now()): void {
    if (this.paused) {
      this.timelineZero = now - this.pausedTime;
      this.paused = false;
    }
  }

  /** Jump the timeline to `ms`. Works whether playing or paused. */
  seek(ms: number, now: number = performance.now()): void {
    this.pausedTime = ms;
    this.timelineZero = now - ms;
  }

  /** Current timeline time in ms. */
  time(now: number = performance.now()): number {
    return this.paused ? this.pausedTime : now - this.timelineZero;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Reset the timeline to zero. */
  reset(now: number = performance.now()): void {
    this.start(now);
  }

  /**
   * Apply the animation layer for a single node at timeline time `t`.
   * Assumes the node has already been reset to base and had bindings applied.
   *
   * Entry-time anchoring (state machines): a state animation that must play as
   * if it started at the state's entry time is sampled with `sampleNode(node,
   * t - entryTime)`. Because sampling is a pure function of time, subtracting
   * the entry time simply shifts timeline zero — `delay`, `direction`, and
   * `fillMode` all resolve relative to that shifted origin. Before entry the
   * shifted time is negative, which lands in the pre-start branch below:
   * `backwards`/`both` hold the first keyframe, `none`/`forwards` leave the node
   * at base. No separate anchoring machinery is needed.
   */
  sampleNode(node: SceneNode, t: number): void {
    for (const animation of node.animations) {
      this.sampleAnimation(node, animation, t);
    }
  }

  private sampleAnimation(
    node: SceneNode,
    animation: AnimationInstance,
    t: number,
  ): void {
    const {
      keyframes,
      delay,
      duration,
      iterationCount,
      timingFunction,
      fillMode,
      composition,
    } = animation;
    if (keyframes.length === 0) return;

    const local = t - delay;
    const finite = iterationCount !== Infinity;
    const total = finite ? duration * iterationCount : Infinity;

    if (local < 0) {
      // Delay period: `backwards`/`both` hold the first-keyframe value.
      if (fillMode === "backwards" || fillMode === "both") {
        interpolateKeyframes(
          node,
          keyframes,
          this.startProgress(animation),
          timingFunction,
          composition,
        );
      }
      return;
    }

    if (finite && local >= total) {
      // After the active interval: `forwards`/`both` hold the final value;
      // `none`/`backwards` revert to base (leave the node untouched here).
      if (fillMode === "forwards" || fillMode === "both") {
        interpolateKeyframes(
          node,
          keyframes,
          this.endProgress(animation),
          timingFunction,
          composition,
        );
      }
      return;
    }

    const progress = this.calculateProgress(animation, local);
    interpolateKeyframes(
      node,
      keyframes,
      progress,
      timingFunction,
      composition,
    );
  }

  private calculateProgress(
    animation: AnimationInstance,
    elapsed: number,
  ): number {
    const { duration, iterationCount, direction } = animation;

    const iteration = Math.floor(elapsed / duration);
    const iterationProgress = (elapsed % duration) / duration;

    if (iterationCount !== Infinity && iteration >= iterationCount) {
      return this.applyDirection(1, iterationCount - 1, direction);
    }

    return this.applyDirection(iterationProgress, iteration, direction);
  }

  private applyDirection(
    progress: number,
    iteration: number,
    direction: AnimationDirection,
  ): number {
    switch (direction) {
      case "normal":
        return progress;
      case "reverse":
        return 1 - progress;
      case "alternate":
        return iteration % 2 === 0 ? progress : 1 - progress;
      case "alternate-reverse":
        return iteration % 2 === 0 ? 1 - progress : progress;
      default:
        return progress;
    }
  }

  // Progress shown at the very start of the timeline (for `backwards` fill).
  private startProgress(animation: AnimationInstance): number {
    return this.applyDirection(0, 0, animation.direction);
  }

  // Progress held after the animation finishes (for `forwards` fill).
  private endProgress(animation: AnimationInstance): number {
    const { direction, iterationCount } = animation;
    switch (direction) {
      case "reverse":
        return 0;
      case "alternate":
        return iterationCount % 2 === 0 ? 0 : 1;
      case "alternate-reverse":
        return iterationCount % 2 === 0 ? 1 : 0;
      case "normal":
      default:
        return 1;
    }
  }
}

/**
 * Total scene duration in ms: the latest end time across every animation in the
 * tree, where an animation ends at `delay + duration * iterations`. An infinite
 * (`infinite`) animation counts as ONE iteration, so a looping scene still has a
 * finite period to wrap on. Returns 0 when the scene has no animations.
 */
export function computeSceneDuration(root: SceneNode): number {
  let max = 0;
  const visit = (node: SceneNode): void => {
    for (const a of node.animations) {
      const iterations = a.iterationCount === Infinity ? 1 : a.iterationCount;
      const end = a.delay + a.duration * iterations;
      if (end > max) max = end;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return max;
}

/**
 * Local time at which every instance in `instances` has finished, i.e.
 * `max(delay + duration * iterationCount)`. Returns `Infinity` if any instance
 * loops forever (`iterationCount === Infinity`) OR the list is empty.
 *
 * Powers the `on complete` state-machine trigger: a state completes when
 * `localTime - entryTime >= animationsEndTime(stateInstances)`. The empty-list
 * case returns `Infinity` deliberately — a state with no animations has no
 * completion moment, so `on complete` from it never fires (an empty state is a
 * terminal/idle state, not an instantly-completing one). This differs from
 * `computeSceneDuration`, which treats an infinite animation as ONE iteration
 * to get a finite wrap period; completion detection must instead never fire for
 * an animation that never ends.
 */
export function animationsEndTime(instances: AnimationInstance[]): number {
  if (instances.length === 0) return Infinity;
  let max = 0;
  for (const a of instances) {
    if (a.iterationCount === Infinity) return Infinity;
    const end = a.delay + a.duration * a.iterationCount;
    if (end > max) max = end;
  }
  return max;
}

/**
 * Scrub one animation instance to a normalized `progress` (for
 * `animation-timeline`), writing the animation layer onto an already-reset node.
 *
 * Semantics (per the state-machines spec): `progress` is the playhead, not the
 * clock. It clamps to [0,1] and maps across exactly ONE iteration of the
 * keyframes. `delay`, `iterationCount`, and fill modes are all ignored — there
 * is no timeline, so nothing to delay, repeat, or fill. `direction` is still
 * respected: `reverse`/`alternate-reverse` mirror progress (iteration 0), while
 * `normal`/`alternate` pass it through. Per-keyframe easing and
 * `animation-composition` apply exactly as in clock-driven sampling because we
 * reuse `interpolateKeyframes`, the shared interpolation core.
 */
export function sampleInstanceAtProgress(
  node: SceneNode,
  instance: AnimationInstance,
  progress: number,
): void {
  const { keyframes, timingFunction, composition, direction } = instance;
  if (keyframes.length === 0) return;
  const p = Math.max(0, Math.min(1, progress));
  // Single iteration (iteration 0): normal/alternate keep p; reverse and
  // alternate-reverse mirror it. Matches AnimationScheduler.applyDirection(p, 0, …).
  const directed =
    direction === "reverse" || direction === "alternate-reverse" ? 1 - p : p;
  interpolateKeyframes(node, keyframes, directed, timingFunction, composition);
}

/** Scrub every animation on a node to `progress`. See sampleInstanceAtProgress. */
export function sampleNodeAtProgress(node: SceneNode, progress: number): void {
  for (const instance of node.animations) {
    sampleInstanceAtProgress(node, instance, progress);
  }
}
