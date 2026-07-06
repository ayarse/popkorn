import type { Matrix3x3 } from '../renderer/types';
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  translationMatrix,
  rotationMatrix,
  scaleMatrix,
} from '../renderer/types';
import type { SceneNode, TransformOriginValue, RectData, CircleData, EllipseData } from './types';

/**
 * Axis-aligned bounding box of a shape in its local coordinate space.
 * Groups and paths have no intrinsic box, so percentage origins resolve to 0.
 */
export function getShapeBounds(node: SceneNode): { x: number; y: number; width: number; height: number } {
  switch (node.shapeData.type) {
    case 'rect': {
      const r = node.shapeData as RectData;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    case 'circle': {
      const c = node.shapeData as CircleData;
      return { x: c.cx - c.r, y: c.cy - c.r, width: c.r * 2, height: c.r * 2 };
    }
    case 'ellipse': {
      const e = node.shapeData as EllipseData;
      return { x: e.cx - e.rx, y: e.cy - e.ry, width: e.rx * 2, height: e.ry * 2 };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function resolveOriginValue(v: TransformOriginValue, offset: number, dimension: number): number {
  // Percentages are relative to the shape's bounding box; pixels are absolute in local space.
  return v.unit === '%' ? offset + (v.value / 100) * dimension : v.value;
}

/**
 * Resolve transform-origin to pixel values in the node's local coordinate space.
 */
export function resolveTransformOrigin(node: SceneNode): { x: number; y: number } {
  const origin = node.transform.transformOrigin;
  const bounds = getShapeBounds(node);
  return {
    x: resolveOriginValue(origin.x, bounds.x, bounds.width),
    y: resolveOriginValue(origin.y, bounds.y, bounds.height),
  };
}

/**
 * Compute the local transform matrix, including transform-origin.
 * Order (CSS): translate -> (move to origin -> rotate -> scale -> move back).
 */
export function computeLocalMatrix(node: SceneNode): Matrix3x3 {
  const t = node.transform;
  const { x: ox, y: oy } = resolveTransformOrigin(node);
  const hasOrigin = ox !== 0 || oy !== 0;

  let matrix = translationMatrix(t.translateX, t.translateY);
  if (hasOrigin) matrix = multiplyMatrices(matrix, translationMatrix(ox, oy));
  if (t.rotate !== 0) matrix = multiplyMatrices(matrix, rotationMatrix(t.rotate * Math.PI / 180));
  if (t.scaleX !== 1 || t.scaleY !== 1) matrix = multiplyMatrices(matrix, scaleMatrix(t.scaleX, t.scaleY));
  if (hasOrigin) matrix = multiplyMatrices(matrix, translationMatrix(-ox, -oy));

  return matrix;
}

/**
 * Compute world transform by multiplying parent's world transform with local transform
 */
export function computeWorldMatrix(node: SceneNode, parentWorld: Matrix3x3 = IDENTITY_MATRIX): Matrix3x3 {
  return multiplyMatrices(parentWorld, computeLocalMatrix(node));
}

/**
 * Recursively compute world transforms for all nodes in the scene graph
 */
export function computeAllWorldTransforms(
  root: SceneNode,
  worldMatrices: Map<string, Matrix3x3> = new Map(),
  parentWorld: Matrix3x3 = IDENTITY_MATRIX
): Map<string, Matrix3x3> {
  const worldMatrix = computeWorldMatrix(root, parentWorld);
  worldMatrices.set(root.id, worldMatrix);

  for (const child of root.children) {
    computeAllWorldTransforms(child, worldMatrices, worldMatrix);
  }

  return worldMatrices;
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Angle interpolation (handles wrap-around)
 */
export function lerpAngle(a: number, b: number, t: number): number {
  // Normalize angles to 0-360
  a = ((a % 360) + 360) % 360;
  b = ((b % 360) + 360) % 360;

  // Find shortest path
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  return a + diff * t;
}
