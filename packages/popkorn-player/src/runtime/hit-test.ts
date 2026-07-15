/**
 * Hit-testing for scene graph nodes
 * Determines which nodes the mouse pointer is over.
 *
 * Screen points are mapped into each node's local space via the inverse of the
 * world matrix from scene/transform.ts — the same matrix used for rendering — so
 * hover/active regions match what is painted exactly, including transform-origin.
 */

import type { Matrix3x3, PathCommand, ResolvedClip } from "../renderer/types";
import {
  IDENTITY_MATRIX,
  invertMatrix,
  transformPoint,
} from "../renderer/types";
import { resolveClip } from "../scene/clip";
import { flattenToSubpaths } from "../scene/path-parser";
import { polystarCommands } from "../scene/polystar";
import { computeWorldMatrix, getShapeBounds } from "../scene/transform";
import type {
  CircleData,
  EllipseData,
  FillRule,
  PathData,
  RectData,
  SceneNode,
} from "../scene/types";
import { childrenInPaintOrder } from "../scene/types";

export interface Point {
  x: number;
  y: number;
}

export interface HitTestResult {
  node: SceneNode;
  depth: number;
}

/**
 * Perform hit-testing on the scene graph.
 * Returns the topmost interactive node at the given point.
 *
 * Hit-testing bubbles like the DOM: any shape whose geometry contains the point
 * credits its NEAREST INTERACTIVE ANCESTOR-OR-SELF (see hitTestNode), so an
 * interactive group is hit when any descendant shape is, and an interactive
 * shape's hover region grows to include descendant geometry that pokes outside
 * its own outline. A directly-interactive child still wins over an interactive
 * ancestor inside the child's geometry (nearest wins).
 */
export function hitTest(root: SceneNode, point: Point): SceneNode | null {
  // Best (highest) paint depth credited to each interactive node. A node's hit
  // priority is the topmost-painted shape that contains the point and bubbles to
  // it, so keeping the max depth (not each contribution) is enough to pick the
  // topmost node and avoids duplicate entries for the same credited node.
  const hits = new Map<SceneNode, number>();
  hitTestNode(root, point, IDENTITY_MATRIX, { value: 0 }, null, hits);

  let best: SceneNode | null = null;
  let bestDepth = -Infinity;
  for (const [node, depth] of hits) {
    // Higher depth = painted later = on top.
    if (depth > bestDepth) {
      bestDepth = depth;
      best = node;
    }
  }
  return best;
}

/**
 * Recursively test nodes for hit, in paint order (parent before children).
 * `nearestInteractive` is the closest interactive ancestor of `node` (null if
 * none); a shape that contains the point credits it (or `node` itself when
 * `node` is interactive) at the shape's own paint depth.
 */
function hitTestNode(
  node: SceneNode,
  point: Point,
  parentWorld: Matrix3x3,
  order: { value: number },
  nearestInteractive: SceneNode | null,
  hits: Map<SceneNode, number>,
): void {
  // A node hidden by its visibility window paints nothing, so it (and its
  // subtree) can't be hit either. `hidden` is set by the per-frame resolve walk.
  if (node.hidden) return;

  // Mask sources are never painted on their own, so they can't be hit; skip
  // the whole subtree. (Maskd content is hit-tested normally on its shape.)
  if (node.isMaskSource) return;

  // pointer-events: none removes this node AND its subtree from hit-testing —
  // its geometry neither hits it nor bubbles to an ancestor, and (we don't
  // support re-enabling) no descendant can opt back in.
  if (node.pointerEvents === "none") return;

  const world = computeWorldMatrix(node, parentWorld);
  const depth = order.value++;
  const local = transformPoint(invertMatrix(world), point.x, point.y);

  // A point outside this node's clip region can hit neither the node nor any of
  // its descendants — the clip is applied in this node's local space, matching
  // the renderer.
  const clip = resolveClip(node);
  if (clip && !isPointInClip(clip, local, node.fillRule)) return;

  // Nearest interactive ancestor-or-self for this node and its subtree.
  const credited = node.interactive ? node : nearestInteractive;

  // Any shape containing the point credits `credited` at this shape's paint
  // depth (bubbling). Groups have no geometry of their own (isPointInShape
  // returns false), so they only ever get credited via a descendant shape.
  if (credited && isPointInShape(node, local)) {
    const prev = hits.get(credited);
    if (prev === undefined || depth > prev) hits.set(credited, depth);
  }

  // Same paint order as the render walk, so hit depth (= paint order) and
  // stacking agree: later-painted siblings get higher depth (topmost).
  for (const child of childrenInPaintOrder(node)) {
    hitTestNode(child, point, world, order, credited, hits);
  }
}

/**
 * A resolved click target: the credited node plus its ancestor id path (root →
 * node, inclusive) for delegation-style matching.
 */
export interface ClickHit {
  node: SceneNode;
  path: string[];
}

/**
 * Full-tree hit-test for click resolution. Unlike {@link hitTest} (which only
 * credits interactive nodes), this resolves the TOPMOST shape whose geometry
 * contains the point regardless of `interactive`, then credits the nearest
 * interactive ancestor-or-self of that shape when one exists (so `cursor:
 * pointer` on a group makes a click report the group id, not the leaf). Returns
 * null when nothing is hit. Callers run this only on press/release edges — it
 * walks the whole tree, so it must not be used per-frame.
 */
