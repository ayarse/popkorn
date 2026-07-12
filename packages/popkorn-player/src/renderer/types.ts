// Color types
export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type Color = string | RGBAColor;

// Gradient fill/stroke descriptor. Structured (not a raw CSS string) so the
// renderer can realize it against each shape's local bounding box at draw time.
export interface GradientStop {
  offset: number; // 0-1
  color: string; // any CSS color string (hex or rgb/rgba)
}

// A 2D point in the shape's local coordinate space.
export interface GradientPoint {
  x: number;
  y: number;
}

export interface LinearGradientData {
  type: "linear-gradient";
  angle: number; // CSS degrees: 0 = up, 90 = right
  stops: GradientStop[];
  // Explicit endpoints in local space (`from x y to x y`). When present the
  // renderer draws point-to-point and ignores `angle`/the bbox approximation.
  from?: GradientPoint;
  to?: GradientPoint;
  // `repeating-linear-gradient()`: the stop run tiles across the axis. Not
  // interpolable (a mismatch replaces rather than morphs — see registry).
  repeating?: boolean;
}

export interface RadialGradientData {
  type: "radial-gradient";
  stops: GradientStop[];
  // Explicit geometry in local space (`circle r at cx cy [from fx fy]`). When
  // present the renderer draws an exact circle instead of the bbox half-diagonal.
  radius?: number;
  at?: GradientPoint;
  focal?: GradientPoint; // inner-circle center (Lottie highlight); defaults to `at`
  repeating?: boolean; // `repeating-radial-gradient()` — tiles outward
}

export interface ConicGradientData {
  type: "conic-gradient";
  from: number; // CSS degrees the sweep starts at (0 = up, clockwise)
  stops: GradientStop[]; // offsets are 0-1 fractions of the full turn
  at?: GradientPoint; // sweep centre in local space; defaults to the box centre
  repeating?: boolean; // `repeating-conic-gradient()` — tiles around the turn
}

export type GradientData =
  | LinearGradientData
  | RadialGradientData
  | ConicGradientData;

// Runtime type guard: a GradientData carries a `stops` array. Used by the
// animation registry to dispatch fill/stroke interpolation by value type
// (a solid fill is a color string, an animated gradient is this object).
export function isGradientData(v: unknown): v is GradientData {
  return (
    typeof v === "object" && v !== null && !Array.isArray(v) && "stops" in v
  );
}

// Deep-copy a gradient so a live (per-frame interpolated) value never aliases
// the authored base's stop objects. Cheap: gradients have a handful of stops.
export function cloneGradient(g: GradientData | null): GradientData | null {
  if (!g) return null;
  const stops = g.stops.map((s) => ({ offset: s.offset, color: s.color }));
  const pt = (p?: GradientPoint) => (p ? { x: p.x, y: p.y } : undefined);
  if (g.type === "linear-gradient")
    return {
      type: "linear-gradient",
      angle: g.angle,
      stops,
      from: pt(g.from),
      to: pt(g.to),
      repeating: g.repeating,
    };
  if (g.type === "conic-gradient")
    return {
      type: "conic-gradient",
      from: g.from,
      stops,
      at: pt(g.at),
      repeating: g.repeating,
    };
  return {
    type: "radial-gradient",
    stops,
    radius: g.radius,
    at: pt(g.at),
    focal: pt(g.focal),
    repeating: g.repeating,
  };
}

// Resolved trim-path descriptor for the stroke, expressed in the shape's local
// outline-length units. The scene layer computes this (window -> dash pattern);
// the renderer just applies it to the stroke via setLineDash/lineDashOffset.
export interface TrimDescriptor {
  visible: boolean; // false => the trim window is empty, stroke nothing
  dashArray: number[]; // [] => stroke the whole outline (no dashing)
  dashOffset: number; // maps to ctx.lineDashOffset
}

// A clip-path resolved to concrete local-space geometry (insets already applied
// against the node's bounding box). Shared by the renderer and hit-test so both
// clip/reject against identical geometry.
export type ResolvedClip =
  | { type: "rect"; x: number; y: number; width: number; height: number }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "path"; commands: PathCommand[] };

