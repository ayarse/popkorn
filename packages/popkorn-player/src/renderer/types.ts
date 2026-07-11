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
}

export interface RadialGradientData {
  type: "radial-gradient";
  stops: GradientStop[];
  // Explicit geometry in local space (`circle r at cx cy [from fx fy]`). When
  // present the renderer draws an exact circle instead of the bbox half-diagonal.
  radius?: number;
  at?: GradientPoint;
  focal?: GradientPoint; // inner-circle center (Lottie highlight); defaults to `at`
}

export type GradientData = LinearGradientData | RadialGradientData;

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
  return g.type === "linear-gradient"
    ? {
        type: "linear-gradient",
        angle: g.angle,
        stops,
        from: pt(g.from),
        to: pt(g.to),
      }
    : {
        type: "radial-gradient",
        stops,
        radius: g.radius,
        at: pt(g.at),
        focal: pt(g.focal),
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

// Parse color string to RGBA
export function parseColor(value: string): RGBAColor {
  // Handle hex colors
  if (value.startsWith("#")) {
    const hex = value.slice(1);
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
  }

  // Handle rgb/rgba
  const rgbaMatch = value.match(
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

  // Default to black
  return { r: 0, g: 0, b: 0, a: 1 };
}
