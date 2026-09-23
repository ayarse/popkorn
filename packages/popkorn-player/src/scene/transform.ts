import type { Matrix3x3 } from "./matrix.js";
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  skewMatrix,
  translationMatrix,
} from "./matrix.js";
import { samplePathAt } from "./path-parser.js";
import { getShapeBounds } from "./shape-bounds.js";
import type { SceneNode, TransformOriginValue } from "./types.js";

function resolveOriginValue(
  v: TransformOriginValue,
  offset: number,
  dimension: number,
): number {
  // Percentages are relative to the shape's bounding box; pixels are absolute in local space.
  return v.unit === "%" ? offset + (v.value / 100) * dimension : v.value;
}

export function resolveTransformOrigin(node: SceneNode): {
  x: number;
  y: number;
} {
  const origin = node.transform.transformOrigin;
  const bounds = getShapeBounds(node);
  return {
    x: resolveOriginValue(origin.x, bounds.x, bounds.width),
    y: resolveOriginValue(origin.y, bounds.y, bounds.height),
  };
}

// Order (CSS): translate -> motion-path (point, rotate) -> origin sandwich around rotate/scale/skew.
export function computeLocalMatrix(node: SceneNode): Matrix3x3 {
  const t = node.transform;
  const { x: ox, y: oy } = resolveTransformOrigin(node);
  const hasOrigin = ox !== 0 || oy !== 0;

  let matrix = translationMatrix(t.translateX, t.translateY);

  // With a path, offset-distance 0 still places the node at the path start, per CSS.
  if (node.offsetPath) {
    const s = samplePathAt(node.offsetPath, node.offsetDistance);
    matrix = multiplyMatrices(matrix, translationMatrix(s.x, s.y));
    const rot = node.offsetRotate.auto
      ? s.angle + (node.offsetRotate.angle * Math.PI) / 180
      : (node.offsetRotate.angle * Math.PI) / 180;
    if (rot !== 0) matrix = multiplyMatrices(matrix, rotationMatrix(rot));
  }

  if (hasOrigin) matrix = multiplyMatrices(matrix, translationMatrix(ox, oy));
  if (t.rotate !== 0)
    matrix = multiplyMatrices(
      matrix,
      rotationMatrix((t.rotate * Math.PI) / 180),
    );
  if (t.scaleX !== 1 || t.scaleY !== 1)
    matrix = multiplyMatrices(matrix, scaleMatrix(t.scaleX, t.scaleY));
  if (t.skewX !== 0 || t.skewY !== 0)
    matrix = multiplyMatrices(
      matrix,
      skewMatrix((t.skewX * Math.PI) / 180, (t.skewY * Math.PI) / 180),
    );
  if (hasOrigin) matrix = multiplyMatrices(matrix, translationMatrix(-ox, -oy));

  return matrix;
}

export function computeWorldMatrix(
  node: SceneNode,
  parentWorld: Matrix3x3 = IDENTITY_MATRIX,
): Matrix3x3 {
  return multiplyMatrices(parentWorld, computeLocalMatrix(node));
}

// World matrix folded from the root, for callers without the parent's world matrix (e.g. masks).
export function computeWorldMatrixFromRoot(node: SceneNode | null): Matrix3x3 {
  if (!node) return IDENTITY_MATRIX;
  const chain: SceneNode[] = [];
  for (let n: SceneNode | null = node; n; n = n.parent) chain.push(n);
  let m = IDENTITY_MATRIX;
  for (let i = chain.length - 1; i >= 0; i--)
    m = multiplyMatrices(m, computeLocalMatrix(chain[i]));
  return m;
}
