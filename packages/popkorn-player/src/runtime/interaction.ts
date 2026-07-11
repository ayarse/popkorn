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
 * of the displayed value of every property the node's states can touch) and
 * `applyOverrides` interpolates from that snapshot toward the new state's value
 * each frame. Every registry property is transitionable (not just the legacy
 * fill/stroke/stroke-width/opacity/transform six): numerics and colors blend,
 * object-valued endpoints that can't blend (incompatible gradients/paths) flip
 * at the eased midpoint (CSS discrete-transition rule). Tween state is wall-clock
 * driven and lives ONLY here, so the animation timeline stays a pure function of
 * time: `seek(t)` twice is identical whenever no interaction state changes.
 */

import { applyEasing } from "../animation/easing";
import {
  filtersCompatible,
  getPropHandler,
  gradientsCompatible,
  interpolateProp,
  isFilterList,
  type PropHandler,
  type PropValue,
  pathsCompatible,
} from "../animation/registry";
import { cloneGradient, isGradientData } from "../renderer/types";
import { clamp01 } from "../scene/transform";
import type {
  InteractionState,
  NodeStateStyle,
  SceneNode,
  StateStyles,
  TransitionSpec,
} from "../scene/types";
import { hitTest, type Point } from "./hit-test";
import type { InputState } from "./inputs";

// A running tween toward `node.interactionState`, started when the state flipped.
interface ActiveTransition {
  startTime: number; // wall-clock ms at the flip
  from: Map<string, PropValue | null>; // displayed value per involved prop at the flip
  specs: TransitionSpec[]; // effective transition list for this change
}

// Transform channels are registry properties but tween as deltas, and the CSS
// `transition-property` names translate/rotate/scale/transform all govern them.
const TRANSFORM_CHANNELS = new Set([
  "translateX",
  "translateY",
  "rotate",
  "scaleX",
  "scaleY",
]);

// The StateStyles governing a given interaction state (active falls back to
// hover, matching the runtime priority).
function stateStylesFor(
  node: SceneNode,
  state: InteractionState,
): StateStyles | null {
  if (state === "active") return node.activeStyles ?? node.hoverStyles;
  if (state === "hover") return node.hoverStyles;
  return null;
}

// Every registry-property key a state block can touch, folded into `out`. The
// legacy fields map onto their registry names (paint gradient or solid -> the
// color property; each declared transform channel -> its channel key).
function collectInvolvedKeys(
  styles: StateStyles | null | undefined,
  out: Set<string>,
): void {
  if (!styles) return;
  if (styles.fill !== undefined || styles.fillGradient !== undefined)
    out.add("fill");
  if (styles.stroke !== undefined || styles.strokeGradient !== undefined)
    out.add("stroke");
  if (styles.strokeWidth !== undefined) out.add("stroke-width");
  if (styles.opacity !== undefined) out.add("opacity");
  const t = styles.transform;
  if (t) {
    if (t.translateX !== undefined) out.add("translateX");
    if (t.translateY !== undefined) out.add("translateY");
    if (t.rotate !== undefined) out.add("rotate");
    if (t.scaleX !== undefined) out.add("scaleX");
    if (t.scaleY !== undefined) out.add("scaleY");
  }
  if (styles.overrides) for (const k in styles.overrides) out.add(k);
}

// Every registry-property key a machine `:state()` entry can touch: its static
// declarations (via collectInvolvedKeys) plus every property named by its
// entry-anchored animations' keyframes. Used to bound a mix cross-fade to the
// channels the two states actually drive.
export function involvedStateKeys(
  entry: NodeStateStyle,
  out: Set<string>,
): void {
  collectInvolvedKeys(entry.styles, out);
  for (const anim of entry.animations)
    for (const kf of anim.keyframes)
      for (const key in kf.properties) out.add(key);
}

