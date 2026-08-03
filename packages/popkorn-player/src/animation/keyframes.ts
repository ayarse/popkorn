import type {
  CompositeOperation,
  KeyframeData,
  KeyframeStop,
  KeyframeTrack,
  SceneNode,
  TimingFunction,
} from "../scene/types.js";
import { applyEasing, holdsAtStart } from "./easing.js";
import type { PropValue } from "./registry.js";
import { getPropHandler, interpolateProp } from "./registry.js";

/**
 * Group parsed keyframes into one track per animated property (CSS/WAAPI
 * property-specific keyframes): a property's track holds only the keyframes
 * that declare it, carrying that keyframe's own easing. Runs once at scene
 * build time so sampling allocates nothing.
 *
 * Author order isn't guaranteed ascending (`100% {} 0% {}` is legal CSS), so
 * each track is sorted here — stably, leaving repeated offsets in author order.
 */
export function buildKeyframeTracks(frames: KeyframeData[]): KeyframeTrack[] {
  const byProperty = new Map<string, KeyframeTrack>();
  for (const frame of frames) {
    for (const property in frame.properties) {
      let track = byProperty.get(property);
      if (!track) {
        track = { property, stops: [] };
        byProperty.set(property, track);
      }
      const stop: KeyframeStop = {
        offset: frame.offset,
        value: frame.properties[property],
      };
      if (frame.easing !== undefined) stop.easing = frame.easing;
      track.stops.push(stop);
    }
  }
  const tracks = [...byProperty.values()];
  for (const track of tracks) track.stops.sort((a, b) => a.offset - b.offset);
  return tracks;
}

/**
 * Sample the keyframe tracks at a given progress (0-1) and write the resolved
 * values directly into the node's live render fields.
 *
 * The node must already have been reset to its authored base (and any bindings
 * applied) before this runs — animation composes on top. Each property is
 * bracketed within its OWN track, so a property declared at 0% and 100% but
 * omitted in between still interpolates across the omissions. The node's base
 * value enters only at a timeline edge the track doesn't reach: a track whose
 * first stop is past 0 (or last stop short of 1) brackets against a synthesized
 * neutral stop there, per the CSS implicit 0%/100% keyframes. Every property
 * resolves through its property-registry handler, so no property is
 * special-cased here and any registered property animates.
 *
 * Note: `progress` should already have the animation-level direction applied by
 * the scheduler. Per-keyframe easing is applied here to the local progress
 * between the two bracketing stops of each track.
 */
export function interpolateKeyframes(
  node: SceneNode,
  tracks: KeyframeTrack[],
  progress: number,
  defaultEasing?: TimingFunction,
  composite: CompositeOperation = "replace",
): void {
  if (tracks.length === 0) return;

  // animation-composition add/accumulate: numeric channels are added onto the
  // value already written this frame (base + bindings + earlier animations)
  // instead of replacing it. accumulate == add for plain numbers/lengths. Only
  // numeric handlers (with readLive) compose; color/gradient/path replace.
  const additive = composite !== "replace";

  // Clamp progress
  progress = Math.max(0, Math.min(1, progress));

  for (const track of tracks) {
    const handler = getPropHandler(track.property);
    if (!handler) continue;

    // A synthesized edge on an additive numeric channel is the additive
    // identity (0), not the base value, so it contributes no delta (rather than
    // double-counting the base). Non-numeric (or replace) synthesize from base.
    const numericAdditive =
      additive && handler.kind === "number" && !!handler.readLive;
    const neutral: PropValue | null = numericAdditive
      ? 0
      : handler.readBase(node.base);

    const stops = track.stops;
    const first = stops[0];
    const last = stops[stops.length - 1];

    let fromOffset: number;
    let toOffset: number;
    let from: PropValue | null;
    let to: PropValue | null;
    // Easing belongs to the departing stop of THIS track; a synthesized edge
    // carries none, so it falls through to the animation's default easing.
    let easing: TimingFunction | undefined;

    if (progress <= first.offset) {
      toOffset = first.offset;
      to = first.value as PropValue;
      if (first.offset > 0) {
        fromOffset = 0;
        from = neutral;
        easing = defaultEasing;
      } else {
        fromOffset = first.offset;
        from = to;
        easing = first.easing || defaultEasing;
      }
    } else if (progress >= last.offset) {
      fromOffset = last.offset;
      from = last.value as PropValue;
      easing = last.easing || defaultEasing;
      if (last.offset < 1) {
        toOffset = 1;
        to = neutral;
      } else {
        toOffset = last.offset;
        to = from;
      }
    } else {
      let lo = first;
      let hi = last;
      for (let i = 0; i < stops.length - 1; i++) {
        if (progress >= stops[i].offset && progress <= stops[i + 1].offset) {
          lo = stops[i];
          hi = stops[i + 1];
          break;
        }
      }
      fromOffset = lo.offset;
      toOffset = hi.offset;
      from = lo.value as PropValue;
      to = hi.value as PropValue;
      easing = lo.easing || defaultEasing;
    }

    const range = toOffset - fromOffset;
    let localProgress = range > 0 ? (progress - fromOffset) / range : 0;
    if (holdsAtStart(easing)) {
      // Hold (CSS step-end): the departing stop's value holds across the whole
      // segment and jumps at the next stop. Forcing local progress to 0 makes
      // the property interpolate to its `from` endpoint — before per-kind
      // dispatch, so numbers and colors alike hold.
      localProgress = 0;
    } else if (easing) {
      localProgress = applyEasing(localProgress, easing);
    }

    const value = interpolateProp(handler, from, to, localProgress);
    if (value === null) continue;
    if (numericAdditive && typeof value === "number") {
      handler.apply(node, handler.readLive!(node) + value);
    } else {
      handler.apply(node, value);
    }
  }
}
