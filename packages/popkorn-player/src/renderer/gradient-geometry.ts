import { mixOklab, mixOklch, oklabToRgba, rgbaToOklab } from "./oklab.js";
import type {
  GradientData,
  GradientInterpolation,
  GradientStop,
} from "./types.js";
import { colorToCSS, parseColor } from "./types.js";

// The shape's local bounding box a gradient is realized against.
export interface PaintBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A gradient resolved to platform-agnostic geometry that every backend realizes identically.
export interface ResolvedLinearGradient {
  type: "linear";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
}
export interface ResolvedRadialGradient {
  type: "radial";
  cx: number;
  cy: number;
  r: number; // outer circle
  fx: number;
  fy: number; // focal = inner-circle centre, radius 0
  stops: GradientStop[];
}
// `startAngle`: radians from +x, clockwise (Canvas convention); offset 0 sits there.
export interface ResolvedConicGradient {
  type: "conic";
  cx: number;
  cy: number;
  startAngle: number; // radians, +x axis, clockwise
  stops: GradientStop[];
}
export type ResolvedGradient =
  | ResolvedLinearGradient
  | ResolvedRadialGradient
  | ResolvedConicGradient;

function rgbaToStopColor(c: {
  r: number;
  g: number;
  b: number;
  a: number;
}): string {
  return c.a === 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : colorToCSS(c);
}

// Colour at `t` between two stops, for clipping repeating tiles at 0/1.
function lerpStopColor(a: string, b: string, t: number): string {
  const c1 = parseColor(a);
  const c2 = parseColor(b);
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const bl = Math.round(c1.b + (c2.b - c1.b) * t);
  const al = c1.a + (c2.a - c1.a) * t;
  // rgb() at full alpha so SVG's stop-color/opacity split doesn't diverge.
  return rgbaToStopColor({ r, g, b: bl, a: al });
}

// Backends only interpolate stops in sRGB, so oklab/oklch ramps are realized as inserted sRGB stops.
// NOTE: fixed 16 segments (under a JND for full chroma); adaptive on deltaEOK would cut stop counts.
const OKLAB_SEGMENTS = 16;

function densifyStops(
  stops: GradientStop[],
  interpolate: GradientInterpolation,
): GradientStop[] {
  if (stops.length < 2) return stops;
  const mix = interpolate.space === "oklch" ? mixOklch : mixOklab;

  const out: GradientStop[] = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    // A zero-width step (hard colour stop) has nothing to subdivide.
    if (b.offset > a.offset) {
      const from = rgbaToOklab(parseColor(a.color));
      const to = rgbaToOklab(parseColor(b.color));
      for (let k = 1; k < OKLAB_SEGMENTS; k++) {
        const t = k / OKLAB_SEGMENTS;
        out.push({
          offset: a.offset + (b.offset - a.offset) * t,
          color: rgbaToStopColor(
            oklabToRgba(mix(from, to, t, interpolate.hue)),
          ),
        });
      }
    }
    out.push(b);
  }
  return out;
}

// Offsets into [0,1]: clamp, or tile a repeating run here since Canvas has no native repeat.
function realizeStops(
  authored: GradientStop[],
  repeating: boolean,
  interpolate?: GradientInterpolation,
): GradientStop[] {
  const finish = (out: GradientStop[]): GradientStop[] =>
    interpolate ? densifyStops(out, interpolate) : out;
  if (!repeating)
    return finish(
      authored.map((s) => ({
        offset: Math.max(0, Math.min(1, s.offset)),
        color: s.color,
      })),
    );

  const first = authored[0].offset;
  const last = authored[authored.length - 1].offset;
  const w = last - first;
  // Degenerate tile (zero/negative width) can't repeat — fall back to a clamp.
  if (w <= 0)
    return finish(
      authored.map((s) => ({
        offset: Math.max(0, Math.min(1, s.offset)),
        color: s.color,
      })),
    );

  // Tile with slack past each edge, then clip to [0,1] interpolating the crossing colour.
  const raw: GradientStop[] = [];
  const kMin = Math.floor((0 - first) / w) - 1;
  const kMax = Math.ceil((1 - first) / w) + 1;
  for (let k = kMin; k <= kMax; k++)
    for (const s of authored)
      raw.push({ offset: s.offset + k * w, color: s.color });

  const out: GradientStop[] = [];
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
  return finish(out);
}

/** Resolve against the local box: linear 0deg = up; radial defaults to box centre, half-diagonal radius. */
export function resolveGradient(
  g: GradientData,
  b: PaintBox,
): ResolvedGradient {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const stops = realizeStops(g.stops, g.repeating ?? false, g.interpolate);

  if (g.type === "conic-gradient") {
    const c = g.at ?? { x: cx, y: cy };
    // CSS conic 0deg is up; Canvas startAngle is from +x, so shift by −90°.
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
    // Inner circle at the focal point when given, else concentric.
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
