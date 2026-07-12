import type {
  AnimatableValue,
  CompositeOperation,
  KeyframeData,
  SceneNode,
  TimingFunction,
} from "../scene/types";
import { applyEasing, holdsAtStart } from "./easing";
import type { PropValue } from "./registry";
import { getPropHandler, interpolateProp } from "./registry";

// Synthetic implicit 0%/100% keyframes (CSS rule: a missing edge keyframe is
// synthesized as empty, so its properties fall back to the base value via the
// `missing` lookup below, and its missing `easing` falls through to
// `defaultEasing`). Module-level singletons — this is a per-frame hot path,
// no per-call allocation.
const EMPTY_START: KeyframeData = { offset: 0, properties: {} };
const EMPTY_END: KeyframeData = { offset: 1, properties: {} };

/**
 * Sample the keyframe timeline at a given progress (0-1) and write the resolved
 * values directly into the node's live render fields.
 *
 * The node must already have been reset to its authored base (and any bindings
 * applied) before this runs — animation composes on top. For every property
 * that appears in the bracketing keyframes we look up its handler in the
 * property registry, interpolate the two endpoints (falling back to the node's
 * base value when a keyframe omits the property), and apply it. No property is
 * special-cased here, so any registered property animates.
 *
 * Note: `progress` should already have the animation-level direction applied by
 * the scheduler. Per-keyframe easing is applied here to the local progress
 * between the two bracketing keyframes.
 */
export function interpolateKeyframes(
  node: SceneNode,
  keyframes: KeyframeData[],
  progress: number,
  defaultEasing?: TimingFunction,
  composite: CompositeOperation = "replace",
): void {
  if (keyframes.length === 0) return;

  // animation-composition add/accumulate: numeric channels are added onto the
  // value already written this frame (base + bindings + earlier animations)
  // instead of replacing it. accumulate == add for plain numbers/lengths. Only
  // numeric handlers (with readLive) compose; color/gradient/path replace.
  const additive = composite !== "replace";

  // Keyframes are sorted by offset once at build time (scene/builder
  // buildKeyframes) — this runs per animation per node per frame, so no
  // per-call clone/sort.
  const sorted = keyframes;

  // Clamp progress
  progress = Math.max(0, Math.min(1, progress));

  // Find the bracketing keyframes. Below the first / above the last, bracket
  // against a synthetic empty keyframe at the timeline edge (CSS implicit
  // 0%/100% keyframes) unless an authored keyframe already sits there.
  let prev = sorted[0];
  let next = sorted[sorted.length - 1];
  if (progress <= sorted[0].offset) {
    prev = sorted[0].offset > 0 ? EMPTY_START : sorted[0];
    next = sorted[0];
  } else if (progress >= sorted[sorted.length - 1].offset) {
    prev = sorted[sorted.length - 1];
    next =
      sorted[sorted.length - 1].offset < 1
        ? EMPTY_END
        : sorted[sorted.length - 1];
  } else {
    for (let i = 0; i < sorted.length - 1; i++) {
      if (progress >= sorted[i].offset && progress <= sorted[i + 1].offset) {
        prev = sorted[i];
        next = sorted[i + 1];
        break;
      }
    }
  }

  // Local progress between the two keyframes, with per-keyframe easing.
  const range = next.offset - prev.offset;
  let localProgress = range > 0 ? (progress - prev.offset) / range : 0;
  const keyframeEasing = prev.easing || defaultEasing;
  if (holdsAtStart(keyframeEasing)) {
    // Hold (CSS step-end): the departing keyframe's value holds across the whole
    // segment and jumps at the next keyframe. Forcing local progress to 0 makes
    // every property interpolate to its `from` endpoint — before per-kind
    // dispatch, so numbers and colors alike hold.
    localProgress = 0;
  } else if (keyframeEasing) {
    localProgress = applyEasing(localProgress, keyframeEasing);
  }

  // Apply every property present in either endpoint.
  for (const property of propertyNames(prev.properties, next.properties)) {
    const handler = getPropHandler(property);
    if (!handler) continue;

    // Additive numeric channel: a missing endpoint is the additive identity (0),
    // not the base value, so an omitted keyframe contributes no delta (rather
    // than double-counting the base). Non-numeric (or replace) keep base.
    const numericAdditive =
      additive && handler.kind === "number" && !!handler.readLive;
    const missing: PropValue | null = numericAdditive
      ? 0
      : handler.readBase(node.base);

    const from =
      property in prev.properties
        ? (prev.properties[property] as PropValue)
        : missing;
    const to =
      property in next.properties
        ? (next.properties[property] as PropValue)
        : missing;

    const value = interpolateProp(handler, from, to, localProgress);
    if (value === null) continue;
    if (numericAdditive && typeof value === "number") {
      handler.apply(node, handler.readLive!(node) + value);
    } else {
      handler.apply(node, value);
    }
  }
}

function propertyNames(
  a: Record<string, AnimatableValue>,
  b: Record<string, AnimatableValue>,
): Set<string> {
  const names = new Set<string>(Object.keys(a));
  for (const k of Object.keys(b)) names.add(k);
  return names;
}
