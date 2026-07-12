import type {
  CubicBezier,
  LinearEasingPoint,
  StepPosition,
  TimingFunction,
} from "../scene/types";

/**
 * Easing functions for animations
 * All functions take t in [0, 1] and return value in [0, 1]
 */

// Pre-defined cubic bezier values for standard easing functions
const EASE_BEZIER: CubicBezier = {
  type: "cubic-bezier",
  x1: 0.25,
  y1: 0.1,
  x2: 0.25,
  y2: 1.0,
};
const EASE_IN_BEZIER: CubicBezier = {
  type: "cubic-bezier",
  x1: 0.42,
  y1: 0.0,
  x2: 1.0,
  y2: 1.0,
};
const EASE_OUT_BEZIER: CubicBezier = {
  type: "cubic-bezier",
  x1: 0.0,
  y1: 0.0,
  x2: 0.58,
  y2: 1.0,
};
const EASE_IN_OUT_BEZIER: CubicBezier = {
  type: "cubic-bezier",
  x1: 0.42,
  y1: 0.0,
  x2: 0.58,
  y2: 1.0,
};

/**
 * Whether an easing holds at its departing (start) value across the whole
 * segment and jumps only at the end — CSS `step-end` (steps(1, jump-end))
 * semantics. Keyframe sampling (`animation/keyframes.ts`) and time-remap
 * sampling (`runtime/loop.ts sampleTimeRemap`) both special-case this before
 * per-kind dispatch, since forcing local progress to 0 is cheaper and more
 * direct than routing every property through `stepEasing`; `applyEasing`
 * uses the same predicate so direct callers see identical behavior.
 */
export function holdsAtStart(
  timingFunction: TimingFunction | undefined,
): boolean {
  return timingFunction === "step-end";
}

/**
 * Apply easing function to a progress value
 */
export function applyEasing(t: number, timingFunction: TimingFunction): number {
  // Clamp input
  t = Math.max(0, Math.min(1, t));

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

  if (timingFunction === "ease") {
    return cubicBezier(t, EASE_BEZIER);
  }

  if (timingFunction === "ease-in") {
    return cubicBezier(t, EASE_IN_BEZIER);
  }

  if (timingFunction === "ease-out") {
    return cubicBezier(t, EASE_OUT_BEZIER);
  }

  if (timingFunction === "ease-in-out") {
    return cubicBezier(t, EASE_IN_OUT_BEZIER);
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

// Named keywords that are valid TimingFunction values on their own.
const NAMED_EASINGS = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
]);

/**
 * Parse an easing written as a raw source string (e.g. a state-machine `mix`
 * easing, which the parser slurps verbatim) into a TimingFunction usable with
 * applyEasing. Named keywords pass straight through; `cubic-bezier(...)` and
 * `steps(...)` are parsed with a compact regex (this is not the animation
 * property path — that goes through the builder's Value-based parser — so a
 * dependency-free string parser keeps the runtime self-contained). Anything
 * unrecognized (or null) falls back to "linear", the sensible cross-fade default.
 */
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

/**
 * CSS linear() easing (Easing Level 2). Evaluate the piecewise-linear curve at
 * input `t`; `points` are pre-normalized (input ascending in [0,1]). The output
 * is NOT clamped, so overshoot control points (> 1) produce spring/bounce
 * curves. Equal-input points create a flat/discontinuous step (first bracket
 * wins).
 */
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

/**
 * CSS steps() easing (Easing Level 1). Produces a staircase of `count` intervals
 * whose jumps sit at the domain edges per `position`. Returns a value in [0, 1].
 */
export function stepEasing(
  t: number,
  count: number,
  position: StepPosition,
): number {
  if (count < 1) return t;
  let currentStep = Math.floor(t * count);
  if (position === "jump-start" || position === "jump-both") currentStep += 1;
  if (t >= 0 && currentStep < 0) currentStep = 0;

  // Number of distinct output levels minus one (the denominator).
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

/**
 * Cubic bezier implementation
 * Based on WebKit's implementation
 */
function cubicBezier(t: number, bezier: CubicBezier): number {
  const { x1, y1, x2, y2 } = bezier;

  // Newton-Raphson iteration to find t for x
  let x = t;
  for (let i = 0; i < 8; i++) {
    const xEst = sampleCurveX(x, x1, x2);
    const dx = t - xEst;
    if (Math.abs(dx) < 1e-6) break;
    const slope = sampleCurveDerivativeX(x, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    x += dx / slope;
  }

  return sampleCurveY(x, y1, y2);
}

function sampleCurveX(t: number, x1: number, x2: number): number {
  // B(t) = 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3
  // For X: P0.x=0, P1.x=x1, P2.x=x2, P3.x=1
  return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t;
}

function sampleCurveY(t: number, y1: number, y2: number): number {
  return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t;
}

function sampleCurveDerivativeX(t: number, x1: number, x2: number): number {
  return (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1;
}
