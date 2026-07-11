import type { GradientData, GradientStop } from "./types";
import { colorToCSS, parseColor } from "./types";

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
// Conic (angular) sweep. `startAngle` is in radians measured from the +x axis
// clockwise — the Canvas `createConicGradient` convention, canonical here (SVG
// has no conic; Skia converts to its degrees-from-+x sweep). Offset 0 sits at
// `startAngle`.
export interface ResolvedConicGradient {
  type: "conic";
  cx: number;
  cy: number;
  startAngle: number; // radians, +x axis, clockwise
  stops: { offset: number; color: string }[];
}
export type ResolvedGradient =
  | ResolvedLinearGradient
  | ResolvedRadialGradient
  | ResolvedConicGradient;

// Colour at fraction `t` between two stop colours (boundary clipping for
// repeating tiles). Kept here so the shared helper owns every repeating-gradient
// geometry decision rather than leaning on the animation registry's lerp.
function lerpStopColor(a: string, b: string, t: number): string {
  const c1 = parseColor(a);
  const c2 = parseColor(b);
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const bl = Math.round(c1.b + (c2.b - c1.b) * t);
  const al = c1.a + (c2.a - c1.a) * t;
  // Emit rgb() at full alpha (matching interpolateColor) so a backend that
  // splits rgba()/hex8 into stop-color + opacity (SVG) doesn't diverge here.
  return al === 1
    ? `rgb(${r}, ${g}, ${bl})`
    : colorToCSS({ r, g, b: bl, a: al });
}

// Realize a gradient's stop list into concrete [0,1] offsets. Non-repeating just
// clamps; repeating tiles the authored run across the whole 0-1 range (so every
// backend stays dumb — Canvas has no gradient repeat, and unifying here keeps
// SVG/Skia byte-identical to it rather than each using a native spread/tile mode).
function realizeStops(
  authored: GradientStop[],
  repeating: boolean,
): { offset: number; color: string }[] {
  if (!repeating)
    return authored.map((s) => ({
      offset: Math.max(0, Math.min(1, s.offset)),
      color: s.color,
    }));

  const first = authored[0].offset;
  const last = authored[authored.length - 1].offset;
  const w = last - first;
  // Degenerate tile (zero/negative width) can't repeat — fall back to a clamp.
  if (w <= 0)
    return authored.map((s) => ({
      offset: Math.max(0, Math.min(1, s.offset)),
      color: s.color,
    }));

  // Tile the run across [0,1] (a couple of cycles of slack past each edge), then
  // clip to the unit range, interpolating the colour where a tile crosses 0 or 1.
  const raw: { offset: number; color: string }[] = [];
  const kMin = Math.floor((0 - first) / w) - 1;
  const kMax = Math.ceil((1 - first) / w) + 1;
  for (let k = kMin; k <= kMax; k++)
    for (const s of authored)
      raw.push({ offset: s.offset + k * w, color: s.color });

  const out: { offset: number; color: string }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (s.offset < 0) {
      const nx = raw[i + 1];
      if (nx && nx.offset >= 0) {
        const t = (0 - s.offset) / (nx.offset - s.offset);
        out.push({ offset: 0, color: lerpStopColor(s.color, nx.color, t) });
      }
      continue;
    }
    if (s.offset > 1) {
      const pv = raw[i - 1];
      if (pv && pv.offset <= 1) {
        const t = (1 - pv.offset) / (s.offset - pv.offset);
        out.push({ offset: 1, color: lerpStopColor(pv.color, s.color, t) });
      }
      break; // everything after is also > 1
    }
    out.push(s);
  }
  return out;
}

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
  const stops = realizeStops(g.stops, g.repeating ?? false);

  if (g.type === "conic-gradient") {
    const c = g.at ?? { x: cx, y: cy };
    // CSS conic 0deg points up and turns clockwise; Canvas's startAngle is from
    // the +x axis clockwise — so shift by −90°.
    return {
      type: "conic",
      cx: c.x,
      cy: c.y,
      startAngle: ((g.from - 90) * Math.PI) / 180,
      stops,
    };
  }

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
