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
import type { Matrix3x3, PathCommand, ResolvedClip } from '../renderer/types';
import { IDENTITY_MATRIX, invertMatrix, transformPoint } from '../renderer/types';
import { computeWorldMatrix } from '../scene/transform';
import { resolveClip } from '../scene/clip';
import { applyCommandsToPath } from '../scene/path-parser';

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
  const local = transformPoint(invertMatrix(world), point.x, point.y);

  // A point outside this node's clip region can hit neither the node nor any of
  // its descendants — the clip is applied in this node's local space, matching
  // the renderer.
  const clip = resolveClip(node);
  if (clip && !isPointInClip(clip, local)) return;

  if (node.interactive && isPointInShape(node, local)) {
    results.push({ node, depth });
  }

  for (const child of node.children) {
    hitTestNode(child, point, world, order, results);
  }
}

/**
 * Test whether a local-space point lies inside a resolved clip region.
 * circle/rect are pure math; path reuses the Path2D scratch context and, like
 * path hit-testing, degrades to `false` (rejects) when no DOM is available.
 */
function isPointInClip(clip: ResolvedClip, point: Point): boolean {
  switch (clip.type) {
    case 'rect':
      return (
        point.x >= clip.x &&
        point.x <= clip.x + clip.width &&
        point.y >= clip.y &&
        point.y <= clip.y + clip.height
      );
    case 'circle': {
      const dx = point.x - clip.cx;
      const dy = point.y - clip.cy;
      return dx * dx + dy * dy <= clip.r * clip.r;
    }
    case 'path': {
      const ctx = getScratchContext();
      if (!ctx || typeof Path2D === 'undefined') return false;
      return ctx.isPointInPath(buildPath2D(clip.commands), point.x, point.y);
    }
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
 * Build a Path2D from parsed path commands using the same emitter as the
 * renderer (scene/path-parser), so hit geometry matches paint exactly —
 * including real elliptical arcs.
 */
function buildPath2D(commands: PathCommand[]): Path2D {
  const path = new Path2D();
  applyCommandsToPath(path, commands);
  return path;
}
