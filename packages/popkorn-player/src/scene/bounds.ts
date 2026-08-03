import type { Matrix3x3 } from "./matrix.js";
import { multiplyMatrices, transformPoint } from "./matrix.js";
import { computePathBounds } from "./path-parser.js";
import {
  computeLocalMatrix,
  getShapeBounds,
  matrixScale,
} from "./transform.js";
import type {
  FilterOp,
  ImageData,
  PathData,
  SceneNode,
  TextData,
} from "./types.js";

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
 * Carried through the walk so a node whose painted size can't be known yet (an
 * undecoded image with no explicit size and no crop) widens the region to the
 * whole buffer instead of being culled. Clipping is the failure we can't detect
 * later; a too-large region only costs speed.
 */
interface WalkState {
  unbounded: boolean;
}

/**
 * Local-space box a node paints on its own. Groups paint nothing, and paths have
 * no intrinsic box in `getShapeBounds`, so they resolve through the command
 * extents instead (conservative: control points are included).
 */
function localPaintBox(node: SceneNode, state: WalkState): Box | null {
  let b: { x: number; y: number; width: number; height: number };
  if (node.shapeData.type === "path") {
    const commands = (node.shapeData as PathData).commands;
    if (!commands || commands.length === 0) return null;
    b = computePathBounds(commands);
  } else if (node.shapeData.type === "group") {
    return null;
  } else if (node.shapeData.type === "image") {
    const im = node.shapeData as ImageData;
    // A 0 dest size means "use the crop's pixel size", or the bitmap's natural
    // size when there's no crop (mirrors the draw in runtime/loop). Natural size
    // isn't known until the decode lands, so that case is unbounded rather than
    // empty — culling it would drop the image instead of merely widening it.
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
  // Cull only what genuinely paints nothing. A zero-area box can still paint:
  // a zero-length subpath with a round/square cap draws a full dot, which is a
  // routine dotted-line idiom in converted Lottie. Pad first, cull after.
  if (b.width === 0 && b.height === 0 && pad === 0) return null;

  return {
    minX: b.x - pad,
    minY: b.y - pad,
    maxX: b.x + b.width + pad,
    maxY: b.y + b.height + pad,
  };
}

/**
 * How far a stroke reaches outside the path, in local units.
 *
 * A stroke straddles the path, so half the width each side — except at a miter
 * join, where the spike runs to `miterLimit × width / 2` before the renderer
 * bevels it (loop.ts hands the limit to the backend). At the default limit of 4
 * that is 2× the width, so the old flat `strokeWidth` pad clipped ordinary
 * sharp corners.
 */
function strokePad(node: SceneNode): number {
  if (!node.stroke && !node.strokeGradient) return 0;
  const half = node.strokeWidth / 2;
  return node.strokeLineJoin === "miter"
    ? Math.max(half, (node.strokeMiterLimit || 0) * half)
    : half * 2; // round/bevel stay inside a full-width pad
}

/** Extra local-unit slop for text ink; 0 for every other shape. */
function textPad(node: SceneNode): number {
  return node.shapeData.type === "text"
    ? (node.shapeData as TextData).fontSize * TEXT_INK_SLOP
    : 0;
}

/**
 * Per-side reach, in the filtered node's own units, of a filter list.
 *
 * A CSS filter list is a PIPELINE: each function takes the previous one's
 * output, so their reaches ACCUMULATE — `blur(10px) drop-shadow(60px 0 0)`
 * displaces an already-blurred image, reaching 3σ + 60 to the right. Taking the
 * per-side max instead would truncate the chain, which is invisible on a
 * top-level blit (nothing clips it) but cuts a hard edge as soon as the node
 * sits inside another composite's region clip.
 */
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
      // The result is the source PLUS a displaced, blurred copy, so each side
      // grows only where the shadow overhangs the source — never negative.
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
