import type { Matrix3x3 } from '../renderer/types';
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  translationMatrix,
  rotationMatrix,
  scaleMatrix,
} from '../renderer/types';
import type { Transform, SceneNode } from './types';

/**
 * Compute the local transform matrix from Transform properties
 */
export function computeLocalMatrix(transform: Transform): Matrix3x3 {
  // Order: translate -> rotate -> scale (around anchor)
  let matrix = IDENTITY_MATRIX;

  // Translate to position
  if (transform.translateX !== 0 || transform.translateY !== 0) {
    matrix = multiplyMatrices(matrix, translationMatrix(transform.translateX, transform.translateY));
  }

  // Rotate around anchor
  if (transform.rotate !== 0) {
    const angleRad = transform.rotate * Math.PI / 180;
    matrix = multiplyMatrices(matrix, rotationMatrix(angleRad));
  }

  // Scale
  if (transform.scaleX !== 1 || transform.scaleY !== 1) {
    matrix = multiplyMatrices(matrix, scaleMatrix(transform.scaleX, transform.scaleY));
  }

  return matrix;
}

/**
 * Compute world transform by multiplying parent's world transform with local transform
 */
export function computeWorldMatrix(node: SceneNode, parentWorld: Matrix3x3 = IDENTITY_MATRIX): Matrix3x3 {
  const localMatrix = computeLocalMatrix(node.transform);
  return multiplyMatrices(parentWorld, localMatrix);
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
 * Interpolate between two transforms
 * Note: Uses direct lerp for rotation to support full 360deg rotations in animations
 */
export function interpolateTransform(a: Transform, b: Transform, t: number): Transform {
  return {
    translateX: lerp(a.translateX, b.translateX, t),
    translateY: lerp(a.translateY, b.translateY, t),
    rotate: lerp(a.rotate, b.rotate, t), // Direct lerp, not shortest path
    scaleX: lerp(a.scaleX, b.scaleX, t),
    scaleY: lerp(a.scaleY, b.scaleY, t),
    anchorX: lerp(a.anchorX, b.anchorX, t),
    anchorY: lerp(a.anchorY, b.anchorY, t),
  };
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
