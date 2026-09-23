import { clamp01 } from "../scene/matrix.js";
import { outlineLength } from "../scene/path-parser.js";
import type { PaintOrder, SceneNode } from "../scene/types.js";
import type { TrimDescriptor } from "./types.js";

// Dash for a stroke: authored dash composes inside the trim window; `stroke: false` = nothing visible.
export interface StrokeDashDecision {
  stroke: boolean;
  dashArray: number[];
  dashOffset: number;
}

export function resolveStrokeDash(
  trim: TrimDescriptor | null,
  dashArray: number[],
  dashOffset: number,
): StrokeDashDecision {
  if (trim && !trim.visible)
    return { stroke: false, dashArray: [], dashOffset: 0 };
  if (trim && trim.dashArray.length > 0) {
    // Dash-of-a-dash: realize the authored dash inside the trim window (one dash slot).
    if (dashArray.length > 0)
      return composeDashInTrim(trim, dashArray, dashOffset);
    return {
      stroke: true,
      dashArray: trim.dashArray,
      dashOffset: trim.dashOffset,
    };
  }
  if (!trim && dashArray.length > 0)
    return { stroke: true, dashArray, dashOffset };
  return { stroke: true, dashArray: [], dashOffset: 0 };
}

const EPS = 1e-6;
// NOTE: caps a tiny dash period over a huge outline; past it, falls back to the plain trim.
const MAX_TRIM_DASH_SEGMENTS = 10000;

// An arc-length interval [start, end] of visible stroke on the outline.
type Segment = { start: number; end: number };

// Intersect the authored dash's ON runs with the trim window (reversed from computeTrim) into one dash + offset.
function composeDashInTrim(
  trim: TrimDescriptor,
  dashArray: number[],
  dashOffset: number,
): StrokeDashDecision {
  // computeTrim emits [visible, total] offset 0 (anchored) or [visible, total - visible] offset -start (marching).
  if (trim.dashArray.length < 2)
    return {
      stroke: true,
      dashArray: trim.dashArray,
      dashOffset: trim.dashOffset,
    };
  const visibleLen = trim.dashArray[0];
  const anchored = trim.dashOffset === 0;
  const total = anchored
    ? trim.dashArray[1]
    : trim.dashArray[0] + trim.dashArray[1];
  const windowStart = anchored ? 0 : -trim.dashOffset;
  if (!(total > 0) || !(visibleLen > 0))
    return { stroke: false, dashArray: [], dashOffset: 0 };

  // Canvas duplicates an odd-length dash array to make the period even.
  const pattern =
    dashArray.length % 2 === 1 ? dashArray.concat(dashArray) : dashArray;
  const period = pattern.reduce((a, b) => a + b, 0);
  if (!(period > 0))
    return {
      stroke: true,
      dashArray: trim.dashArray,
      dashOffset: trim.dashOffset,
    };

  // Trim window as up to two intervals within [0, total) (it may wrap the seam).
  const windows = arcWindows(windowStart, visibleLen, total);

  // ON runs within one period; arc = patternPos - dashOffset, repeating every `period`.
  const onSub: Segment[] = [];
  let cum = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (i % 2 === 0 && pattern[i] > 0)
      onSub.push({ start: cum, end: cum + pattern[i] });
    cum += pattern[i];
  }

  const segments: Segment[] = [];
  outer: for (const w of windows) {
    for (const sub of onSub) {
      // Repeat this ON run across arc range spanning the window.
      const base = sub.start - dashOffset;
      const nMin = Math.floor((w.start - (sub.end - dashOffset)) / period);
      const nMax = Math.ceil((w.end - base) / period);
      for (let n = nMin; n <= nMax; n++) {
        const s = Math.max(w.start, base + n * period);
        const e = Math.min(w.end, sub.end - dashOffset + n * period);
        if (e - s > EPS) {
          segments.push({ start: s, end: e });
          if (segments.length > MAX_TRIM_DASH_SEGMENTS) break outer;
        }
      }
    }
  }

  if (segments.length === 0)
    return { stroke: false, dashArray: [], dashOffset: 0 };
  if (segments.length > MAX_TRIM_DASH_SEGMENTS)
    return {
      stroke: true,
      dashArray: trim.dashArray,
      dashOffset: trim.dashOffset,
    };

  segments.sort((a, b) => a.start - b.start);
  return segmentsToDash(segments, total);
}

// Trim window as 1–2 non-wrapping intervals within [0, total).
function arcWindows(start: number, len: number, total: number): Segment[] {
  if (len >= total - EPS) return [{ start: 0, end: total }];
  let s = start % total;
  if (s < 0) s += total;
  const e = s + len;
  if (e <= total + EPS) return [{ start: s, end: Math.min(e, total) }];
  return [
    { start: s, end: total },
    { start: 0, end: e - total },
  ];
}

// Sorted segments -> dash array starting ON (offset -firstStart); always even-length (Skia MakeDash).
function segmentsToDash(
  segments: Segment[],
  total: number,
): StrokeDashDecision {
  const shift = segments[0].start;
  const arr: number[] = [];
  let prevEnd = 0;
  for (const seg of segments) {
    const uStart = seg.start - shift;
    const uLen = seg.end - seg.start;
    if (arr.length === 0) {
      arr.push(uLen);
    } else {
      arr.push(uStart - prevEnd); // gap
      arr.push(uLen); // on
    }
    prevEnd = uStart + uLen;
  }
  arr.push(Math.max(0, total - prevEnd)); // trailing gap closes the period
  return { stroke: true, dashArray: arr, dashOffset: -shift };
}

// paint-order: stroke draws stroke first so fill sits on top.
export function paintOrderSequence(
  order: PaintOrder,
): readonly ("fill" | "stroke")[] {
  return order === "stroke" ? ["stroke", "fill"] : ["fill", "stroke"];
}

/** trim-* → dash descriptor; null when untrimmed. Negative dashOffset handles seam wrap on closed shapes. */
export function computeTrim(node: SceneNode): TrimDescriptor | null {
  const start = clamp01(node.trimStart);
  const end = clamp01(node.trimEnd);
  const offset = clamp01(node.trimOffset);

  if (start <= 0 && end >= 1 && offset === 0) return null;

  const total = outlineLength(node);
  if (total <= 0) return null;

  if (end <= start) return { visible: false, dashArray: [], dashOffset: 0 };

  if (start <= 0 && end >= 1)
    return { visible: true, dashArray: [], dashOffset: 0 };

  const visible = (end - start) * total;
  const startPos = start + offset;

  // Non-wrapping window: 2x gap, since an exact period leaves a round-cap dot at either end.
  if (end + offset <= 1) {
    return {
      visible: true,
      dashArray: [visible, 2 * total],
      dashOffset: -startPos * total,
    };
  }

  return {
    visible: true,
    dashArray: [visible, total - visible],
    dashOffset: -startPos * total,
  };
}
