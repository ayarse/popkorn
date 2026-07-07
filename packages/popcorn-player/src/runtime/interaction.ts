/**
 * Interaction Manager
 * Tracks mouse hover and active states for interactive nodes.
 *
 * State detection (hit-testing -> hovered/active) lives here; it only sets
 * `node.interactionState`. Turning that state into style overrides is done by
 * `applyInteractionOverrides`, called as the last layer of the per-frame
 * value-resolution pipeline (after base reset, bindings and animation), so
 * hover/active compose on top of a running animation instead of stomping it.
 */

import type { SceneNode, InteractionState } from '../scene/types';
import { hitTest, type Point } from './hit-test';
import type { InputState } from './inputs';

/**
 * Apply a node's interaction-state overrides onto its live render fields.
 * Transform overrides are deltas: translate/rotate additive, scale
 * multiplicative — layered on whatever the animation/binding already produced.
 */
export function applyInteractionOverrides(node: SceneNode): void {
  const state = node.interactionState;
  if (state === 'normal') return;

  // active > hover, falling back to hover styles when no active styles exist.
  const styles =
    state === 'active'
      ? node.activeStyles ?? node.hoverStyles
      : node.hoverStyles;
  if (!styles) return;

  if (styles.fill !== undefined) node.fill = styles.fill;
  if (styles.stroke !== undefined) node.stroke = styles.stroke;
  if (styles.strokeWidth !== undefined) node.strokeWidth = styles.strokeWidth;
  if (styles.opacity !== undefined) node.opacity = styles.opacity;

  const t = styles.transform;
  if (t) {
    if (t.translateX !== undefined) node.transform.translateX += t.translateX;
    if (t.translateY !== undefined) node.transform.translateY += t.translateY;
    if (t.rotate !== undefined) node.transform.rotate += t.rotate;
    if (t.scaleX !== undefined) node.transform.scaleX *= t.scaleX;
    if (t.scaleY !== undefined) node.transform.scaleY *= t.scaleY;
  }
}

/**
 * Manages interaction state for the scene graph.
 * Tracks the hovered and active nodes and records their state on the nodes.
 */
export class InteractionManager {
  private hoveredNode: SceneNode | null = null;
  private activeNode: SceneNode | null = null;
  private sceneRoot: SceneNode | null = null;
  private hasInteractive = false;

  /**
   * Set the scene root for hit-testing
   */
  setScene(root: SceneNode): void {
    this.sceneRoot = root;
    this.hoveredNode = null;
    this.activeNode = null;
    // `interactive` is only ever set at build time, so one walk here lets
    // update() skip the per-frame full-tree hit-test for scenes with no
    // hover/active styles (the common case for Lottie-converted scenes).
    this.hasInteractive = subtreeHasInteractive(root);
  }

  /**
   * Update interaction state based on input
   */
  update(inputState: InputState): void {
    if (!this.sceneRoot || !this.hasInteractive) return;

    const mousePoint: Point = {
      x: inputState.cursor.x,
      y: inputState.cursor.y,
    };

    // Perform hit-test to find node under cursor
    const hitNode = hitTest(this.sceneRoot, mousePoint);

    // Handle mouse button state
    const isPressed = inputState.cursor.isDown;

    // Update hover state
    if (hitNode !== this.hoveredNode) {
      if (this.hoveredNode && this.hoveredNode !== this.activeNode) {
        this.setNodeState(this.hoveredNode, 'normal');
      }
      this.hoveredNode = hitNode;

      if (hitNode && hitNode !== this.activeNode) {
        this.setNodeState(hitNode, 'hover');
      }
    }

    // Handle active state (mouse pressed)
    if (isPressed) {
      if (hitNode && hitNode !== this.activeNode) {
        if (this.activeNode) {
          this.setNodeState(this.activeNode, 'normal');
        }
        this.activeNode = hitNode;
        this.setNodeState(hitNode, 'active');
      }
    } else {
      // Mouse released
      if (this.activeNode) {
        if (this.activeNode === hitNode) {
          this.setNodeState(this.activeNode, 'hover');
        } else {
          this.setNodeState(this.activeNode, 'normal');
        }
        this.activeNode = null;
      }
    }
  }

  /**
   * Record a node's interaction state. Styling happens later in the pipeline.
   */
  private setNodeState(node: SceneNode, state: InteractionState): void {
    node.interactionState = state;
  }

  /**
   * Reset all interaction state
   */
  reset(): void {
    if (this.hoveredNode) {
      this.setNodeState(this.hoveredNode, 'normal');
      this.hoveredNode = null;
    }
    if (this.activeNode) {
      this.setNodeState(this.activeNode, 'normal');
      this.activeNode = null;
    }
  }

  /**
   * Get the currently hovered node
   */
  getHoveredNode(): SceneNode | null {
    return this.hoveredNode;
  }

  /**
   * Get the currently active (pressed) node
   */
  getActiveNode(): SceneNode | null {
    return this.activeNode;
  }
}

function subtreeHasInteractive(node: SceneNode): boolean {
  if (node.interactive) return true;
  return node.children.some(subtreeHasInteractive);
}

/**
 * Create an InteractionManager instance
 */
export function createInteractionManager(): InteractionManager {
  return new InteractionManager();
}