// Path command types (SVG-style)
export type PathCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "H"; x: number }
  | { type: "V"; y: number }
  | {
      type: "C";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | { type: "S"; x2: number; y2: number; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "T"; x: number; y: number }
  | {
      type: "A";
      rx: number;
      ry: number;
      angle: number;
      largeArc: boolean;
      sweep: boolean;
      x: number;
      y: number;
    }
  | { type: "Z" };

// Per-corner rect radii in CSS border-radius order: [top-left, top-right,
// bottom-right, bottom-left]. Circular only (one radius per corner) — the
// elliptical slash form is not represented (see roundedRectPath NOTE). Present
// on a RectData only when the corners differ; a uniform radius stays on rx/ry.
export type CornerRadii = readonly [number, number, number, number];

// Rec.709 luma coefficients (sRGB), shared by every backend's luminance matte
// so a luminance mask reads identically across Canvas2D and Skia. (The SVG
// backend uses feColorMatrix type="luminanceToAlpha", the browser built-in.)
export const LUMA_COEFFICIENTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

// Affine matrix math lives in scene/matrix.ts (the scene layer owns transform
// math). Re-exported here so `../renderer/types` import paths keep working.
export type { Matrix3x3 } from "../scene/matrix";
export {
  IDENTITY_MATRIX,
  invertMatrix,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix,
} from "../scene/matrix";

// Helper to convert Color to CSS string
export function colorToCSS(color: Color): string {
  if (typeof color === "string") {
    return color;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

// HSL → RGB. Copy of the math in @popkorn/converters
// (svg2popkorn.ts `hslToRgb`) — deliberately duplicated so the player stays
// dependency-free; keep the two in sync.
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ];
}

// A pragmatic subset of the CSS named colors — the ones that show up in
// hand-authored scenes. Copy of @popkorn/converters `NAMED`
// (svg2popkorn.ts); duplicated to keep the player dependency-free — keep the
// two in sync. (Deliberately NOT the full 148-name table.)
const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  lime: [0, 255, 0],
  aqua: [0, 255, 255],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  fuchsia: [255, 0, 255],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  gold: [255, 215, 0],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  crimson: [220, 20, 60],
  coral: [255, 127, 80],
  salmon: [250, 128, 114],
  khaki: [240, 230, 140],
  orchid: [218, 112, 214],
  plum: [221, 160, 221],
  tan: [210, 180, 140],
  turquoise: [64, 224, 208],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  darkblue: [0, 0, 139],
  darkgreen: [0, 100, 0],
  darkred: [139, 0, 0],
  steelblue: [70, 130, 180],
  slategray: [112, 128, 144],
  skyblue: [135, 206, 235],
  tomato: [255, 99, 71],
  seagreen: [46, 139, 87],
  royalblue: [65, 105, 225],
  dodgerblue: [30, 144, 255],
};

// Parse a color string to RGBA, or null when unrecognized. Handles hex,
// rgb/rgba, hsl/hsla, and the named-color subset above.
export function tryParseColor(value: string): RGBAColor | null {
  const s = value.trim().toLowerCase();

  // Handle hex colors
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 1 };
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 1 };
    } else if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return { r, g, b, a };
    }
    return null;
  }

  // Handle rgb/rgba
  const rgbaMatch = s.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/,
  );
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // Handle hsl/hsla
  const hslMatch = s.match(/^hsla?\(([^)]*)\)$/);
  if (hslMatch) {
    const parts = hslMatch[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = hslToRgb(
      parseFloat(parts[0]),
      parseFloat(parts[1]) / 100,
      parseFloat(parts[2]) / 100,
    );
    return { r, g, b, a: parts[3] != null ? parseFloat(parts[3]) : 1 };
  }

  // Named colors
  const named = NAMED_COLORS[s];
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 };

  return null;
}

// Parse color string to RGBA, defaulting unknown input to opaque black. Kept
// total (never null) for the render/interpolation hot paths that rely on it.
export function parseColor(value: string): RGBAColor {
  return tryParseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
}
