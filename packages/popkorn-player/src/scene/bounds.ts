import type { Matrix3x3 } from "./matrix.js";
import { matrixScale, multiplyMatrices, transformPoint } from "./matrix.js";
import { computePathBounds } from "./path-parser.js";
import { getShapeBounds } from "./shape-bounds.js";
import { computeLocalMatrix } from "./transform.js";
import type { FilterOp, SceneNode } from "./types.js";

/** Device (backing-buffer) pixels. */
export interface DeviceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A blur's visible reach is ~3σ; past that the contribution is sub-1/255. */
const BLUR_REACH = 3;

// Device-px slack so antialiasing past exact geometry isn't clipped to a hard edge.
const ANTIALIAS_SLOP = 2;

// Glyph ink (descenders, overshoot, bearings) exceeds the advance/em box; pad by a fraction of font size.
const TEXT_INK_SLOP = 0.25;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Unknown painted size (undecoded image) widens to the whole buffer: over-reporting only costs speed.
interface WalkState {
  unbounded: boolean;
}

// Own paint box; paths use command extents (conservative, includes control points).
function localPaintBox(node: SceneNode, state: WalkState): Box | null {
  let b: { x: number; y: number; width: number; height: number };
  if (node.shapeData.type === "path") {
    const commands = node.shapeData.commands;
    if (!commands || commands.length === 0) return null;
    b = computePathBounds(commands);
  } else if (node.shapeData.type === "group") {
    return null;
  } else if (node.shapeData.type === "image") {
    const im = node.shapeData;
    // 0 dest size = crop or natural size; natural is unknown before decode, so unbounded, not culled.
    const w = im.width > 0 ? im.width : (im.viewBox?.width ?? 0);
    const h = im.height > 0 ? im.height : (im.viewBox?.height ?? 0);
    if (w <= 0 || h <= 0) {
      state.unbounded = true;
      return null;
    }
    b = { x: im.x, y: im.y, width: w, height: h };
  } else {
    b = getShapeBounds(node);
  }

  const pad = strokePad(node) + textPad(node);
  // Pad before culling: a zero-length subpath with a round/square cap still paints a dot.
  if (b.width === 0 && b.height === 0 && pad === 0) return null;

  return {
    minX: b.x - pad,
    minY: b.y - pad,
    maxX: b.x + b.width + pad,
    maxY: b.y + b.height + pad,
  };
}

// Half the width each side, or `miterLimit × width / 2` at a miter join.
function strokePad(node: SceneNode): number {
  if (!node.stroke && !node.strokeGradient) return 0;
  const half = node.strokeWidth / 2;
  return node.strokeLineJoin === "miter"
    ? Math.max(half, (node.strokeMiterLimit || 0) * half)
    : half * 2; // round/bevel stay inside a full-width pad
}

function textPad(node: SceneNode): number {
  return node.shapeData.type === "text"
    ? node.shapeData.fontSize * TEXT_INK_SLOP
    : 0;
}

// Per-side filter reach; a filter list is a pipeline, so reaches ACCUMULATE rather than max.
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
      l += reach;
      t += reach;
      r += reach;
      b += reach;
    } else if (op.type === "drop-shadow") {
      // Source plus displaced copy: grows only where the shadow overhangs.
      const reach = op.blur * BLUR_REACH + (op.spread ?? 0);
      l += Math.max(0, reach - op.dx);
      r += Math.max(0, reach + op.dx);
      t += Math.max(0, reach - op.dy);
      b += Math.max(0, reach + op.dy);
    }
  }
  return { l, t, r, b };
}

function transformBox(box: Box, m: Matrix3x3): Box {
  // Refit an AABB around all four corners (rotation/skew).
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

// Superset of what the walk paints; filter bleed aggregates on the way OUT so descendants widen ancestors.
function subtreeBox(
  node: SceneNode,
  parentWorld: Matrix3x3,
  paintSource: boolean,
  state: WalkState,
): Box | null {
  if (node.hidden || node.displayNone) return null;
  if (!paintSource && node.isMaskSource) return null;

  const world = multiplyMatrices(parentWorld, computeLocalMatrix(node));

  let box = localPaintBox(node, state);
  if (box) box = transformBox(box, world);

  for (const child of node.children) {
    box = union(box, subtreeBox(child, world, false, state));
  }

  // Masked content box already bounds it (see maskDeviceBounds).

  if (box) {
    // Outer box-shadows inflate the box; inset ones stay inside the shape.
    const ops: FilterOp[] = [
      ...(node.filter ?? []),
      ...(node.boxShadow ?? []).filter(
        (s) => s.type !== "drop-shadow" || !s.inset,
      ),
    ];
    if (ops.length > 0) {
      // Filter lengths are in node units; scale to device px like `filterToCSS`.
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

// Snapped, buffer-clamped device region, or null to skip the composite; `parentWorld` includes the viewport.
export function subtreeDeviceBounds(
  node: SceneNode,
  parentWorld: Matrix3x3,
  bufferWidth: number,
  bufferHeight: number,
  paintSource: boolean = false,
): DeviceRect | null {
  const state: WalkState = { unbounded: false };
  const box = subtreeBox(node, parentWorld, paintSource, state);
  if (state.unbounded)
    return { x: 0, y: 0, width: bufferWidth, height: bufferHeight };
  if (!box) return null;
  const minX = Math.max(0, Math.floor(box.minX - ANTIALIAS_SLOP));
  const minY = Math.max(0, Math.floor(box.minY - ANTIALIAS_SLOP));
  const maxX = Math.min(bufferWidth, Math.ceil(box.maxX + ANTIALIAS_SLOP));
  const maxY = Math.min(bufferHeight, Math.ceil(box.maxY + ANTIALIAS_SLOP));
  if (maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// The CONTENT's box, intersected with the mask only when not inverted (inversion keeps outside content).
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
