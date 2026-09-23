import { clamp01 } from "../scene/transform.js";
import type {
  CubicBezier,
  LinearEasingPoint,
  StepPosition,
  TimingFunction,
} from "../scene/types.js";

const cubic = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): CubicBezier => ({
  type: "cubic-bezier",
  x1,
  y1,
  x2,
  y2,
});

// CSS named cubic-bezier keywords.
const NAMED_BEZIER = new Map<string, CubicBezier>([
  ["ease", cubic(0.25, 0.1, 0.25, 1.0)],
  ["ease-in", cubic(0.42, 0.0, 1.0, 1.0)],
  ["ease-out", cubic(0.0, 0.0, 0.58, 1.0)],
  ["ease-in-out", cubic(0.42, 0.0, 0.58, 1.0)],
]);

// Named keywords that are valid TimingFunction values on their own.
const NAMED_EASINGS = new Set([
  "linear",
  "step-start",
  "step-end",
  ...NAMED_BEZIER.keys(),
]);

// step-end holds the departing value; keyframe/time-remap sampling special-case it before dispatch.
export function holdsAtStart(
  timingFunction: TimingFunction | undefined,
): boolean {
  return timingFunction === "step-end";
}

export function applyEasing(t: number, timingFunction: TimingFunction): number {
  t = clamp01(t);

  if (timingFunction === "linear") {
    return t;
  }

  // step-end / step-start are steps(1, jump-end) / steps(1, jump-start).
  if (holdsAtStart(timingFunction)) {
    return stepEasing(t, 1, "jump-end");
  }

  if (timingFunction === "step-start") {
    return stepEasing(t, 1, "jump-start");
  }

  if (typeof timingFunction === "string") {
    const named = NAMED_BEZIER.get(timingFunction);
    return named ? cubicBezier(t, named) : t;
  }

  if (typeof timingFunction === "object") {
    if (timingFunction.type === "cubic-bezier")
      return cubicBezier(t, timingFunction);
    if (timingFunction.type === "steps") {
      return stepEasing(t, timingFunction.count, timingFunction.position);
    }
    if (timingFunction.type === "linear") {
      return linearEasing(t, timingFunction.points);
    }
  }

  return t;
}

// Raw source easing (e.g. state-machine `mix`) to a TimingFunction; unrecognized -> "linear".
export function parseTimingString(
  raw: string | null | undefined,
): TimingFunction {
  if (!raw) return "linear";
  const s = raw.trim();
  if (NAMED_EASINGS.has(s)) return s as TimingFunction;
  const cb = s.match(
    /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/,
  );
  if (cb)
    return {
      type: "cubic-bezier",
      x1: +cb[1],
      y1: +cb[2],
      x2: +cb[3],
      y2: +cb[4],
    };
  const st = s.match(/^steps\(\s*(\d+)\s*(?:,\s*([a-z-]+)\s*)?\)$/);
  if (st)
    return {
      type: "steps",
      count: +st[1],
      position: (st[2] as StepPosition) || "jump-end",
    };
  return "linear";
}

// CSS linear(): points pre-normalized; output NOT clamped so overshoot gives spring/bounce.
export function linearEasing(t: number, points: LinearEasingPoint[]): number {
  if (points.length === 0) return t;
  if (points.length === 1) return points[0].output;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].input) {
      const a = points[i - 1];
      const b = points[i];
      const span = b.input - a.input;
      if (span <= 0) return b.output;
      return a.output + (b.output - a.output) * ((t - a.input) / span);
    }
  }
  return points[points.length - 1].output;
}

// CSS steps(): `count` intervals with jumps placed per `position`.
export function stepEasing(
  t: number,
  count: number,
  position: StepPosition,
): number {
  if (count < 1) return t;
  let currentStep = Math.floor(t * count);
  if (position === "jump-start" || position === "jump-both") currentStep += 1;
  if (t >= 0 && currentStep < 0) currentStep = 0;

  const jumps =
    position === "jump-none"
      ? count - 1
      : position === "jump-both"
        ? count + 1
        : count;
  if (t <= 1 && currentStep > jumps) currentStep = jumps;
  if (jumps <= 0) return 0; // steps(1, jump-none): single level, always 0
  return currentStep / jumps;
}

// Cubic bezier, after WebKit's implementation.
function cubicBezier(t: number, bezier: CubicBezier): number {
  const { x1, y1, x2, y2 } = bezier;

  let x = t;
  for (let i = 0; i < 8; i++) {
    const xEst = bezierAxis(x, x1, x2);
    const dx = t - xEst;
    if (Math.abs(dx) < 1e-6) break;
    const slope = sampleCurveDerivativeX(x, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    x += dx / slope;
  }

  return bezierAxis(x, y1, y2);
}

// Bezier coordinate on one axis with P0 = 0, P3 = 1.
function bezierAxis(t: number, p1: number, p2: number): number {
  return ((1 - 3 * p2 + 3 * p1) * t + (3 * p2 - 6 * p1)) * t * t + 3 * p1 * t;
}

function sampleCurveDerivativeX(t: number, x1: number, x2: number): number {
  return (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1;
}