// Read the current LIVE (post-animation, pre-override) value of a property as an
// interpolation endpoint. Numerics (incl. transform channels) go through the
// registry's readLive; paint reads the gradient-or-solid the node currently
// shows (gradient deep-copied so the snapshot is never aliased onto authored
// state); path props read their live command list.
export function readLiveProp(node: SceneNode, key: string): PropValue | null {
  if (key === "fill")
    return node.fillGradient ? cloneGradient(node.fillGradient) : node.fill;
  if (key === "stroke")
    return node.strokeGradient
      ? cloneGradient(node.strokeGradient)
      : node.stroke;
  const h = getPropHandler(key);
  if (h?.readLive) return h.readLive(node);
  if (key === "d")
    return node.shapeData.type === "path" ? node.shapeData.commands : null;
  if (key === "clip-path")
    return node.clipPath?.type === "path" ? node.clipPath.commands : null;
  return null;
}

// The value a state drives `key` to, computed against the node's current
// underlying live fields. Transform channels compose as deltas (translate/rotate
// additive, scale multiplicative) — the deliberate divergence from CSS replace;
// paint clears the opposite (gradient/solid) channel; everything else replaces.
// A key the state doesn't touch holds the underlying live value (so it tweens
// back to the base when leaving the state).
function stateTargetProp(
  node: SceneNode,
  styles: StateStyles | null,
  key: string,
): PropValue | null {
  switch (key) {
    case "translateX":
      return node.transform.translateX + (styles?.transform?.translateX ?? 0);
    case "translateY":
      return node.transform.translateY + (styles?.transform?.translateY ?? 0);
    case "rotate":
      return node.transform.rotate + (styles?.transform?.rotate ?? 0);
    case "scaleX":
      return node.transform.scaleX * (styles?.transform?.scaleX ?? 1);
    case "scaleY":
      return node.transform.scaleY * (styles?.transform?.scaleY ?? 1);
  }
  if (styles) {
    switch (key) {
      case "fill":
        if (styles.fillGradient !== undefined)
          return styles.fillGradient
            ? cloneGradient(styles.fillGradient)
            : null;
        if (styles.fill !== undefined) return styles.fill;
        break;
      case "stroke":
        if (styles.strokeGradient !== undefined)
          return styles.strokeGradient
            ? cloneGradient(styles.strokeGradient)
            : null;
        if (styles.stroke !== undefined) return styles.stroke;
        break;
      case "stroke-width":
        if (styles.strokeWidth !== undefined) return styles.strokeWidth;
        break;
      case "opacity":
        if (styles.opacity !== undefined) return styles.opacity;
        break;
      default:
        if (styles.overrides && key in styles.overrides)
          return styles.overrides[key];
    }
  }
  return readLiveProp(node, key);
}

// The last transition spec that matches a property (CSS: later entries win).
// `all` matches everything; the transform channels also match the CSS group
// names translate/rotate/scale and the `transform` shorthand.
function matchSpec(
  specs: TransitionSpec[],
  key: string,
): TransitionSpec | null {
  const isTransform = TRANSFORM_CHANNELS.has(key);
  let match: TransitionSpec | null = null;
  for (const s of specs) {
    const p = s.property;
    if (
      p === "all" ||
      p === key ||
      (isTransform &&
        (p === "transform" ||
          p === "translate" ||
          p === "rotate" ||
          p === "scale"))
    ) {
      match = s;
    }
  }
  return match;
}

// Two endpoints blend smoothly iff same-typed and structurally compatible;
// otherwise the caller flips discretely at the midpoint. Colors are strings, so
// two strings (or two numbers) always blend.
function blendable(from: PropValue | null, to: PropValue | null): boolean {
  if (isGradientData(from) || isGradientData(to)) {
    return (
      isGradientData(from) &&
      isGradientData(to) &&
      gradientsCompatible(from, to)
    );
  }
  if (isFilterList(from) || isFilterList(to)) {
    return (
      isFilterList(from) && isFilterList(to) && filtersCompatible(from, to)
    );
  }
  if (Array.isArray(from) || Array.isArray(to)) {
    return (
      Array.isArray(from) && Array.isArray(to) && pathsCompatible(from, to)
    );
  }
  if (typeof from === "number" && typeof to === "number") return true;
  if (typeof from === "string" && typeof to === "string") return true;
  return false;
}