export function hitTestClick(root: SceneNode, point: Point): ClickHit | null {
  // Topmost (highest paint depth) shape containing the point, and its nearest
  // interactive ancestor-or-self.
  const found: {
    depth: number;
    node: SceneNode | null;
    credited: SceneNode | null;
  } = { depth: -Infinity, node: null, credited: null };
  clickTestNode(root, point, IDENTITY_MATRIX, { value: 0 }, null, found);
  if (!found.node) return null;
  const target = found.credited ?? found.node;
  return { node: target, path: ancestorPath(target) };
}

/** Ancestor ids from the root down to `node` (inclusive). */
function ancestorPath(node: SceneNode): string[] {
  const ids: string[] = [];
  for (let n: SceneNode | null = node; n; n = n.parent) ids.push(n.id);
  return ids.reverse();
}

/**
 * Full-tree variant of {@link hitTestNode}: records the topmost shape (any
 * geometry, `interactive` or not) plus the nearest interactive ancestor-or-self
 * to credit. Skips the same non-hittable subtrees (hidden / mask source /
 * pointer-events:none / outside clip) so it agrees with what is painted.
 */
function clickTestNode(
  node: SceneNode,
  point: Point,
  parentWorld: Matrix3x3,
  order: { value: number },
  nearestInteractive: SceneNode | null,
  found: { depth: number; node: SceneNode | null; credited: SceneNode | null },
): void {
  if (node.hidden) return;
  if (node.isMaskSource) return;
  if (node.pointerEvents === "none") return;

  const world = computeWorldMatrix(node, parentWorld);
  const depth = order.value++;
  const local = transformPoint(invertMatrix(world), point.x, point.y);

  const clip = resolveClip(node);
  if (clip && !isPointInClip(clip, local, node.fillRule)) return;

  const credited = node.interactive ? node : nearestInteractive;

  // Any shape (not just interactive ones) containing the point competes to be
  // the topmost hit; groups have no geometry (isPointInShape returns false).
  if (isPointInShape(node, local) && depth > found.depth) {
    found.depth = depth;
    found.node = node;
    found.credited = credited;
  }

  for (const child of childrenInPaintOrder(node)) {
    clickTestNode(child, point, world, order, credited, found);
  }
}

/**
 * Test whether a local-space point lies inside a resolved clip region.
 * All three cases are pure math (no DOM/Path2D), so clipping works headless and
 * on React Native exactly as it does in the browser.
 */
function isPointInClip(
  clip: ResolvedClip,
  point: Point,
  fillRule: FillRule = "nonzero",
): boolean {
  switch (clip.type) {
    case "rect":
      return (
        point.x >= clip.x &&
        point.x <= clip.x + clip.width &&
        point.y >= clip.y &&
        point.y <= clip.y + clip.height
      );
    case "circle": {
      const dx = point.x - clip.cx;
      const dy = point.y - clip.cy;
      return dx * dx + dy * dy <= clip.r * clip.r;
    }
    case "path":
      return isPointInCommands(clip.commands, point, fillRule);
  }
}

/**
 * Test if a point (in local coordinates) is inside a shape
 */
function isPointInShape(node: SceneNode, point: Point): boolean {
  switch (node.shapeData.type) {
    case "rect":
      return isPointInRect(node.shapeData as RectData, point);
    case "circle":
      return isPointInCircle(node.shapeData as CircleData, point);
    case "ellipse":
      return isPointInEllipse(node.shapeData as EllipseData, point);
    case "path":
      return isPointInCommands(
        (node.shapeData as PathData).commands,
        point,
        node.fillRule,
      );
    case "star":
    case "polygon":
      return isPointInCommands(polystarCommands(node), point, node.fillRule);
    case "text":
    case "image": {
      // Rect test against the node's bounding box.
      const b = getShapeBounds(node);
      return (
        point.x >= b.x &&
        point.x <= b.x + b.width &&
        point.y >= b.y &&
        point.y <= b.y + b.height
      );
    }
    case "group":
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
 * Path (and star/polygon) hit-testing by pure math: flatten the commands to
 * polyline subpaths via the shared flattener, then run a point-in-polygon test.
 * No Path2D, no canvas — so this works identically headless and on React Native
 * (where the old Path2D scratch-context path silently missed every path shape).
 * Each subpath is implicitly closed, matching canvas fill semantics.
 */
function isPointInCommands(
  commands: PathCommand[],
  point: Point,
  fillRule: FillRule,
): boolean {
  const subpaths = flattenToSubpaths(commands);
  if (fillRule === "evenodd") {
    // Even-odd: total ray-crossings parity across every subpath.
    let crossings = 0;
    for (const poly of subpaths) crossings += rayCrossings(poly, point);
    return (crossings & 1) === 1;
  }
  // Nonzero: signed winding number summed across every subpath.
  let winding = 0;
  for (const poly of subpaths) winding += windingNumber(poly, point);
  return winding !== 0;
}

/**
 * `> 0` if `point` is left of the directed edge a→b, `< 0` if right, `0` if
 * collinear (the sign of the edge's 2D cross product with the point).
 */
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

/**
 * Winding number of an implicitly-closed polyline around `point` (Sunday's
 * algorithm). Nonzero ⇒ inside for fillRule: "nonzero".
 */
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

/**
 * Number of times a rightward ray from `point` crosses an implicitly-closed
 * polyline. Odd total across subpaths ⇒ inside for fillRule: "evenodd".
 */
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
