// Uses the same world matrix as rendering (scene/transform.ts), so hit regions match paint exactly.

import type { PathCommand, ResolvedClip } from "../renderer/types.js";
import { resolveClip } from "../scene/clip.js";
import type { Matrix3x3 } from "../scene/matrix.js";
import {
  IDENTITY_MATRIX,
  invertMatrix,
  transformPoint,
} from "../scene/matrix.js";
import { childrenInPaintOrder } from "../scene/node.js";
import { flattenToSubpaths } from "../scene/path-parser.js";
import { polystarCommands } from "../scene/polystar.js";
import { computeWorldMatrix, getShapeBounds } from "../scene/transform.js";
import type { EllipseData, FillRule, SceneNode } from "../scene/types.js";

export interface Point {
  x: number;
  y: number;
}

type Rect = { x: number; y: number; width: number; height: number };
type Circle = { cx: number; cy: number; r: number };

/** Last containing shape (preorder = paint order) and the last one credited to an interactive node. */
interface Found {
  shape: SceneNode | null;
  shapeCredit: SceneNode | null;
  credited: SceneNode | null;
}

/** Topmost interactive node; any containing shape credits its nearest interactive ancestor-or-self (DOM bubbling). */
export function hitTest(root: SceneNode, point: Point): SceneNode | null {
  return walk(root, point).credited;
}

/** Credited node plus its root → node id path. */
export interface ClickHit {
  node: SceneNode;
  path: string[];
}

/** Topmost shape of any kind, credited to its nearest interactive ancestor if any. */
export function hitTestClick(root: SceneNode, point: Point): ClickHit | null {
  const found = walk(root, point);
  if (!found.shape) return null;
  const target = found.shapeCredit ?? found.shape;
  return { node: target, path: ancestorPath(target) };
}

function walk(root: SceneNode, point: Point): Found {
  const found: Found = { shape: null, shapeCredit: null, credited: null };
  hitTestNode(root, point, IDENTITY_MATRIX, null, found);
  return found;
}

function ancestorPath(node: SceneNode): string[] {
  const ids: string[] = [];
  for (let n: SceneNode | null = node; n; n = n.parent) ids.push(n.id);
  return ids.reverse();
}

function hitTestNode(
  node: SceneNode,
  point: Point,
  parentWorld: Matrix3x3,
  nearestInteractive: SceneNode | null,
  found: Found,
): void {
  // Same gating as the render walk.
  if (node.hidden || node.displayNone) return;

  // Mask sources never paint on their own; masked content hit-tests normally.
  if (node.isMaskSource) return;

  // pointer-events: none drops the whole subtree; descendants can't opt back in.
  if (node.pointerEvents === "none") return;

  const world = computeWorldMatrix(node, parentWorld);
  const local = transformPoint(invertMatrix(world), point.x, point.y);

  const clip = resolveClip(node);
  if (clip && !isPointInClip(clip, local, node.fillRule)) return;

  const credited = node.interactive ? node : nearestInteractive;

  // Groups have no geometry, so they're only credited via descendants.
  if (isPointInShape(node, local)) {
    found.shape = node;
    found.shapeCredit = credited;
    if (credited) found.credited = credited;
  }

  for (const child of childrenInPaintOrder(node)) {
    hitTestNode(child, point, world, credited, found);
  }
}

/** Pure math (no Path2D), so it works headless and on React Native. */
function isPointInClip(
  clip: ResolvedClip,
  point: Point,
  fillRule: FillRule,
): boolean {
  switch (clip.type) {
    case "rect":
      return isPointInRect(clip, point);
    case "circle":
      return isPointInCircle(clip, point);
    case "path":
      return isPointInCommands(clip.commands, point, fillRule);
  }
}

function isPointInShape(node: SceneNode, point: Point): boolean {
  const sd = node.shapeData;
  switch (sd.type) {
    case "rect":
      return isPointInRect(sd, point);
    case "circle":
      return isPointInCircle(sd, point);
    case "ellipse":
      return isPointInEllipse(sd, point);
    case "path":
      return isPointInCommands(sd.commands, point, node.fillRule);
    case "star":
    case "polygon":
      return isPointInCommands(polystarCommands(node), point, node.fillRule);
    case "text":
    case "image":
      return isPointInRect(getShapeBounds(node), point);
    default:
      return false;
  }
}

function isPointInRect(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function isPointInCircle(circle: Circle, point: Point): boolean {
  const dx = point.x - circle.cx;
  const dy = point.y - circle.cy;
  return dx * dx + dy * dy <= circle.r * circle.r;
}

function isPointInEllipse(ellipse: EllipseData, point: Point): boolean {
  const dx = (point.x - ellipse.cx) / ellipse.rx;
  const dy = (point.y - ellipse.cy) / ellipse.ry;
  return dx * dx + dy * dy <= 1;
}

/** Flattened point-in-polygon, no Path2D; subpaths implicitly closed like canvas fill. */
function isPointInCommands(
  commands: PathCommand[],
  point: Point,
  fillRule: FillRule,
): boolean {
  const subpaths = flattenToSubpaths(commands);
  if (fillRule === "evenodd") {
    let crossings = 0;
    for (const poly of subpaths) crossings += rayCrossings(poly, point);
    return (crossings & 1) === 1;
  }
  let winding = 0;
  for (const poly of subpaths) winding += windingNumber(poly, point);
  return winding !== 0;
}

/** `> 0` if `point` is left of a→b, `< 0` if right, `0` if collinear. */
function isLeft(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  return (bx - ax) * (py - ay) - (px - ax) * (by - ay);
}

/** Sunday's winding-number algorithm. */
function windingNumber(poly: Point[], point: Point): number {
  let wn = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n]; // wrap closes the subpath
    if (a.y <= point.y) {
      if (b.y > point.y && isLeft(a.x, a.y, b.x, b.y, point.x, point.y) > 0)
        wn++;
    } else if (
      b.y <= point.y &&
      isLeft(a.x, a.y, b.x, b.y, point.x, point.y) < 0
    )
      wn--;
  }
  return wn;
}

/** Rightward-ray crossings; odd total ⇒ inside for evenodd. */
function rayCrossings(poly: Point[], point: Point): number {
  let cn = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n]; // wrap closes the subpath
    if (
      (a.y <= point.y && b.y > point.y) ||
      (a.y > point.y && b.y <= point.y)
    ) {
      const t = (point.y - a.y) / (b.y - a.y);
      if (point.x < a.x + t * (b.x - a.x)) cn++;
    }
  }
  return cn;
}
