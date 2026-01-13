/**
 * Hit-testing for scene graph nodes
 * Determines which nodes the mouse pointer is over
 */

import type {
  SceneNode,
  RectData,
  CircleData,
  EllipseData,
} from '../scene/types';

export interface Point {
  x: number;
  y: number;
}

export interface HitTestResult {
  node: SceneNode;
  depth: number;
}

/**
 * Perform hit-testing on the scene graph
 * Returns the topmost interactive node at the given point
 */
export function hitTest(
  root: SceneNode,
  point: Point
): SceneNode | null {
  const results: HitTestResult[] = [];
  hitTestNode(root, point, { x: 0, y: 0 }, 1, 1, 0, 0, results);

  if (results.length === 0) {
    return null;
  }

  // Sort by depth (higher depth = rendered later = on top)
  results.sort((a, b) => b.depth - a.depth);
  return results[0].node;
}

/**
 * Get all interactive nodes at the given point
 * Returns nodes sorted by depth (topmost first)
 */
export function hitTestAll(
  root: SceneNode,
  point: Point
): SceneNode[] {
  const results: HitTestResult[] = [];
  hitTestNode(root, point, { x: 0, y: 0 }, 1, 1, 0, 0, results);

  // Sort by depth (higher depth = rendered later = on top)
  results.sort((a, b) => b.depth - a.depth);
  return results.map(r => r.node);
}

/**
 * Recursively test nodes for hit
 */
function hitTestNode(
  node: SceneNode,
  point: Point,
  parentTranslation: Point,
  parentScaleX: number,
  parentScaleY: number,
  parentRotation: number,
  depth: number,
  results: HitTestResult[]
): void {
  // Calculate cumulative transform
  const transform = node.transform;

  // Apply parent transform, then local transform
  const scaleX = parentScaleX * transform.scaleX;
  const scaleY = parentScaleY * transform.scaleY;
  const rotation = parentRotation + transform.rotate;

  // Calculate the translation in world space
  // We need to account for parent rotation when applying local translation
  const cosR = Math.cos(parentRotation * Math.PI / 180);
  const sinR = Math.sin(parentRotation * Math.PI / 180);

  const localTx = transform.translateX;
  const localTy = transform.translateY;

  const worldTx = parentTranslation.x + (localTx * cosR - localTy * sinR) * parentScaleX;
  const worldTy = parentTranslation.y + (localTx * sinR + localTy * cosR) * parentScaleY;

  const translation = { x: worldTx, y: worldTy };

  // Transform point to local coordinates for hit testing
  const localPoint = transformPointToLocal(
    point,
    translation,
    scaleX,
    scaleY,
    rotation,
    node
  );

  // Test if point is inside this node's shape
  if (node.interactive && isPointInShape(node, localPoint)) {
    results.push({ node, depth });
  }

  // Test children (in render order)
  for (let i = 0; i < node.children.length; i++) {
    hitTestNode(
      node.children[i],
      point,
      translation,
      scaleX,
      scaleY,
      rotation,
      depth + i + 1,
      results
    );
  }
}

/**
 * Transform a point from world coordinates to local shape coordinates
 */
function transformPointToLocal(
  point: Point,
  translation: Point,
  scaleX: number,
  scaleY: number,
  rotation: number,
  node: SceneNode
): Point {
  // Translate to local origin
  let x = point.x - translation.x;
  let y = point.y - translation.y;

  // Get transform origin for rotation/scale
  const origin = getTransformOrigin(node);

  // Move to origin point
  x -= origin.x;
  y -= origin.y;

  // Reverse rotation
  if (rotation !== 0) {
    const rad = -rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    x = rx;
    y = ry;
  }

  // Reverse scale
  if (scaleX !== 0) x /= scaleX;
  if (scaleY !== 0) y /= scaleY;

  // Move back from origin point
  x += origin.x;
  y += origin.y;

  return { x, y };
}

/**
 * Get the transform origin in local coordinates
 */
function getTransformOrigin(node: SceneNode): Point {
  const origin = node.transform.transformOrigin;
  const bounds = getShapeBounds(node);

  let originX = origin.x.value;
  let originY = origin.y.value;

  if (origin.x.unit === '%') {
    originX = bounds.x + (origin.x.value / 100) * bounds.width;
  }
  if (origin.y.unit === '%') {
    originY = bounds.y + (origin.y.value / 100) * bounds.height;
  }

  return { x: originX, y: originY };
}

/**
 * Get the bounding box of a shape
 */
function getShapeBounds(node: SceneNode): { x: number; y: number; width: number; height: number } {
  switch (node.shapeData.type) {
    case 'rect': {
      const r = node.shapeData as RectData;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    case 'circle': {
      const c = node.shapeData as CircleData;
      return {
        x: c.cx - c.r,
        y: c.cy - c.r,
        width: c.r * 2,
        height: c.r * 2,
      };
    }
    case 'ellipse': {
      const e = node.shapeData as EllipseData;
      return {
        x: e.cx - e.rx,
        y: e.cy - e.ry,
        width: e.rx * 2,
        height: e.ry * 2,
      };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/**
 * Test if a point (in local coordinates) is inside a shape
 */
function isPointInShape(node: SceneNode, point: Point): boolean {
  switch (node.shapeData.type) {
    case 'rect':
      return isPointInRect(node.shapeData as RectData, point);
    case 'circle':
      return isPointInCircle(node.shapeData as CircleData, point);
    case 'ellipse':
      return isPointInEllipse(node.shapeData as EllipseData, point);
    case 'group':
      // Groups are not hit-testable themselves
      return false;
    case 'path':
      // Path hit-testing is complex - for now, use bounding box
      // TODO: Implement proper path hit-testing
      return false;
    default:
      return false;
  }
}

/**
 * Test if a point is inside a rectangle
 */
function isPointInRect(rect: RectData, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Test if a point is inside a circle
 */
function isPointInCircle(circle: CircleData, point: Point): boolean {
  const dx = point.x - circle.cx;
  const dy = point.y - circle.cy;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

/**
 * Test if a point is inside an ellipse
 */
function isPointInEllipse(ellipse: EllipseData, point: Point): boolean {
  const dx = (point.x - ellipse.cx) / ellipse.rx;
  const dy = (point.y - ellipse.cy) / ellipse.ry;
  return dx * dx + dy * dy <= 1;
}
