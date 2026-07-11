import type { GradientData } from "./types";

// The shape's local bounding box a gradient is realized against.
export interface PaintBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A gradient resolved to concrete geometry — platform-agnostic. Every backend
// realizes the SAME endpoints/radii from this (CanvasGradient / SVG attrs /
// SkShader), so the gradient math lives in one place instead of three.
export interface ResolvedLinearGradient {
  type: "linear";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: { offset: number; color: string }[];
}
export interface ResolvedRadialGradient {
  type: "radial";
  cx: number;
  cy: number;
  r: number; // outer circle
  fx: number;
  fy: number; // focal = inner-circle centre, radius 0
  stops: { offset: number; color: string }[];
}
export type ResolvedGradient = ResolvedLinearGradient | ResolvedRadialGradient;

/**
 * Resolve a gradient descriptor against a shape's local bounding box.
 *
 * Linear angle follows CSS: 0deg = up, 90deg = right; explicit `from`/`to`
 * endpoints override the angle. Radial is a circle at the box centre with radius
 * = half the box diagonal, unless explicit geometry (`at`/`radius`, optional
 * `focal`) is given. Offsets are clamped to [0,1]; colours pass through verbatim.
 */
export function resolveGradient(
  g: GradientData,
  b: PaintBox,
): ResolvedGradient {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const stops = g.stops.map((s) => ({
    offset: Math.max(0, Math.min(1, s.offset)),
    color: s.color,
  }));

  if (g.type === "linear-gradient") {
    if (g.from && g.to) {
      return {
        type: "linear",
        x1: g.from.x,
        y1: g.from.y,
        x2: g.to.x,
        y2: g.to.y,
        stops,
      };
    }
    const rad = (g.angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const len = Math.abs(b.width * dx) + Math.abs(b.height * dy);
    return {
      type: "linear",
      x1: cx - (dx * len) / 2,
      y1: cy - (dy * len) / 2,
      x2: cx + (dx * len) / 2,
      y2: cy + (dy * len) / 2,
      stops,
    };
  }

  if (g.at && g.radius != null) {
    // Exact circle. Inner circle at the focal point (Lottie highlight offset)
    // when given, else concentric with the outer.
    const f = g.focal ?? g.at;
    return {
      type: "radial",
      cx: g.at.x,
      cy: g.at.y,
      r: g.radius,
      fx: f.x,
      fy: f.y,
      stops,
    };
  }
  const r = Math.hypot(b.width, b.height) / 2;
  return { type: "radial", cx, cy, r, fx: cx, fy: cy, stops };
}
