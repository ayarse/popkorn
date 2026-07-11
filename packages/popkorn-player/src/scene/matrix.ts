// 3x3 affine matrix primitives — the low-level algebra beneath transform.ts.
// These live in scene/ (not renderer/) to honor the invariant that transform
// math is owned by the scene layer; renderer/types.ts re-exports them so every
// existing `../renderer/types` import path keeps working.

// 3x3 transformation matrix (row-major)
// [a, b, c]
// [d, e, f]
// [g, h, i]
export type Matrix3x3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// Identity matrix
export const IDENTITY_MATRIX: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

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
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

// Create translation matrix
export function translationMatrix(tx: number, ty: number): Matrix3x3 {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

// Create rotation matrix (angle in radians)
export function rotationMatrix(angle: number): Matrix3x3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
}

// Create scale matrix
export function scaleMatrix(sx: number, sy: number): Matrix3x3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
}

// Create skew matrix (angles in radians). ax shears x along y, ay shears y
// along x — matching CSS skew(ax, ay)/skewX/skewY.
export function skewMatrix(ax: number, ay: number): Matrix3x3 {
  return [1, Math.tan(ax), 0, Math.tan(ay), 1, 0, 0, 0, 1];
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
export function transformPoint(
  m: Matrix3x3,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: m[0] * x + m[1] * y + m[2],
    y: m[3] * x + m[4] * y + m[5],
  };
}
