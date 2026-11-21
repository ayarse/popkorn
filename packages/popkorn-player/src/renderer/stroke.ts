import { clamp01 } from "../scene/matrix.js";
import { outlineContours, outlineLength } from "../scene/path-parser.js";
import type { PaintOrder, SceneNode } from "../scene/types.js";
import type { Renderer } from "./interface.js";
import type { TrimDescriptor } from "./types.js";

// Dash for a stroke: authored dash composes inside the trim window; `stroke: false` = nothing visible.
export interface StrokeDashDecision {
  stroke: boolean;
  dashArray: number[];
  dashOffset: number;
}

const EPS = 1e-6;
// NOTE: caps a tiny dash period over a huge outline; past it, falls back to the plain trim.
const MAX_TRIM_DASH_SEGMENTS = 10000;

// An arc-length interval [start, end] of visible stroke on the outline.
type Segment = { start: number; end: number };

// The trim window as the trimmed path Lottie dashes: the authored dash starts at the window start.
export function resolveStrokeDash(
  trim: TrimDescriptor | null,
  dashArray: number[],
  dashOffset: number,
): StrokeDashDecision {
  if (!trim)
    return dashArray.length > 0
      ? { stroke: true, dashArray: evenDash(dashArray), dashOffset }
      : { stroke: true, dashArray: [], dashOffset: 0 };
  const { start, length, total } = trim;
  if (!trim.visible || !(length > EPS) || !(total > 0))
    return { stroke: false, dashArray: [], dashOffset: 0 };
  if (length >= total - EPS && dashArray.length === 0)
    return { stroke: true, dashArray: [], dashOffset: 0 };

  const pattern = dashArray.length > 0 ? evenDash(dashArray) : null;
  const segments: Segment[] = [];
  const end = start + Math.min(length, total);
  let ok = addPiece(
    segments,
    start,
    Math.min(end, total),
    0,
    pattern,
    dashOffset,
  );
  // Past the seam: a continuous window keeps its dash phase, a separate piece restarts it.
  // NOTE: the two runs meet with caps at the start point, not a join; joining needs trimmed geometry.
  if (ok && end > total + EPS) {
    const u0 = trim.continuous ? total - start : 0;
    ok = addPiece(segments, 0, end - total, u0, pattern, dashOffset);
  }
  if (!ok) {
    segments.length = 0;
    addPiece(segments, start, Math.min(end, total), 0, null, 0);
    if (end > total + EPS) addPiece(segments, 0, end - total, 0, null, 0);
  }
  if (segments.length === 0)
    return { stroke: false, dashArray: [], dashOffset: 0 };
  segments.sort((a, b) => a.start - b.start);
  return segmentsToDash(segments, total);
}

// An odd-length dash repeats once to an even period, as SVG/Canvas specify (Skia MakeDash needs it explicit).
function evenDash(dashArray: number[]): number[] {
  return dashArray.length % 2 === 1 ? dashArray.concat(dashArray) : dashArray;
}

// Visible runs of arc [from, to], whose dash position is u0 + (x - from) + dashOffset; false past the cap.
function addPiece(
  out: Segment[],
  from: number,
  to: number,
  u0: number,
  pattern: number[] | null,
  dashOffset: number,
): boolean {
  if (!(to - from > EPS)) return true;
  if (!pattern) {
    out.push({ start: from, end: to });
    return true;
  }
  const period = pattern.reduce((a, b) => a + b, 0);
  if (!(period > 0)) {
    out.push({ start: from, end: to });
    return true;
  }
  const shift = from - u0 - dashOffset;
  let cum = 0;
  for (let i = 0; i < pattern.length; i++) {
    const on = pattern[i];
    if (i % 2 === 0 && on > 0) {
      const s0 = cum + shift;
      const nMin = Math.floor((from - (s0 + on)) / period);
      const nMax = Math.ceil((to - s0) / period);
      for (let n = nMin; n <= nMax; n++) {
        const s = Math.max(from, s0 + n * period);
        const e = Math.min(to, s0 + on + n * period);
        if (e - s > EPS) {
          out.push({ start: s, end: e });
          if (out.length > MAX_TRIM_DASH_SEGMENTS) return false;
        }
      }
    }
    cum += pattern[i];
  }
  return true;
}

