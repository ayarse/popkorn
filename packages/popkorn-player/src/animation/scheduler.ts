import { clamp01 } from "../scene/transform.js";
import type {
  AnimationDirection,
  AnimationInstance,
  SceneNode,
} from "../scene/types.js";
import { interpolateKeyframes } from "./keyframes.js";

// Iteration progress as played under `direction`.
function applyDirection(
  progress: number,
  iteration: number,
  direction: AnimationDirection,
): number {
  switch (direction) {
    case "reverse":
      return 1 - progress;
    case "alternate":
      return iteration % 2 === 0 ? progress : 1 - progress;
    case "alternate-reverse":
      return iteration % 2 === 0 ? 1 - progress : progress;
  }
  return progress;
}

// One global timeline: sampling is a pure function of time onto base-reset nodes.
export class AnimationScheduler {
  // performance.now() at timeline t = 0.
  private timelineZero: number = 0;
  private paused: boolean = false;
  // Timeline time held while paused / after an explicit seek.
  private pausedTime: number = 0;

  start(now: number = performance.now()): void {
    this.timelineZero = now;
    this.paused = false;
    this.pausedTime = 0;
  }

  /** Position preserved. */
  stop(now: number = performance.now()): void {
    if (!this.paused) {
      this.pausedTime = now - this.timelineZero;
      this.paused = true;
    }
  }

  resume(now: number = performance.now()): void {
    if (this.paused) {
      this.timelineZero = now - this.pausedTime;
      this.paused = false;
    }
  }

  seek(ms: number, now: number = performance.now()): void {
    this.pausedTime = ms;
    this.timelineZero = now - ms;
  }

  time(now: number = performance.now()): number {
    return this.paused ? this.pausedTime : now - this.timelineZero;
  }

  isPaused(): boolean {
    return this.paused;
  }

  // State machines sample at `t - entryTime`; pre-entry lands in the pre-start fill branch.
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
      tracks,
      delay,
      duration,
      iterationCount,
      timingFunction,
      fillMode,
      composition,
    } = animation;
    if (tracks.length === 0) return;

    const local = t - delay;
    const finite = iterationCount !== Infinity;
    const total = finite ? duration * iterationCount : Infinity;

    if (local < 0) {
      // Delay period: `backwards`/`both` hold the first-keyframe value.
      if (fillMode === "backwards" || fillMode === "both") {
        interpolateKeyframes(
          node,
          tracks,
          this.startProgress(animation),
          timingFunction,
          composition,
        );
      }
      return;
    }

    if (finite && local >= total) {
      // Past the end: `forwards`/`both` hold the final value, else stay at base.
      if (fillMode === "forwards" || fillMode === "both") {
        interpolateKeyframes(
          node,
          tracks,
          this.endProgress(animation),
          timingFunction,
          composition,
        );
      }
      return;
    }

    const progress = this.calculateProgress(animation, local);
    interpolateKeyframes(node, tracks, progress, timingFunction, composition);
  }

  private calculateProgress(
    animation: AnimationInstance,
    elapsed: number,
  ): number {
    const { duration, iterationCount, direction } = animation;

    const iteration = Math.floor(elapsed / duration);
    const iterationProgress = (elapsed % duration) / duration;

    if (iterationCount !== Infinity && iteration >= iterationCount) {
      return applyDirection(1, iterationCount - 1, direction);
    }

    return applyDirection(iterationProgress, iteration, direction);
  }

  // For `backwards` fill.
  private startProgress(animation: AnimationInstance): number {
    return applyDirection(0, 0, animation.direction);
  }

  // For `forwards` fill.
  private endProgress(animation: AnimationInstance): number {
    const { direction, iterationCount } = animation;
    switch (direction) {
      case "reverse":
        return 0;
      case "alternate":
        return iterationCount % 2 === 0 ? 0 : 1;
      case "alternate-reverse":
        return iterationCount % 2 === 0 ? 1 : 0;
      default:
        return 1;
    }
  }
}

// Latest `delay + duration * iterations` in the tree; infinite counts as one iteration. 0 if none.
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

// When all instances finish; Infinity if any loops or the list is empty (`on complete` never fires).
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

// Scrub one instance to `progress` (animation-timeline): one iteration, direction honored, delay/fill ignored.
export function sampleInstanceAtProgress(
  node: SceneNode,
  instance: AnimationInstance,
  progress: number,
): void {
  const { tracks, timingFunction, composition, direction } = instance;
  if (tracks.length === 0) return;
  // Single iteration: reverse/alternate-reverse mirror progress.
  const directed = applyDirection(clamp01(progress), 0, direction);
  interpolateKeyframes(node, tracks, directed, timingFunction, composition);
}

export function sampleNodeAtProgress(node: SceneNode, progress: number): void {
  for (const instance of node.animations) {
    sampleInstanceAtProgress(node, instance, progress);
  }
}
