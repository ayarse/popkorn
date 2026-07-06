/**
 * Hit-testing for scene graph nodes
 * Determines which nodes the mouse pointer is over.
 *
 * Screen points are mapped into each node's local space via the inverse of the
 * world matrix from scene/transform.ts — the same matrix used for rendering — so
 * hover/active regions match what is painted exactly, including transform-origin.
 */

import type {
  SceneNode,
  RectData,
  CircleData,
  EllipseData,
  PathData,
} from '../scene/types';
import type { Matrix3x3, PathCommand } from '../renderer/types';
import { IDENTITY_MATRIX, invertMatrix, transformPoint } from '../renderer/types';
import { computeWorldMatrix } from '../scene/transform';

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
export function hitTest(root: SceneNode, point: Point): SceneNode | null {
  const results: HitTestResult[] = [];
  hitTestNode(root, point, IDENTITY_MATRIX, { value: 0 }, results);

  if (results.length === 0) return null;

  // Higher depth = painted later = on top
  results.sort((a, b) => b.depth - a.depth);
  return results[0].node;
}

/**
 * Get all interactive nodes at the given point
 * Returns nodes sorted by depth (topmost first)
 */
export function hitTestAll(root: SceneNode, point: Point): SceneNode[] {
  const results: HitTestResult[] = [];
  hitTestNode(root, point, IDENTITY_MATRIX, { value: 0 }, results);

  results.sort((a, b) => b.depth - a.depth);
  return results.map((r) => r.node);
}

/**
 * Recursively test nodes for hit, in paint order (parent before children).
 */
function hitTestNode(
  node: SceneNode,
  point: Point,
  parentWorld: Matrix3x3,
  order: { value: number },
  results: HitTestResult[]
): void {
  const world = computeWorldMatrix(node, parentWorld);
  const depth = order.value++;

  if (node.interactive) {
    const local = transformPoint(invertMatrix(world), point.x, point.y);
    if (isPointInShape(node, local)) {
      results.push({ node, depth });
    }
  }

  for (const child of node.children) {
    hitTestNode(child, point, world, order, results);
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
    case 'path':
      return isPointInPathShape(node.shapeData as PathData, point);
    case 'group':
      // Groups are not hit-testable themselves
      return false;
    default:
      return false;
  }
}

function isPointInRect(rect: RectData, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function isPointInCircle(circle: CircleData, point: Point): boolean {
  const dx = point.x - circle.cx;
  const dy = point.y - circle.cy;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

function isPointInEllipse(ellipse: EllipseData, point: Point): boolean {
  const dx = (point.x - ellipse.cx) / ellipse.rx;
  const dy = (point.y - ellipse.cy) / ellipse.ry;
  return dx * dx + dy * dy <= 1;
}

/**
 * Path hit-testing via Path2D + ctx.isPointInPath on a shared scratch context.
 * Falls back to false when neither Path2D nor a canvas context is available
 * (e.g. a headless test runner without a DOM).
 */
function isPointInPathShape(pathData: PathData, point: Point): boolean {
  const ctx = getScratchContext();
  if (!ctx || typeof Path2D === 'undefined') return false;
  const path = buildPath2D(pathData.commands);
  return ctx.isPointInPath(path, point.x, point.y);
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

/**
 * Build a Path2D from parsed path commands. Mirrors Canvas2DRenderer.drawPath,
 * including smooth-curve reflection; arcs are approximated as lines to match.
 */
function buildPath2D(commands: PathCommand[]): Path2D {
  const path = new Path2D();
  let currentX = 0;
  let currentY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCommand: string | null = null;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        path.moveTo(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'L':
        path.lineTo(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'H':
        path.lineTo(cmd.x, currentY);
        currentX = cmd.x;
        break;
      case 'V':
        path.lineTo(currentX, cmd.y);
        currentY = cmd.y;
        break;
      case 'C':
        path.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        lastControlX = cmd.x2;
        lastControlY = cmd.y2;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'S': {
        let cx1 = currentX;
        let cy1 = currentY;
        if (lastCommand === 'C' || lastCommand === 'S') {
          cx1 = 2 * currentX - lastControlX;
          cy1 = 2 * currentY - lastControlY;
        }
        path.bezierCurveTo(cx1, cy1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        lastControlX = cmd.x2;
        lastControlY = cmd.y2;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'Q':
        path.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        lastControlX = cmd.x1;
        lastControlY = cmd.y1;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'T': {
        let qx = currentX;
        let qy = currentY;
        if (lastCommand === 'Q' || lastCommand === 'T') {
          qx = 2 * currentX - lastControlX;
          qy = 2 * currentY - lastControlY;
        }
        path.quadraticCurveTo(qx, qy, cmd.x, cmd.y);
        lastControlX = qx;
        lastControlY = qy;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'A':
        // Arc approximated as a line, matching Canvas2DRenderer.
        path.lineTo(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'Z':
        path.closePath();
        break;
    }
    lastCommand = cmd.type;
  }

  return path;
}
