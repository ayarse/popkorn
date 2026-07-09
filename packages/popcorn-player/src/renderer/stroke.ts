import type { PaintOrder } from "../scene/types";
import type { TrimDescriptor } from "./types";

// Which dash pattern applies to a stroke, given the sticky trim descriptor and
// the authored stroke-dasharray. Trim wins over an authored dash when both are
// set (both share the single dash slot), matching Lottie. `stroke: false` means
// the trim window is empty — stroke nothing.
export interface StrokeDashDecision {
  stroke: boolean;
  dashArray: number[];
  dashOffset: number;
}

// NOTE: composing an authored dash *within* a trim window (dash-of-a-dash)
// is the real upgrade path; for now trim simply overrides the authored dash.
export function resolveStrokeDash(
  trim: TrimDescriptor | null,
  dashArray: number[],
  dashOffset: number,
): StrokeDashDecision {
  if (trim && !trim.visible)
    return { stroke: false, dashArray: [], dashOffset: 0 };
  if (trim && trim.dashArray.length > 0)
    return {
      stroke: true,
      dashArray: trim.dashArray,
      dashOffset: trim.dashOffset,
    };
  if (!trim && dashArray.length > 0)
    return { stroke: true, dashArray, dashOffset };
  return { stroke: true, dashArray: [], dashOffset: 0 };
}

// Fill/stroke paint order for one shape. paint-order: stroke draws the stroke
// first so the fill sits on top of it (only the stroke's outer edge shows);
// otherwise fill then stroke.
export function paintOrderSequence(
  order: PaintOrder,
): readonly ("fill" | "stroke")[] {
  return order === "stroke" ? ["stroke", "fill"] : ["fill", "stroke"];
}
