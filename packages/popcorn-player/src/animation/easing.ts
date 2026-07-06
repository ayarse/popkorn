import type { TimingFunction, CubicBezier } from '../scene/types';

/**
 * Easing functions for animations
 * All functions take t in [0, 1] and return value in [0, 1]
 */

// Pre-defined cubic bezier values for standard easing functions
const EASE_BEZIER: CubicBezier = { type: 'cubic-bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 };
const EASE_IN_BEZIER: CubicBezier = { type: 'cubic-bezier', x1: 0.42, y1: 0.0, x2: 1.0, y2: 1.0 };
const EASE_OUT_BEZIER: CubicBezier = { type: 'cubic-bezier', x1: 0.0, y1: 0.0, x2: 0.58, y2: 1.0 };
const EASE_IN_OUT_BEZIER: CubicBezier = { type: 'cubic-bezier', x1: 0.42, y1: 0.0, x2: 0.58, y2: 1.0 };

/**
 * Apply easing function to a progress value
 */
export function applyEasing(t: number, timingFunction: TimingFunction): number {
  // Clamp input
  t = Math.max(0, Math.min(1, t));

  if (timingFunction === 'linear') {
    return t;
  }

  // step-end holds at the start value until the segment completes (CSS steps(1,
  // jump-end)). The keyframe interpolator special-cases this before dispatch, so
  // this is only a fallback for direct callers.
  if (timingFunction === 'step-end') {
    return t < 1 ? 0 : 1;
  }

  if (timingFunction === 'ease') {
    return cubicBezier(t, EASE_BEZIER);
  }

  if (timingFunction === 'ease-in') {
    return cubicBezier(t, EASE_IN_BEZIER);
  }

  if (timingFunction === 'ease-out') {
    return cubicBezier(t, EASE_OUT_BEZIER);
  }

  if (timingFunction === 'ease-in-out') {
    return cubicBezier(t, EASE_IN_OUT_BEZIER);
  }

  if (typeof timingFunction === 'object' && timingFunction.type === 'cubic-bezier') {
    return cubicBezier(t, timingFunction);
  }

  return t;
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
