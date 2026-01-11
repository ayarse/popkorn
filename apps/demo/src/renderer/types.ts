// Color types
export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type Color = string | RGBAColor;

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
