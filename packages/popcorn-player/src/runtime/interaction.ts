/**
 * Interaction Manager
 * Handles mouse hover and active states for interactive nodes
 */

import type {
  SceneNode,
  InteractionState,
  StateStyles,
  Transform,
} from '../scene/types';
import { cloneTransform } from '../scene/types';
import { hitTest, type Point } from './hit-test';
import type { InputState } from './inputs';

/**
 * Manages interaction state for the scene graph
 * Tracks hovered and active nodes, applies state-specific styles
 */
export class InteractionManager {
  private hoveredNode: SceneNode | null = null;
  private activeNode: SceneNode | null = null;
  private sceneRoot: SceneNode | null = null;

  /**
   * Set the scene root for hit-testing
   */
  setScene(root: SceneNode): void {
    this.sceneRoot = root;
    this.hoveredNode = null;
    this.activeNode = null;
  }

  /**
   * Update interaction state based on input
   */
  update(inputState: InputState): void {
    if (!this.sceneRoot) return;

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
      // Mouse left the previous node
      if (this.hoveredNode && this.hoveredNode !== this.activeNode) {
        this.setNodeState(this.hoveredNode, 'normal');
      }
      this.hoveredNode = hitNode;

      // Mouse entered a new node
      if (hitNode && hitNode !== this.activeNode) {
        this.setNodeState(hitNode, 'hover');
      }
    }

    // Handle active state (mouse pressed)
    if (isPressed) {
      if (hitNode && hitNode !== this.activeNode) {
        // Mouse pressed on a new node
        if (this.activeNode) {
          this.setNodeState(this.activeNode, 'normal');
        }
        this.activeNode = hitNode;
        this.setNodeState(hitNode, 'active');
      }
    } else {
      // Mouse released
      if (this.activeNode) {
        // Check if still hovering over the active node
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
   * Set a node's interaction state and apply appropriate styles
   */
  private setNodeState(node: SceneNode, state: InteractionState): void {
    if (node.interactionState === state) return;

    node.interactionState = state;

    // Apply styles based on state priority: active > hover > normal
    switch (state) {
      case 'active':
        if (node.activeStyles) {
          this.applyStateStyles(node, node.activeStyles);
        } else if (node.hoverStyles) {
          // Fall back to hover styles if no active styles
          this.applyStateStyles(node, node.hoverStyles);
        }
        break;

      case 'hover':
        if (node.hoverStyles) {
          this.applyStateStyles(node, node.hoverStyles);
        }
        break;

      case 'normal':
      default:
        this.restoreBaseStyles(node);
        break;
    }
  }

  /**
   * Apply state-specific styles to a node
   */
  private applyStateStyles(node: SceneNode, styles: StateStyles): void {
    // Apply fill
    if (styles.fill !== undefined) {
      node.fill = styles.fill;
    }

    // Apply stroke
    if (styles.stroke !== undefined) {
      node.stroke = styles.stroke;
    }

    // Apply stroke width
    if (styles.strokeWidth !== undefined) {
      node.strokeWidth = styles.strokeWidth;
    }

    // Apply opacity
    if (styles.opacity !== undefined) {
      node.opacity = styles.opacity;
    }

    // Apply transform overrides
    if (styles.transform) {
      this.applyTransformOverrides(node, styles.transform);
    }
  }

  /**
   * Apply partial transform overrides to a node
   */
  private applyTransformOverrides(node: SceneNode, overrides: Partial<Transform>): void {
    // Start from base transform and apply overrides
    const baseTransform = node.baseTransform;

    if (overrides.translateX !== undefined) {
      node.transform.translateX = baseTransform.translateX + overrides.translateX;
    }
    if (overrides.translateY !== undefined) {
      node.transform.translateY = baseTransform.translateY + overrides.translateY;
    }
    if (overrides.rotate !== undefined) {
      node.transform.rotate = baseTransform.rotate + overrides.rotate;
    }
    if (overrides.scaleX !== undefined) {
      node.transform.scaleX = baseTransform.scaleX * overrides.scaleX;
    }
    if (overrides.scaleY !== undefined) {
      node.transform.scaleY = baseTransform.scaleY * overrides.scaleY;
    }
  }

  /**
   * Restore base styles to a node
   */
  private restoreBaseStyles(node: SceneNode): void {
    node.fill = node.baseFill;
    node.opacity = node.baseOpacity;
    node.transform = cloneTransform(node.baseTransform);
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

/**
 * Create an InteractionManager instance
 */
export function createInteractionManager(): InteractionManager {
  return new InteractionManager();
}
