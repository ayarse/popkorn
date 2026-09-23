/** Hover/active detection plus overrides, applied last in the per-frame resolve so they compose over animation. */
// Transition tweens are wall-clock state kept only here, so the timeline stays a pure function of time.

import { applyEasing } from "../animation/easing.js";
import {
  filtersCompatible,
  getPropHandler,
  gradientsCompatible,
  interpolateProp,
  isFilterList,
  type PropHandler,
  type PropValue,
  pathsCompatible,
} from "../animation/registry.js";
import { cloneGradient, isGradientData } from "../renderer/types.js";
import { clamp01 } from "../scene/transform.js";
import type {
  InteractionState,
  NodeStateStyle,
  SceneNode,
  StateStyles,
  TransitionSpec,
} from "../scene/types.js";
import { hitTest, type Point } from "./hit-test.js";
import type { InputState } from "./inputs.js";

interface ActiveTransition {
  startTime: number; // wall-clock ms
  from: Map<string, PropValue | null>; // displayed values at the flip
  specs: TransitionSpec[];
}

// Registry props that tween as deltas; governed by translate/rotate/scale/transform.
const TRANSFORM_CHANNELS = new Set([
  "translateX",
  "translateY",
  "rotate",
  "scaleX",
  "scaleY",
]);

// Active falls back to hover.
function stateStylesFor(
  node: SceneNode,
  state: InteractionState,
): StateStyles | null {
  if (state === "active") return node.activeStyles ?? node.hoverStyles;
  if (state === "hover") return node.hoverStyles;
  return null;
}

// Every registry key a state block can touch, folded into `out`.
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

// Static decls plus animated props of a `:state()` entry; bounds a mix to the driven channels.
export function involvedStateKeys(
  entry: NodeStateStyle,
  out: Set<string>,
): void {
  collectInvolvedKeys(entry.styles, out);
  for (const anim of entry.animations)
    for (const track of anim.tracks) out.add(track.property);
}

// Live (pre-override) value as a tween endpoint; gradients deep-copied so snapshots never alias.
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

// Transforms compose as deltas (deliberate divergence from CSS replace); untouched keys hold the live value.
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

// Later specs win (CSS); `all` matches everything.
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

// Same-typed and structurally compatible; otherwise the caller flips at the midpoint.
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

// Non-blendable endpoints step at the eased midpoint (CSS discrete transition).
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

// Paint keeps gradient/solid mutually exclusive; others go through the registry handler (dirty flags).
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

/** Instant-snap overrides, for callers that don't manage transitions. */
export function applyInteractionOverrides(node: SceneNode): void {
  const state = node.interactionState;
  if (state === "normal") return;
  const styles = stateStylesFor(node, state);
  if (styles) applyStateStyles(node, styles);
}

/** Shared by :hover/:active and `:state()` so both use the same override semantics. */
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
  // Handlers set their own dirty flags; base-reset each frame reverts on release.
  if (styles.overrides) {
    for (const key in styles.overrides) {
      getPropHandler(key)!.apply(node, styles.overrides[key]);
    }
  }
  if (styles.discrete) for (const apply of styles.discrete) apply(node);
}

/** Gradient and solid clear each other; gradients deep-copied so state stops are never aliased. */
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

export class InteractionManager {
  private hoveredNode: SceneNode | null = null;
  private activeNode: SceneNode | null = null;
  private sceneRoot: SceneNode | null = null;
  private hasInteractive = false;
  private transitions = new WeakMap<SceneNode, ActiveTransition>();

  setScene(root: SceneNode): void {
    this.sceneRoot = root;
    this.hoveredNode = null;
    this.activeNode = null;
    this.transitions = new WeakMap();
    // `interactive` is build-time only, so update() can skip hit-testing non-interactive scenes.
    this.hasInteractive = subtreeHasInteractive(root);
  }

  /** `now` (wall-clock) anchors any transition a state flip starts. */
  update(
    inputState: InputState,
    now: number = performance.now(),
    clipBounds: { width: number; height: number } | null = null,
  ): void {
    if (!this.sceneRoot || !this.hasInteractive) return;

    const mousePoint: Point = {
      x: inputState.cursor.x,
      y: inputState.cursor.y,
    };

    // Clipped-out cursor still runs so hover/active clear on leave.
    const clippedOut =
      clipBounds !== null &&
      (mousePoint.x < 0 ||
        mousePoint.y < 0 ||
        mousePoint.x > clipBounds.width ||
        mousePoint.y > clipBounds.height);

    const hitNode = clippedOut ? null : hitTest(this.sceneRoot, mousePoint);

    const isPressed = inputState.cursor.isDown;

    if (hitNode !== this.hoveredNode) {
      if (this.hoveredNode && this.hoveredNode !== this.activeNode) {
        this.setNodeState(this.hoveredNode, "normal", now);
      }
      this.hoveredNode = hitNode;

      if (hitNode && hitNode !== this.activeNode) {
        this.setNodeState(hitNode, "hover", now);
      }
    }

    if (isPressed) {
      if (hitNode && hitNode !== this.activeNode) {
        if (this.activeNode) {
          this.setNodeState(this.activeNode, "normal", now);
        }
        this.activeNode = hitNode;
        this.setNodeState(hitNode, "active", now);
      }
    } else {
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

  /** Tween any running transition toward the current state, else snap. */
  applyOverrides(node: SceneNode, now: number = performance.now()): void {
    const active = this.transitions.get(node);
    if (!active) {
      applyInteractionOverrides(node);
      return;
    }

    const styles = stateStylesFor(node, node.interactionState);
    // Discrete strings never tween; they snap in while numeric channels blend.
    if (styles?.discrete) for (const apply of styles.discrete) apply(node);
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

  /** Also flips state-children (`#p:hover > #c`), anchored on this same flip. */
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

  // The child mirrors the parent's state so its parent-authored styles resolve normally.
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

  // Empty specs snap (clear the tween).
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

  // The entered state's own transitions (CSS asymmetric enter/exit), else the node's.
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

  // Own `transition:`, else the parent's state-block one, else snap.
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

  getHoveredNode(): SceneNode | null {
    return this.hoveredNode;
  }
}

function subtreeHasInteractive(node: SceneNode): boolean {
  if (node.interactive) return true;
  return node.children.some(subtreeHasInteractive);
}
