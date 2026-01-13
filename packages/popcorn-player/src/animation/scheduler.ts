import type { SceneNode, AnimationInstance, AnimationDirection } from '../scene/types';
import { cloneTransform } from '../scene/types';
import { interpolateKeyframes } from './keyframes';

/**
 * Animation scheduler - updates all animations in the scene graph
 */
export class AnimationScheduler {
  private startTime: number = 0;
  private isRunning: boolean = false;

  start(): void {
    this.startTime = performance.now();
    this.isRunning = true;
  }

  stop(): void {
    this.isRunning = false;
  }

  /**
   * Update all animations in the scene graph
   * @param root Root scene node
   * @param timestamp Current timestamp (from requestAnimationFrame)
   */
  update(root: SceneNode, timestamp: number): void {
    if (!this.isRunning) return;

    const elapsed = timestamp - this.startTime;
    this.updateNode(root, elapsed);
  }

  private updateNode(node: SceneNode, elapsed: number): void {
    // Update this node's animations
    for (const animation of node.animations) {
      if (!animation.isRunning) continue;

      // Initialize start time if not set
      if (animation.startTime === 0) {
        animation.startTime = elapsed;
      }

      // Calculate animation progress
      const animationElapsed = elapsed - animation.startTime - animation.delay;

      if (animationElapsed < 0) {
        // Still in delay period
        continue;
      }

      const progress = this.calculateProgress(animation, animationElapsed);

      // Interpolate keyframes and apply to node
      // Pass the animation's timing function as the default for keyframes without their own easing
      // Per-keyframe easing is applied within interpolateKeyframes
      const interpolated = interpolateKeyframes(
        animation.keyframes,
        progress,
        node,
        animation.timingFunction
      );

      if (interpolated.transform) {
        node.transform = interpolated.transform;
      }
      if (interpolated.opacity !== undefined) {
        node.opacity = interpolated.opacity;
      }
      if (interpolated.fill !== undefined) {
        node.fill = interpolated.fill;
      }

      // Check if animation has completed
      if (animation.iterationCount !== Infinity) {
        const totalDuration = animation.duration * animation.iterationCount;
        if (animationElapsed >= totalDuration) {
          animation.isRunning = false;
          // Reset to final state
          this.applyFinalState(node, animation);
        }
      }
    }

    // Update children
    for (const child of node.children) {
      this.updateNode(child, elapsed);
    }
  }

  private calculateProgress(animation: AnimationInstance, elapsed: number): number {
    const { duration, iterationCount, direction } = animation;

    // Calculate which iteration we're on
    const iteration = Math.floor(elapsed / duration);
    const iterationProgress = (elapsed % duration) / duration;

    // Check if we've exceeded iteration count
    if (iterationCount !== Infinity && iteration >= iterationCount) {
      // Return final progress
      return this.applyDirection(1, iterationCount - 1, direction);
    }

    return this.applyDirection(iterationProgress, iteration, direction);
  }

  private applyDirection(
    progress: number,
    iteration: number,
    direction: AnimationDirection
  ): number {
    switch (direction) {
      case 'normal':
        return progress;
      case 'reverse':
        return 1 - progress;
      case 'alternate':
        return iteration % 2 === 0 ? progress : 1 - progress;
      case 'alternate-reverse':
        return iteration % 2 === 0 ? 1 - progress : progress;
      default:
        return progress;
    }
  }

  private applyFinalState(node: SceneNode, animation: AnimationInstance): void {
    const { direction, iterationCount, keyframes } = animation;

    if (keyframes.length === 0) return;

    // Determine final progress based on direction and iteration count
    let finalProgress: number;

    switch (direction) {
      case 'normal':
        finalProgress = 1;
        break;
      case 'reverse':
        finalProgress = 0;
        break;
      case 'alternate':
        finalProgress = iterationCount % 2 === 0 ? 0 : 1;
        break;
      case 'alternate-reverse':
        finalProgress = iterationCount % 2 === 0 ? 1 : 0;
        break;
      default:
        finalProgress = 1;
    }

    const interpolated = interpolateKeyframes(keyframes, finalProgress, node);

    if (interpolated.transform) {
      node.transform = interpolated.transform;
    }
    if (interpolated.opacity !== undefined) {
      node.opacity = interpolated.opacity;
    }
    if (interpolated.fill !== undefined) {
      node.fill = interpolated.fill;
    }
  }

  /**
   * Reset all animations to their initial state
   */
  reset(root: SceneNode): void {
    this.resetNode(root);
    this.startTime = performance.now();
  }

  private resetNode(node: SceneNode): void {
    // Reset to base values
    node.transform = cloneTransform(node.baseTransform);
    node.fill = node.baseFill;
    node.opacity = node.baseOpacity;

    // Reset animation state
    for (const animation of node.animations) {
      animation.startTime = 0;
      animation.currentTime = 0;
      animation.isRunning = true;
    }

    // Reset children
    for (const child of node.children) {
      this.resetNode(child);
    }
  }
}

// Singleton instance
let scheduler: AnimationScheduler | null = null;

export function getAnimationScheduler(): AnimationScheduler {
  if (!scheduler) {
    scheduler = new AnimationScheduler();
  }
  return scheduler;
}

export function createAnimationScheduler(): AnimationScheduler {
  return new AnimationScheduler();
}
