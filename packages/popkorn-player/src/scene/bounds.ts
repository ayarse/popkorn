import type { Matrix3x3 } from "./matrix";
import { multiplyMatrices, transformPoint } from "./matrix";
import { computePathBounds } from "./path-parser";
import { computeLocalMatrix, getShapeBounds, matrixScale } from "./transform";
import type { FilterOp, PathData, SceneNode, TextData } from "./types";

/** An axis-aligned rect in device (backing-buffer) pixels. */
export interface DeviceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A blur's visible reach is ~3σ; past that the contribution is sub-1/255. */
const BLUR_REACH = 3;

/**
 * Device-px slack on the final region. Rasterization antialiases a fraction of a
 * pixel past exact geometry, and clipping that sliver away is visible as a hard
 * edge on an otherwise soft shape.
 */
const ANTIALIAS_SLOP = 2;

/**
 * Text boxes come from the advance width and the em square (see
 * getShapeBounds), but glyphs ink outside both — descenders drop below the
 * baseline, round caps overshoot, and bold side bearings run past the advance.
 * Pad by a fraction of the font size rather than pretending the box is tight.
 */
const TEXT_INK_SLOP = 0.25;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Local-space box a node paints on its own. Groups paint nothing, and paths have
 * no intrinsic box in `getShapeBounds`, so they resolve through the command
 * extents instead (conservative: control points are included).
 */
function localPaintBox(node: SceneNode): Box | null {
  let b: { x: number; y: number; width: number; height: number };
  if (node.shapeData.type === "path") {
    const commands = (node.shapeData as PathData).commands;
    if (!commands || commands.length === 0) return null;
    b = computePathBounds(commands);
  } else if (node.shapeData.type === "group") {
    return null;
  } else {
    b = getShapeBounds(node);
  }
  if (b.width === 0 && b.height === 0) return null;

  // A stroke straddles the path; a miter join can reach further than half the
  // width, so inflate by the full width rather than solving per-join geometry.
  let pad = node.stroke || node.strokeGradient ? node.strokeWidth : 0;
  if (node.shapeData.type === "text")
    pad += (node.shapeData as TextData).fontSize * TEXT_INK_SLOP;
  return {
    minX: b.x - pad,
    minY: b.y - pad,
    maxX: b.x + b.width + pad,
    maxY: b.y + b.height + pad,
  };
}

/** Per-side reach, in the filtered node's own units, of a filter list. */
function filterBleed(ops: FilterOp[]): {
  l: number;
  t: number;
  r: number;
  b: number;
} {
  let l = 0,
    t = 0,
    r = 0,
    b = 0;
  for (const op of ops) {
    if (op.type === "blur") {
      const reach = op.radius * BLUR_REACH;
      l = Math.max(l, reach);
      t = Math.max(t, reach);
      r = Math.max(r, reach);
      b = Math.max(b, reach);
    } else if (op.type === "drop-shadow") {
      // The shadow is a displaced, blurred copy; it extends the box in the
      // offset's direction only, but the blur reaches both ways around it.
      const reach = op.blur * BLUR_REACH + (op.spread ?? 0);
      l = Math.max(l, reach - op.dx);
      r = Math.max(r, reach + op.dx);
      t = Math.max(t, reach - op.dy);
      b = Math.max(b, reach + op.dy);
    }
  }
  return { l, t, r, b };
}

function transformBox(box: Box, m: Matrix3x3): Box {
  // Rotation/skew mean the transformed corners are not axis-aligned, so re-fit
  // an AABB around all four rather than mapping two opposite corners.
  const xs = [box.minX, box.maxX, box.maxX, box.minX];
  const ys = [box.minY, box.minY, box.maxY, box.maxY];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < 4; i++) {
    const p = transformPoint(m, xs[i], ys[i]);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Device-space box a subtree can paint into, or null when it paints nothing.
 *
 * Mirrors the render walk's gating (`hidden`/`displayNone`, and mask sources
 * that only paint via their dependent) so the box can't exclude something the
 * walk would draw. Every node's own filter bleeds the box accumulated at its
 * level, so a blurred descendant widens the result — the reason this aggregates
 * on the way OUT of the recursion rather than the way in.
 */
function subtreeBox(
  node: SceneNode,
  parentWorld: Matrix3x3,
  paintSource: boolean,
): Box | null {
  if (node.hidden || node.displayNone) return null;
  if (!paintSource && node.isMaskSource) return null;

  const world = multiplyMatrices(parentWorld, computeLocalMatrix(node));

  let box = localPaintBox(node);
  if (box) box = transformBox(box, world);

  for (const child of node.children) {
    box = union(box, subtreeBox(child, world, false));
  }

  // A masked node paints at most where its content paints, so the content box
  // above already bounds it (see maskDeviceBounds for why intersecting with the
  // mask is only sound for non-inverted modes).

  if (box) {
    // Outer box-shadows inflate the box whether they ride the CSS-filter path or
    // draw geometrically; inset ones stay inside the shape and don't.
    const ops: FilterOp[] = [
      ...(node.filter ?? []),
      ...(node.boxShadow ?? []).filter(
        (s) => s.type !== "drop-shadow" || !s.inset,
      ),
    ];
    if (ops.length > 0) {
      // Filter lengths are authored in the node's own units; the same world
      // scale the loop feeds `filterToCSS` converts the reach to device px.
      const s = matrixScale(world);
      const { l, t, r, b } = filterBleed(ops);
      box = {
        minX: box.minX - l * s,
        minY: box.minY - t * s,
        maxX: box.maxX + r * s,
        maxY: box.maxY + b * s,
      };
    }
  }
  return box;
}

/**
 * Device-space region a subtree paints into, snapped out to whole pixels and
 * clamped to the buffer, or null when it paints nothing (caller skips the
 * composite entirely) — see `subtreeBox`.
 *
 * `parentWorld` must be the matrix the caller will hand the draw closure, with
 * the viewport already folded in, so the region lands in the same device space
 * as the pixels.
 */
export function subtreeDeviceBounds(
  node: SceneNode,
  parentWorld: Matrix3x3,
  bufferWidth: number,
  bufferHeight: number,
  paintSource: boolean = false,
): DeviceRect | null {
  const box = subtreeBox(node, parentWorld, paintSource);
  if (!box) return null;
  const minX = Math.max(0, Math.floor(box.minX - ANTIALIAS_SLOP));
  const minY = Math.max(0, Math.floor(box.minY - ANTIALIAS_SLOP));
  const maxX = Math.min(bufferWidth, Math.ceil(box.maxX + ANTIALIAS_SLOP));
  const maxY = Math.min(bufferHeight, Math.ceil(box.maxY + ANTIALIAS_SLOP));
  if (maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Device-space region a track-mask composite can affect.
 *
 * The output is always a subset of the CONTENT: `destination-in` keeps content
 * where the mask is opaque, `destination-out` where it is transparent — neither
 * creates pixels the content doesn't have. Intersecting with the mask is
 * therefore sound only for non-inverted modes; under an inverted mode the mask's
 * *transparency* is what preserves content, so content far outside the mask's
 * own box survives and the intersection would clip live pixels away.
 */
export function maskDeviceBounds(
  content: DeviceRect | null,
  mask: DeviceRect | null,
  inverted: boolean,
): DeviceRect | null {
  if (!content) return null;
  if (inverted || !mask) return content;
  const x = Math.max(content.x, mask.x);
  const y = Math.max(content.y, mask.y);
  const right = Math.min(content.x + content.width, mask.x + mask.width);
  const bottom = Math.min(content.y + content.height, mask.y + mask.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}