// Sorted segments -> even-length dash starting ON; the 2x-total period can't wrap a round-cap dot onto either end.
function segmentsToDash(
  segments: Segment[],
  total: number,
): StrokeDashDecision {
  const shift = segments[0].start;
  const arr: number[] = [];
  let prevEnd = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const uStart = seg.start - shift;
    // A run reaching the end overshoots it, so an under-measured curve still strokes to its last point.
    const end = seg.end >= total - EPS ? total * 1.5 : seg.end;
    const uLen = end - seg.start;
    if (i > 0) arr.push(uStart - prevEnd);
    arr.push(uLen);
    prevEnd = uStart + uLen;
  }
  arr.push(Math.max(0, 2 * total - prevEnd));
  return { stroke: true, dashArray: arr, dashOffset: 0 - shift };
}

// paint-order: stroke draws stroke first so fill sits on top.
export function paintOrderSequence(
  order: PaintOrder,
): readonly ("fill" | "stroke")[] {
  return order === "stroke" ? ["stroke", "fill"] : ["fill", "stroke"];
}

const HIDDEN_TRIM: TrimDescriptor = Object.freeze({
  visible: false,
  start: 0,
  length: 0,
  total: 0,
  continuous: false,
});

// One contour's window from 0..1 fractions; offset rotates it around the outline.
function trimWindow(
  start: number,
  end: number,
  offset: number,
  total: number,
  closed: boolean,
): TrimDescriptor {
  if (end <= start) return HIDDEN_TRIM;
  return {
    visible: true,
    start: ((start + offset) % 1) * total,
    length: (end - start) * total,
    total,
    continuous: closed,
  };
}

// The share of a window [from, from + len) over the concatenated outline that lands on one contour.
function sequentialWindow(
  from: number,
  len: number,
  total: number,
  c0: number,
  cLen: number,
): TrimDescriptor {
  const c1 = c0 + cLen;
  const a1 = Math.max(from, c0);
  const b1 = Math.min(from + len, c1);
  const a2 = Math.max(from - total, c0);
  const b2 = Math.min(from + len - total, c1);
  const hasA = b1 - a1 > EPS;
  const hasB = b2 - a2 > EPS;
  if (!hasA && !hasB) return HIDDEN_TRIM;
  // Both: the window's tail ends this contour and its wrapped head starts it, as separate pieces.
  const length = hasA && hasB ? c1 - a1 + (b2 - c0) : hasA ? b1 - a1 : b2 - a2;
  return {
    visible: true,
    start: (hasA ? a1 : a2) - c0,
    length,
    total: cLen,
    continuous: false,
  };
}

/** trim-* → the whole outline's window; null when untrimmed. */
export function computeTrim(node: SceneNode): TrimDescriptor | null {
  const start = clamp01(node.trimStart);
  const end = clamp01(node.trimEnd);
  const offset = clamp01(node.trimOffset);
  if (start <= 0 && end >= 1 && offset === 0) return null;

  const total = outlineLength(node);
  if (total <= 0) return null;
  const contours = outlineContours(node);
  const closed =
    node.shapeData.type !== "path" ||
    (contours.length === 1 && contours[0].closed);
  return trimWindow(start, end, offset, total, closed);
}

// Trimmed multi-contour path: one fill, then one stroke per contour window; false = not applicable.
// NOTE: per-contour strokes size box-relative stroke gradients to each contour and double translucent overlaps.
export function drawContourTrims(r: Renderer, node: SceneNode): boolean {
  if (node.shapeData.type !== "path") return false;
  const start = clamp01(node.trimStart);
  const end = clamp01(node.trimEnd);
  const offset = clamp01(node.trimOffset);
  if (start <= 0 && end >= 1 && offset === 0) return false;
  const total = outlineLength(node);
  const contours = outlineContours(node);
  if (contours.length < 2 || total <= 0) return false;

  const sequential = node.trimMode === "sequential";
  const from = ((start + offset) % 1) * total;
  const len = (end - start) * total;
  for (const which of paintOrderSequence(node.paintOrder)) {
    if (which === "fill") {
      if (!node.fill && !node.fillGradient) continue;
      r.setTrim(HIDDEN_TRIM);
      r.drawPath(node.shapeData.commands);
      continue;
    }
    if (!node.stroke && !node.strokeGradient) continue;
    r.setFill(null);
    r.setFillGradient(null);
    let c0 = 0;
    for (const c of contours) {
      if (!sequential)
        r.setTrim(trimWindow(start, end, offset, c.length, c.closed));
      else if (end > start)
        r.setTrim(sequentialWindow(from, len, total, c0, c.length));
      else r.setTrim(HIDDEN_TRIM);
      r.drawPath(c.commands);
      c0 += c.length;
    }
    r.setFill(node.fill);
    r.setFillGradient(node.fillGradient);
  }
  return true;
}
