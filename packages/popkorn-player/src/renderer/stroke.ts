import type { PaintOrder } from "../scene/types";
import type { TrimDescriptor } from "./types";

// Which dash pattern applies to a stroke, given the sticky trim descriptor and
// the authored stroke-dasharray. When both are set they compose: the authored
// dash is realized inside the trim window (both share the single dash slot).
// `stroke: false` means nothing is visible — stroke nothing.
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
    // Both a trim window and an authored dash are present. Compose them:
    // realize the authored dash *inside* the trim window (dash-of-a-dash),
    // since they'd otherwise fight over the single dash slot. Falls back to
    // the plain trim pattern when there's no authored dash to intersect.
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
// NOTE: ceiling — a scene with a tiny dash period tiled across a huge outline
// could generate unbounded segments; cap the intersection and fall back to the
// plain trim window past this. Real scenes stay far under it.
const MAX_TRIM_DASH_SEGMENTS = 10000;

// An arc-length interval [start, end] of visible stroke on the outline.
type Segment = { start: number; end: number };

// Compose an authored dash pattern within a trim window, both expressed against
// the outline arc-length. The trim descriptor is already a single-period dash
// ([visible, hidden] + offset) produced by `computeTrim`, so we reverse it back
// into the window's arc interval, intersect that with the authored dash's ON
// intervals, and re-emit the result as one finite dash array + offset that
// realizes BOTH — a single dash slot every backend can consume unchanged.
export function composeDashInTrim(
  trim: TrimDescriptor,
  dashArray: number[],
  dashOffset: number,
): StrokeDashDecision {
  // Reconstruct the trim window in outline arc-length coordinates. `computeTrim`
  // emits either [visible, total] with offset 0 (window anchored at the seam) or
  // [visible, total - visible] with offset -windowStart (marching window).
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

  // Authored ON sub-intervals within one pattern period. `arc = patternPos -
  // dashOffset`, so an ON run [a, b] in pattern space lands at arc [a, b] shifted
  // by -dashOffset and repeated every `period`.
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

// The trim window [start, start+len] on a circle of circumference `total`,
// normalized into 1–2 non-wrapping intervals within [0, total).
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

// Emit sorted visible segments as a finite dash array + offset over an outline
// of length `total`. We rotate coordinates so the first segment starts at 0
// (dashOffset = -firstStart), letting the array begin on an ON dash, then walk
// on/gap/on/gap… and close with the trailing gap back to `total`. The result is
// always even-length (Skia's MakeDash requirement).
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

// Fill/stroke paint order for one shape. paint-order: stroke draws the stroke
// first so the fill sits on top of it (only the stroke's outer edge shows);
// otherwise fill then stroke.
export function paintOrderSequence(
  order: PaintOrder,
): readonly ("fill" | "stroke")[] {
  return order === "stroke" ? ["stroke", "fill"] : ["fill", "stroke"];
}
