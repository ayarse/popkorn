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
  color: string;  // any CSS color string (hex or rgb/rgba)
}

// A 2D point in the shape's local coordinate space.
export interface GradientPoint {
  x: number;
  y: number;
}

export interface LinearGradientData {
  type: 'linear-gradient';
  angle: number; // CSS degrees: 0 = up, 90 = right
  stops: GradientStop[];
  // Explicit endpoints in local space (`from x y to x y`). When present the
  // renderer draws point-to-point and ignores `angle`/the bbox approximation.
  from?: GradientPoint;
  to?: GradientPoint;
}

export interface RadialGradientData {
  type: 'radial-gradient';
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
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'stops' in v;
}

// Deep-copy a gradient so a live (per-frame interpolated) value never aliases
// the authored base's stop objects. Cheap: gradients have a handful of stops.
export function cloneGradient(g: GradientData | null): GradientData | null {
  if (!g) return null;
  const stops = g.stops.map((s) => ({ offset: s.offset, color: s.color }));
  const pt = (p?: GradientPoint) => (p ? { x: p.x, y: p.y } : undefined);
  return g.type === 'linear-gradient'
    ? { type: 'linear-gradient', angle: g.angle, stops, from: pt(g.from), to: pt(g.to) }
    : { type: 'radial-gradient', stops, radius: g.radius, at: pt(g.at), focal: pt(g.focal) };
}

// Resolved trim-path descriptor for the stroke, expressed in the shape's local
// outline-length units. The scene layer computes this (window -> dash pattern);
// the renderer just applies it to the stroke via setLineDash/lineDashOffset.
export interface TrimDescriptor {
  visible: boolean;     // false => the trim window is empty, stroke nothing
  dashArray: number[];  // [] => stroke the whole outline (no dashing)
  dashOffset: number;   // maps to ctx.lineDashOffset
}

// A clip-path resolved to concrete local-space geometry (insets already applied
// against the node's bounding box). Shared by the renderer and hit-test so both
// clip/reject against identical geometry.
export type ResolvedClip =
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'path'; commands: PathCommand[] };

// Path command types (SVG-style)
export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'H'; x: number }
  | { type: 'V'; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'S'; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'T'; x: number; y: number }
  | { type: 'A'; rx: number; ry: number; angle: number; largeArc: boolean; sweep: boolean; x: number; y: number }
  | { type: 'Z' };

// Rec.709 luma coefficients (sRGB), shared by every backend's luminance matte
// so a luminance mask reads identically across Canvas2D and Skia. (The SVG
// backend uses feColorMatrix type="luminanceToAlpha", the browser built-in.)
export const LUMA_COEFFICIENTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

// 3x3 transformation matrix (row-major)
// [a, b, c]
// [d, e, f]
// [g, h, i]
export type Matrix3x3 = [
  number, number, number,
  number, number, number,
  number, number, number
];

// Identity matrix
export const IDENTITY_MATRIX: Matrix3x3 = [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1
];

// Helper to convert Color to CSS string
export function colorToCSS(color: Color): string {
  if (typeof color === 'string') {
    return color;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

// Parse color string to RGBA
export function parseColor(value: string): RGBAColor {
  // Handle hex colors
  if (value.startsWith('#')) {
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
  const rgbaMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1
    };
  }

  // Default to black
  return { r: 0, g: 0, b: 0, a: 1 };
}

// Matrix multiplication
export function multiplyMatrices(a: Matrix3x3, b: Matrix3x3): Matrix3x3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8]
  ];
}

// Create translation matrix
export function translationMatrix(tx: number, ty: number): Matrix3x3 {
  return [
    1, 0, tx,
    0, 1, ty,
    0, 0, 1
  ];
}

// Create rotation matrix (angle in radians)
export function rotationMatrix(angle: number): Matrix3x3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    cos, -sin, 0,
    sin, cos, 0,
    0, 0, 1
  ];
}

// Create scale matrix
export function scaleMatrix(sx: number, sy: number): Matrix3x3 {
  return [
    sx, 0, 0,
    0, sy, 0,
    0, 0, 1
  ];
}

// Invert a 3x3 matrix (returns identity if non-invertible)
export function invertMatrix(m: Matrix3x3): Matrix3x3 {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (det === 0) return IDENTITY_MATRIX;
  const invDet = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * invDet,
    (m[2] * m[7] - m[1] * m[8]) * invDet,
    (m[1] * m[5] - m[2] * m[4]) * invDet,
    (m[5] * m[6] - m[3] * m[8]) * invDet,
    (m[0] * m[8] - m[2] * m[6]) * invDet,
    (m[2] * m[3] - m[0] * m[5]) * invDet,
    (m[3] * m[7] - m[4] * m[6]) * invDet,
    (m[1] * m[6] - m[0] * m[7]) * invDet,
    (m[0] * m[4] - m[1] * m[3]) * invDet,
  ];
}

// Apply an affine matrix to a point
export function transformPoint(m: Matrix3x3, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[1] * y + m[2],
    y: m[3] * x + m[4] * y + m[5],
  };
}
