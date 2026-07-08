/**
 * Interaction Manager
 * Tracks mouse hover and active states for interactive nodes.
 *
 * State detection (hit-testing -> hovered/active) lives here; it only sets
 * `node.interactionState`. Turning that state into style overrides is done by
 * `applyOverrides` / `applyInteractionOverrides`, called as the last layer of
 * the per-frame value-resolution pipeline (after base reset, bindings and
 * animation), so hover/active compose on top of a running animation instead of
 * stomping it.
 *
 * CSS transitions: when a node declares `transition`, a state flip does not snap
 * the affected properties — the manager records a tween (start time + a snapshot
 * of the displayed values) and `applyOverrides` interpolates from that snapshot
 * toward the new state's value each frame. Tween state is wall-clock driven and
 * lives ONLY here, so the animation timeline stays a pure function of time:
 * `seek(t)` twice is identical whenever no interaction state changes.
 */

import type { SceneNode, InteractionState, StateStyles, TransitionSpec } from '../scene/types';
import { hitTest, type Point } from './hit-test';
import type { InputState } from './inputs';
import { lerp, clamp01 } from '../scene/transform';
import { applyEasing } from '../animation/easing';
import { interpolateColor } from '../animation/registry';

// Absolute (already-composed) values of every transitionable property. Transform
// channels are flattened, so a snapshot captures the exact displayed pose.
interface LiveValues {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  translateX: number;
  translateY: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
}

// A running tween toward `node.interactionState`, started when the state flipped.
interface ActiveTransition {
  startTime: number;      // wall-clock ms at the flip
  from: LiveValues;       // displayed values snapshotted at the flip
  specs: TransitionSpec[]; // effective transition list for this change
}

// Transitionable property groups. `transform` covers all five channels together.
const TRANSITION_GROUPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'transform'] as const;
type TransitionGroup = (typeof TRANSITION_GROUPS)[number];

function liveSnapshot(node: SceneNode): LiveValues {
  return {
    fill: node.fill,
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    opacity: node.opacity,
    translateX: node.transform.translateX,
    translateY: node.transform.translateY,
    rotate: node.transform.rotate,
    scaleX: node.transform.scaleX,
    scaleY: node.transform.scaleY,
  };
}

// The StateStyles governing a given interaction state (active falls back to
// hover, matching the runtime priority).
function stateStylesFor(node: SceneNode, state: InteractionState): StateStyles | null {
  if (state === 'active') return node.activeStyles ?? node.hoverStyles;
  if (state === 'hover') return node.hoverStyles;
  return null;
}

// Layer a state's overrides onto a LiveValues struct: paint/opacity/stroke-width
// are absolute; transform is a delta (translate/rotate additive, scale
// multiplicative), matching applyInteractionOverrides.
function applyStateDeltas(vals: LiveValues, styles: StateStyles): void {
  if (styles.fill !== undefined) vals.fill = styles.fill;
  if (styles.stroke !== undefined) vals.stroke = styles.stroke;
  if (styles.strokeWidth !== undefined) vals.strokeWidth = styles.strokeWidth;
  if (styles.opacity !== undefined) vals.opacity = styles.opacity;
  const t = styles.transform;
  if (t) {
    if (t.translateX !== undefined) vals.translateX += t.translateX;
    if (t.translateY !== undefined) vals.translateY += t.translateY;
    if (t.rotate !== undefined) vals.rotate += t.rotate;
    if (t.scaleX !== undefined) vals.scaleX *= t.scaleX;
    if (t.scaleY !== undefined) vals.scaleY *= t.scaleY;
  }
}

// The absolute displayed values for a state, computed against the node's current
// underlying (pre-override) live fields.
function computeStateValues(node: SceneNode, state: InteractionState): LiveValues {
  const vals = liveSnapshot(node);
  const styles = stateStylesFor(node, state);
  if (styles) applyStateDeltas(vals, styles);
  return vals;
}

function writeLive(node: SceneNode, vals: LiveValues): void {
  node.fill = vals.fill;
  node.stroke = vals.stroke;
  node.strokeWidth = vals.strokeWidth;
  node.opacity = vals.opacity;
  node.transform.translateX = vals.translateX;
  node.transform.translateY = vals.translateY;
  node.transform.rotate = vals.rotate;
  node.transform.scaleX = vals.scaleX;
  node.transform.scaleY = vals.scaleY;
}

