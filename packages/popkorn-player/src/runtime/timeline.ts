// Scene animations → serializable tracks for an external timeline UI.

import type {
  AnimatableValue,
  AnimationDirection,
  AnimationFillMode,
  AnimationInstance,
  SceneNode,
  TimingFunction,
  Transform,
} from "../scene/types.js";

/** One keyframe stop for the timeline UI; `easing` is the transition FROM here. */
export interface TimelineKeyframe {
  offset: number; // 0..1
  value: string;
  easing?: TimingFunction;
}

export interface TimelineAnimationProperty {
  property: string;
  keyframes: TimelineKeyframe[];
}

export interface TimelineAnimation {
  name: string;
  delay: number; // ms (may be negative)
  duration: number; // ms
  iterationCount: number; // Infinity for infinite
  timingFunction: TimingFunction; // animation-level easing (plain union, as-is)
  direction: AnimationDirection;
  fillMode: AnimationFillMode;
  // Declaring rule's selector (e.g. `#btn:state(door.open)`); round-trips into retimeAnimation.
  ruleSelector: string;
  // `machine` is null for an un-namespaced `:state(name)`.
  state?: { machine: string | null; state: string };
  properties: TimelineAnimationProperty[];
}

export interface TimelineTrack {
  nodeName: string;
  animations: TimelineAnimation[];
}

function nodeLabel(node: SceneNode): string {
  if (node.className) return `.${node.className}`;
  return node.id === "root" ? "root" : `#${node.id}`;
}

/** Integers as-is, else ≤3 decimals. */
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/** Non-default Transform channels, e.g. `x 20, rot 45°`; all defaults read `none`. */
function formatTransform(t: Transform): string {
  const parts: string[] = [];
  if (t.translateX) parts.push(`x ${formatNumber(t.translateX)}`);
  if (t.translateY) parts.push(`y ${formatNumber(t.translateY)}`);
  if (t.rotate) parts.push(`rot ${formatNumber(t.rotate)}°`);
  if (t.scaleX !== 1 || t.scaleY !== 1)
    parts.push(
      t.scaleX === t.scaleY
        ? `scale ${formatNumber(t.scaleX)}`
        : `scale ${formatNumber(t.scaleX)},${formatNumber(t.scaleY)}`,
    );
  if (t.skewX) parts.push(`skewX ${formatNumber(t.skewX)}°`);
  if (t.skewY) parts.push(`skewY ${formatNumber(t.skewY)}°`);
  return parts.length ? parts.join(", ") : "none";
}

export function formatAnimatableValue(v: AnimatableValue): string {
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const first = v[0] as { type?: string } | undefined;
    return first && /^[A-Za-z]$/.test(first.type ?? "") ? "path" : "filter";
  }
  // GradientData (`type` ends in `-gradient`) or a Transform (no `type`).
  if ("type" in v && typeof v.type === "string" && v.type.endsWith("gradient"))
    return "gradient";
  return formatTransform(v as Transform);
}

function toTimelineAnimation(
  a: AnimationInstance,
  ruleSelector: string,
  state?: { machine: string | null; state: string },
): TimelineAnimation {
  const anim: TimelineAnimation = {
    name: a.name,
    delay: a.delay,
    duration: a.duration,
    // Infinity stays; callers cap it at scene duration.
    iterationCount: a.iterationCount,
    timingFunction: a.timingFunction,
    direction: a.direction,
    fillMode: a.fillMode,
    ruleSelector,
    properties: a.tracks.map((track) => ({
      property: track.property,
      keyframes: track.stops.map((s) => {
        const stop: TimelineKeyframe = {
          offset: s.offset,
          value: formatAnimatableValue(s.value),
        };
        if (s.easing !== undefined) stop.easing = s.easing;
        return stop;
      }),
    })),
  };
  if (state) anim.state = state;
  return anim;
}

// Per-node animations, incl. `:state()`-scoped ones, in tree order.
export function timelineTracks(root: SceneNode): TimelineTrack[] {
  const tracks: TimelineTrack[] = [];

  const walk = (node: SceneNode): void => {
    const label = nodeLabel(node);
    const animations: TimelineAnimation[] = [];
    for (const a of node.animations)
      animations.push(toTimelineAnimation(a, label));
    // Machine `:state()`-scoped animations, tagged with state and selector.
    for (const ss of node.stateStyles) {
      const scoped = ss.machine ? `${ss.machine}.${ss.name}` : ss.name;
      const selector = `${label}:state(${scoped})`;
      for (const a of ss.animations)
        animations.push(
          toTimelineAnimation(a, selector, {
            machine: ss.machine,
            state: ss.name,
          }),
        );
    }
    if (animations.length > 0) tracks.push({ nodeName: label, animations });
    for (const child of node.children) walk(child);
  };

  walk(root);
  return tracks;
}