// Blend one property from `from` toward `to` at eased progress `e`. Blendable
// endpoints interpolate (numbers/colors/compatible gradients+paths); the rest
// step discretely at the eased midpoint (CSS discrete transition).
export function blendProp(
  handler: PropHandler,
  from: PropValue | null,
  to: PropValue | null,
  e: number,
): PropValue | null {
  if (e >= 1) return to;
  if (e <= 0) return from;
  if (!blendable(from, to)) return e < 0.5 ? from : to;
  return interpolateProp(handler, from, to, e);
}

// Write a resolved value onto the node. Paint keeps the gradient/solid channels
// mutually exclusive (a gradient clears the solid and vice-versa); every other
// property goes straight through its registry handler (which sets its own dirty
// flags — invariant #3).
export function writeProp(
  node: SceneNode,
  key: string,
  value: PropValue | null,
): void {
  if (key === "fill") {
    if (isGradientData(value)) {
      node.fillGradient = value;
      node.fill = null;
    } else {
      node.fillGradient = null;
      node.fill = (value as string | null) ?? null;
    }
    return;
  }
  if (key === "stroke") {
    if (isGradientData(value)) {
      node.strokeGradient = value;
      node.stroke = null;
    } else {
      node.strokeGradient = null;
      node.stroke = (value as string | null) ?? null;
    }
    return;
  }
  if (value != null) getPropHandler(key)!.apply(node, value);
}

/**
 * Apply a node's interaction-state overrides onto its live render fields (no
 * transition — an instant snap). Transform overrides are deltas: translate/
 * rotate additive, scale multiplicative, layered on whatever animation/binding
 * already produced. Used directly by callers that don't manage transitions.
 */
export function applyInteractionOverrides(node: SceneNode): void {
  const state = node.interactionState;
  if (state === "normal") return;
  const styles = stateStylesFor(node, state);
  if (styles) applyStateStyles(node, styles);
}

/**
 * Layer a StateStyles set onto a node's current live fields (paint/opacity/
 * stroke-width absolute, transform channels as deltas) with no tween. Shared by
 * interaction (:hover/:active) and machine `:state()` merging so both use the
 * same override semantics.
 */
export function applyStateStyles(node: SceneNode, styles: StateStyles): void {
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
  applyStatePaint(node, styles);
  // Generic registry-backed overrides (everything outside the legacy channels):
  // snap each parsed endpoint straight in via its handler, which sets any dirty
  // flags (outline length, polystar, text bounds) itself — invariant #3. Runs
  // every frame after base-reset, so releasing the state reverts automatically.
  if (styles.overrides) {
    for (const key in styles.overrides) {
      getPropHandler(key)!.apply(node, styles.overrides[key]);
    }
  }
}

/**
 * Apply a state's gradient/solid paint override, replacing whatever paint the
 * base carries. A gradient override wins over any solid channel (and vice
 * versa), so entering a state with a gradient fill clears node.fill and setting
 * a solid fill clears node.fillGradient — otherwise a base gradient would keep
 * winning (the renderer prefers gradient when both are set). The gradient is
 * DEEP-COPIED so this shared StateStyles object is never aliased onto the node:
 * resolveNode re-applies fresh each frame and a later in-place gradient
 * interpolation must not corrupt the authored state stops (same discipline as
 * the base-snapshot gradient clone). This is the instant-snap path (:state() and
 * non-transitioning :hover/:active); the transition-tween path smoothly blends
 * compatible gradients and flips incompatible ones at the eased midpoint.
 */
