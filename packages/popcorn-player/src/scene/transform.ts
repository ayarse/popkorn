import type { Matrix3x3 } from '../renderer/types';
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  translationMatrix,
  rotationMatrix,
  scaleMatrix,
} from '../renderer/types';
import type { SceneNode, TransformOriginValue, RectData, CircleData, EllipseData, TextData, PolystarData } from './types';
import { samplePathAt } from './path-parser';

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
    case 'star':
    case 'polygon': {
      // Outer-radius square around the center; exact enough for origins/clip.
      const s = node.shapeData as PolystarData;
      const r = s.outerRadius;
      return { x: s.cx - r, y: s.cy - r, width: r * 2, height: r * 2 };
    }
    case 'text': {
      const t = node.shapeData as TextData;
      const { width, height } = measureText(node, t);
      // Anchor shifts the box like ctx.textAlign does; baseline is alphabetic,
      // so the box sits above the y baseline.
      const x = t.anchor === 'middle' ? t.x - width / 2 : t.anchor === 'end' ? t.x - width : t.x;
      return { x, y: t.y - height, width, height };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/**
 * Measure a text node's width/height, cached on the node (invalidated by the
 * registry when font-size animates). Uses a lazily-created scratch 2D context —
 * the same pattern as the Path2D scratch in runtime/hit-test.ts.
 */
export function measureText(node: SceneNode, t: TextData): { width: number; height: number } {
  if (node.cachedTextBounds && !node.textBoundsDirty) return node.cachedTextBounds;

  const ctx = getScratchContext();
  let bounds: { width: number; height: number };
  if (ctx) {
    ctx.font = `${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
    bounds = { width: ctx.measureText(t.content).width, height: t.fontSize };
  } else {
    // ponytail: headless (no canvas) — estimate so tests/bun stay DOM-free.
    bounds = { width: 0.6 * t.fontSize * t.content.length, height: t.fontSize };
  }

  node.cachedTextBounds = bounds;
  node.textBoundsDirty = false;
  return bounds;
}

let scratchContext: CanvasRenderingContext2D | null | undefined;

function getScratchContext(): CanvasRenderingContext2D | null {
  if (scratchContext !== undefined) return scratchContext;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      scratchContext = new OffscreenCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D;
    } else if (typeof document !== 'undefined') {
      scratchContext = document.createElement('canvas').getContext('2d');
    } else {
      scratchContext = null;
    }
  } catch {
    scratchContext = null;
  }
  return scratchContext;
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
 * Compute the local transform matrix, including transform-origin and any CSS
 * Motion Path placement.
 * Order (CSS): translate -> motion-path (offset point -> offset rotate) ->
 * (move to origin -> rotate -> scale -> move back). The motion-path layer is an
 * independent placement applied after translate and before the node's own TRS.
 */
export function computeLocalMatrix(node: SceneNode): Matrix3x3 {
  const t = node.transform;
  const { x: ox, y: oy } = resolveTransformOrigin(node);
  const hasOrigin = ox !== 0 || oy !== 0;

  let matrix = translationMatrix(t.translateX, t.translateY);

  // Motion-path placement. At distance 0 (the default) or with no path we no-op,
  // so nodes without a motion path render exactly at their authored position.
  if (node.offsetPath && node.offsetDistance !== 0) {
    const s = samplePathAt(node.offsetPath, node.offsetDistance);
    matrix = multiplyMatrices(matrix, translationMatrix(s.x, s.y));
    const rot = node.offsetRotate.auto
      ? s.angle + (node.offsetRotate.angle * Math.PI) / 180
      : (node.offsetRotate.angle * Math.PI) / 180;
    if (rot !== 0) matrix = multiplyMatrices(matrix, rotationMatrix(rot));
  }

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
