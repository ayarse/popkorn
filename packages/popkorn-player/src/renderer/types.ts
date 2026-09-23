import type { HueMethod } from "./oklab.js";

export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type Color = string | RGBAColor;

// Structured so the renderer realizes it against each shape's local box at draw time.
export interface GradientStop {
  offset: number; // 0-1
  color: string; // any CSS color string (hex or rgb/rgba)
}

// A 2D point in the shape's local coordinate space.
export interface GradientPoint {
  x: number;
  y: number;
}

// `in <space>` (CSS Images 4); absent = sRGB. Densified to sRGB stops before any backend sees it.
export interface GradientInterpolation {
  space: "oklab" | "oklch";
  hue?: HueMethod; // oklch only; CSS default is `shorter`
}

export interface LinearGradientData {
  type: "linear-gradient";
  angle: number; // CSS degrees: 0 = up, 90 = right
  stops: GradientStop[];
  // Explicit local-space endpoints (`from x y to x y`); override `angle`.
  from?: GradientPoint;
  to?: GradientPoint;
  // Not interpolable: a mismatch replaces rather than morphs.
  repeating?: boolean;
  interpolate?: GradientInterpolation;
}

export interface RadialGradientData {
  type: "radial-gradient";
  stops: GradientStop[];
  // Explicit local-space circle (`circle r at cx cy [from fx fy]`).
  radius?: number;
  at?: GradientPoint;
  focal?: GradientPoint; // inner-circle center (Lottie highlight); defaults to `at`
  repeating?: boolean; // `repeating-radial-gradient()` — tiles outward
  interpolate?: GradientInterpolation;
}

export interface ConicGradientData {
  type: "conic-gradient";
  from: number; // CSS degrees the sweep starts at (0 = up, clockwise)
  stops: GradientStop[]; // offsets are 0-1 fractions of the full turn
  at?: GradientPoint; // sweep centre in local space; defaults to the box centre
  repeating?: boolean; // `repeating-conic-gradient()` — tiles around the turn
  interpolate?: GradientInterpolation;
}

export type GradientData =
  | LinearGradientData
  | RadialGradientData
  | ConicGradientData;

// A gradient carries `stops`; a solid fill is a color string.
export function isGradientData(v: unknown): v is GradientData {
  return (
    typeof v === "object" && v !== null && !Array.isArray(v) && "stops" in v
  );
}

// Trim-path window as a dash pattern in local outline-length units.
export interface TrimDescriptor {
  visible: boolean; // false => the trim window is empty, stroke nothing
  dashArray: number[]; // [] => stroke the whole outline (no dashing)
  dashOffset: number; // maps to ctx.lineDashOffset
}

// Clip-path in local-space geometry, shared by renderer and hit-test.
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

// [tl, tr, br, bl], circular only; set only when corners differ (uniform stays on rx/ry).
export type CornerRadii = readonly [number, number, number, number];

// Rec.709 luma (sRGB) for Canvas2D and Skia luminance mattes; SVG uses luminanceToAlpha.
export const LUMA_COEFFICIENTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;