function applyStatePaint(node: SceneNode, styles: StateStyles): void {
  if (styles.fillGradient !== undefined) {
    node.fillGradient = cloneGradient(styles.fillGradient);
    node.fill = null;
  } else if (styles.fill !== undefined) {
    node.fill = styles.fill;
    node.fillGradient = null;
  }
  if (styles.strokeGradient !== undefined) {
    node.strokeGradient = cloneGradient(styles.strokeGradient);
    node.stroke = null;
  } else if (styles.stroke !== undefined) {
    node.stroke = styles.stroke;
    node.strokeGradient = null;
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
        this.setNodeState(this.hoveredNode, "normal", now);
      }
      this.hoveredNode = hitNode;

      if (hitNode && hitNode !== this.activeNode) {
        this.setNodeState(hitNode, "hover", now);
      }
    }

    // Handle active state (mouse pressed)
    if (isPressed) {
      if (hitNode && hitNode !== this.activeNode) {
        if (this.activeNode) {
          this.setNodeState(this.activeNode, "normal", now);
        }
        this.activeNode = hitNode;
        this.setNodeState(hitNode, "active", now);
      }
    } else {
      // Mouse released
      if (this.activeNode) {
        if (this.activeNode === hitNode) {
          this.setNodeState(this.activeNode, "hover", now);
        } else {
          this.setNodeState(this.activeNode, "normal", now);
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

    // Values are resolved against the state we're transitioning INTO (==
    // interactionState), computed per-property against the node's current
    // underlying (pre-override) live fields.
    const styles = stateStylesFor(node, node.interactionState);
    let done = true;

    for (const [key, fromVal] of active.from) {
      const spec = matchSpec(active.specs, key);
      let e = 1;
      if (spec) {
        const p = (now - active.startTime - spec.delay) / spec.duration;
        if (p < 1) {
          done = false;
          e = p <= 0 ? 0 : applyEasing(clamp01(p), spec.easing);
        }
      }
      const target = stateTargetProp(node, styles, key);
      writeProp(node, key, blendProp(getPropHandler(key)!, fromVal, target, e));
    }

    if (done) this.transitions.delete(node);
  }

  /**
   * Record a node's interaction state. When the state flips and a transition
   * governs the change, snapshot the currently displayed values and anchor a
   * tween; otherwise the change snaps. The flip also propagates to any DSL
   * state-children (`#p:hover > #c`), whose overrides are anchored on THIS flip.
   */
  private setNodeState(
    node: SceneNode,
    state: InteractionState,
    now: number,
  ): void {
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
  private setChildState(
    child: SceneNode,
    parent: SceneNode,
    state: InteractionState,
    now: number,
  ): void {
    if (child.interactionState === state) return;
    this.startTween(child, this.childSpecs(child, parent, state), now);
    child.interactionState = state;
  }

  // Anchor (or clear) a node's transition tween: non-empty specs snapshot the
  // currently displayed value of every property the node's states can touch;
  // empty specs snap (delete any running tween).
  private startTween(
    node: SceneNode,
    specs: TransitionSpec[],
    now: number,
  ): void {
    if (specs.length > 0) {
      const keys = new Set<string>();
      collectInvolvedKeys(node.hoverStyles, keys);
      collectInvolvedKeys(node.activeStyles, keys);
      const from = new Map<string, PropValue | null>();
      for (const key of keys) from.set(key, readLiveProp(node, key));
      this.transitions.set(node, { startTime: now, from, specs });
    } else {
      this.transitions.delete(node);
    }
  }

  // The transition list governing a change: the entered state's own transitions
  // if it declared any (CSS asymmetric enter/exit), else the node-level ones.
  private effectiveSpecs(
    node: SceneNode,
    state: InteractionState,
  ): TransitionSpec[] {
    if (state === "hover" && node.hoverStyles?.transitions?.length)
      return node.hoverStyles.transitions;
    if (state === "active") {
      const s = node.activeStyles?.transitions ?? node.hoverStyles?.transitions;
      if (s?.length) return s;
    }
    return node.transitions;
  }

  // A state-child's tween fallback: its own node-level `transition:` if it has
  // one, else the `transition:` declared inside the parent's state block (which
  // governs the children it lists; active falls back to hover), else snap.
  private childSpecs(
    child: SceneNode,
    parent: SceneNode,
    state: InteractionState,
  ): TransitionSpec[] {
    if (child.transitions.length) return child.transitions;
    const block =
      state === "active"
        ? (parent.activeStyles?.transitions ?? parent.hoverStyles?.transitions)
        : parent.hoverStyles?.transitions;
    return block ?? [];
  }

  /**
   * Reset all interaction state
   */
  reset(): void {
    if (this.hoveredNode) {
      this.setNodeState(this.hoveredNode, "normal", performance.now());
      this.hoveredNode = null;
    }
    if (this.activeNode) {
      this.setNodeState(this.activeNode, "normal", performance.now());
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
