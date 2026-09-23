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

// One track per property holding only the keyframes that declare it, stably sorted by offset.
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

// Composes onto a base-reset node; each property brackets within its own track (implicit 0%/100% = base).
export function interpolateKeyframes(
  node: SceneNode,
  tracks: KeyframeTrack[],
  progress: number,
  defaultEasing?: TimingFunction,
  composite: CompositeOperation = "replace",
): void {
  if (tracks.length === 0) return;

  // add/accumulate: numeric channels (with readLive) add onto this frame's value; others replace.
  const additive = composite !== "replace";

  progress = Math.max(0, Math.min(1, progress));

  for (const track of tracks) {
    const handler = getPropHandler(track.property);
    if (!handler) continue;

    // An additive synthesized edge is the identity (0), so it doesn't double-count base.
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
    // Easing belongs to this track's departing stop; synthesized edges use the default.
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
      // Hold (step-end): local progress 0 before per-kind dispatch, so every kind holds.
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