// The last transition spec that matches a group (CSS: later entries win). `all`
// matches everything; the transform group also matches the individual
// transform property names.
function matchSpec(specs: TransitionSpec[], group: TransitionGroup): TransitionSpec | null {
  let match: TransitionSpec | null = null;
  for (const s of specs) {
    const p = s.property;
    if (
      p === 'all' ||
      p === group ||
      (group === 'transform' && (p === 'translate' || p === 'rotate' || p === 'scale'))
    ) {
      match = s;
    }
  }
  return match;
}

// A color blend for fill/stroke; when either endpoint is null (no paint) there
// is nothing to interpolate, so it snaps to the target once the tween advances.
function mixColor(from: string | null, to: string | null, e: number): string | null {
  if (e >= 1) return to;
  if (e <= 0) return from;
  if (typeof from === 'string' && typeof to === 'string') return interpolateColor(from, to, e);
  return to;
}

/**
 * Apply a node's interaction-state overrides onto its live render fields (no
 * transition — an instant snap). Transform overrides are deltas: translate/
 * rotate additive, scale multiplicative, layered on whatever animation/binding
 * already produced. Used directly by callers that don't manage transitions.
 */
export function applyInteractionOverrides(node: SceneNode): void {
  const state = node.interactionState;
  if (state === 'normal') return;
  const styles = stateStylesFor(node, state);
  if (!styles) return;
  const vals = liveSnapshot(node);
  applyStateDeltas(vals, styles);
  writeLive(node, vals);
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
  // Per-node running transitions (wall-clock driven; not part of the timeline).
  private transitions = new WeakMap<SceneNode, ActiveTransition>();

  /**
   * Set the scene root for hit-testing
   */
  setScene(root: SceneNode): void {
    this.sceneRoot = root;
    this.hoveredNode = null;
    this.activeNode = null;
    this.transitions = new WeakMap();
    // `interactive` is only ever set at build time, so one walk here lets
    // update() skip the per-frame full-tree hit-test for scenes with no
    // hover/active styles (the common case for Lottie-converted scenes).
    this.hasInteractive = subtreeHasInteractive(root);
  }

  /**
   * Update interaction state based on input. `now` is the wall-clock timestamp
   * used to anchor any transition a state flip starts.
   */
  update(inputState: InputState, now: number = performance.now()): void {
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
        this.setNodeState(this.hoveredNode, 'normal', now);
      }
      this.hoveredNode = hitNode;

      if (hitNode && hitNode !== this.activeNode) {
        this.setNodeState(hitNode, 'hover', now);
      }
    }

    // Handle active state (mouse pressed)
    if (isPressed) {
      if (hitNode && hitNode !== this.activeNode) {
        if (this.activeNode) {
          this.setNodeState(this.activeNode, 'normal', now);
        }
        this.activeNode = hitNode;
        this.setNodeState(hitNode, 'active', now);
      }
    } else {
      // Mouse released
      if (this.activeNode) {
        if (this.activeNode === hitNode) {
          this.setNodeState(this.activeNode, 'hover', now);
        } else {
          this.setNodeState(this.activeNode, 'normal', now);
        }
        this.activeNode = null;
      }
    }
  }

  /**
   * Apply a node's interaction overrides for this frame, tweening any running
   * transition toward the current state. Falls back to an instant snap when the
   * node has no active transition. `now` is the wall-clock timestamp.
   */
  applyOverrides(node: SceneNode, now: number = performance.now()): void {
    const active = this.transitions.get(node);
    if (!active) {
      applyInteractionOverrides(node);
      return;
    }

    // Absolute target for the state we're transitioning INTO (== interactionState),
    // computed against the node's current underlying values (pre-override).
    const target = computeStateValues(node, node.interactionState);
    const from = active.from;
    let done = true;

    for (const group of TRANSITION_GROUPS) {
      const spec = matchSpec(active.specs, group);
      let e = 1;
      if (spec) {
        const p = (now - active.startTime - spec.delay) / spec.duration;
        if (p < 1) {
          done = false;
          e = p <= 0 ? 0 : applyEasing(clamp01(p), spec.easing);
        }
      }
      writeGroup(node, group, from, target, e);
    }

    if (done) this.transitions.delete(node);
  }

  /**
   * Record a node's interaction state. When the state flips and a transition
   * governs the change, snapshot the currently displayed values and anchor a
   * tween; otherwise the change snaps. The flip also propagates to any DSL
   * state-children (`#p:hover > #c`), whose overrides are anchored on THIS flip.
   */
  private setNodeState(node: SceneNode, state: InteractionState, now: number): void {
    if (node.interactionState === state) return;
    this.startTween(node, this.effectiveSpecs(node, state), now);
    node.interactionState = state;
    for (const child of node.stateChildren) {
      this.setChildState(child, node, state, now);
    }
  }

  // Flip a state-child alongside its parent. The child mirrors the parent's
  // state so its own (parent-authored) hover/activeStyles resolve in the normal
  // per-node override pass — including active-falls-back-to-hover.
  private setChildState(child: SceneNode, parent: SceneNode, state: InteractionState, now: number): void {
    if (child.interactionState === state) return;
    this.startTween(child, this.childSpecs(child, parent, state), now);
    child.interactionState = state;
  }

  // Anchor (or clear) a node's transition tween: non-empty specs snapshot the
  // currently displayed values; empty specs snap (delete any running tween).
  private startTween(node: SceneNode, specs: TransitionSpec[], now: number): void {
    if (specs.length > 0) {
      this.transitions.set(node, { startTime: now, from: liveSnapshot(node), specs });
    } else {
      this.transitions.delete(node);
    }
  }

  // The transition list governing a change: the entered state's own transitions
  // if it declared any (CSS asymmetric enter/exit), else the node-level ones.
  private effectiveSpecs(node: SceneNode, state: InteractionState): TransitionSpec[] {
    if (state === 'hover' && node.hoverStyles?.transitions?.length) return node.hoverStyles.transitions;
    if (state === 'active') {
      const s = node.activeStyles?.transitions ?? node.hoverStyles?.transitions;
      if (s?.length) return s;
    }
    return node.transitions;
  }

  // A state-child's tween fallback: its own node-level `transition:` if it has
  // one, else the `transition:` declared inside the parent's state block (which
  // governs the children it lists; active falls back to hover), else snap.
  private childSpecs(child: SceneNode, parent: SceneNode, state: InteractionState): TransitionSpec[] {
    if (child.transitions.length) return child.transitions;
    const block = state === 'active'
      ? (parent.activeStyles?.transitions ?? parent.hoverStyles?.transitions)
      : parent.hoverStyles?.transitions;
    return block ?? [];
  }

  /**
   * Reset all interaction state
   */
  reset(): void {
    if (this.hoveredNode) {
      this.setNodeState(this.hoveredNode, 'normal', performance.now());
      this.hoveredNode = null;
    }
    if (this.activeNode) {
      this.setNodeState(this.activeNode, 'normal', performance.now());
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

// Blend one transitionable group from `from` toward `target` at eased progress
// `e` (e >= 1 snaps to target) and write it onto the node.
function writeGroup(
  node: SceneNode,
  group: TransitionGroup,
  from: LiveValues,
  target: LiveValues,
  e: number
): void {
  switch (group) {
    case 'fill':
      node.fill = mixColor(from.fill, target.fill, e);
      break;
    case 'stroke':
      node.stroke = mixColor(from.stroke, target.stroke, e);
      break;
    case 'stroke-width':
      node.strokeWidth = lerp(from.strokeWidth, target.strokeWidth, e);
      break;
    case 'opacity':
      node.opacity = lerp(from.opacity, target.opacity, e);
      break;
    case 'transform':
      node.transform.translateX = lerp(from.translateX, target.translateX, e);
      node.transform.translateY = lerp(from.translateY, target.translateY, e);
      node.transform.rotate = lerp(from.rotate, target.rotate, e);
      node.transform.scaleX = lerp(from.scaleX, target.scaleX, e);
      node.transform.scaleY = lerp(from.scaleY, target.scaleY, e);
      break;
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
