// transform, individual transform, transform-origin and object-view-box values.

import type { Value } from "@popkorn/parser";
import {
  getNumericValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
} from "@popkorn/parser";
import { createDefaultTransformOrigin } from "./node.js";
import { hasVariableReference } from "./static-vars.js";
import type { ImageViewBox, Transform, TransformOriginValue } from "./types.js";
import { oneOf } from "./value-parsers.js";

type TransformKey =
  | "translateX"
  | "translateY"
  | "rotate"
  | "scaleX"
  | "scaleY"
  | "skewX"
  | "skewY";

/** CSS matrix(a, b, c, d) as the channels computeLocalMatrix composes: rotate · scale · skewX (degrees). */
export function decomposeMatrix(
  a: number,
  b: number,
  c: number,
  d: number,
): { rotate: number; scaleX: number; scaleY: number; skewX: number } {
  const sx = Math.hypot(a, b);
  // NOTE: a collapsed x axis keeps rotate = skew = 0 and drops c.
  if (sx < 1e-9) return { rotate: 0, scaleX: 0, scaleY: d, skewX: 0 };
  const cos = a / sx;
  const sin = b / sx;
  return {
    rotate: (Math.atan2(b, a) * 180) / Math.PI,
    scaleX: sx,
    scaleY: d * cos - c * sin,
    skewX: (Math.atan((c * cos + d * sin) / sx) * 180) / Math.PI,
  };
}

// Report each transform channel to `set`; bindings pass a live `resolve`.
export function extractTransform(
  value: Value,
  set: (key: TransformKey, val: number) => void,
  resolve: (v: Value) => number = getNumericValue,
): void {
  const single = (name: string, args: Value[]) => {
    switch (name) {
      case "translate":
        set("translateX", resolve(args[0]));
        set("translateY", args.length > 1 ? resolve(args[1]) : 0);
        break;
      case "translateX":
        set("translateX", resolve(args[0]));
        break;
      case "translateY":
        set("translateY", resolve(args[0]));
        break;
      case "rotate":
        set("rotate", resolve(args[0]));
        break;
      case "scale": {
        const sx = resolve(args[0]);
        set("scaleX", sx);
        set("scaleY", args.length > 1 ? resolve(args[1]) : sx);
        break;
      }
      case "scaleX":
        set("scaleX", resolve(args[0]));
        break;
      case "scaleY":
        set("scaleY", resolve(args[0]));
        break;
      case "skew":
        set("skewX", resolve(args[0]));
        set("skewY", args.length > 1 ? resolve(args[1]) : 0);
        break;
      case "skewX":
        set("skewX", resolve(args[0]));
        break;
      case "skewY":
        set("skewY", resolve(args[0]));
        break;
      case "matrix": {
        if (args.length < 6) break;
        const [a, b, c, d, e, f] = args.map(resolve);
        const m = decomposeMatrix(a, b, c, d);
        set("translateX", e);
        set("translateY", f);
        set("rotate", m.rotate);
        set("scaleX", m.scaleX);
        set("scaleY", m.scaleY);
        set("skewX", m.skewX);
        set("skewY", 0);
        break;
      }
    }
  };

  if (isFunctionValue(value)) {
    single(value.name, value.args);
  } else if (isListValue(value)) {
    for (const v of value.values) {
      if (isFunctionValue(v)) single(v.name, v.args);
    }
  }
}

// `translate`/`rotate`/`scale` props → transform channels; false otherwise.
// NOTE: shares channels with `transform:` (last wins), not CSS's layering.
export function extractIndividualTransform(
  property: string,
  value: Value,
  set: (key: TransformKey, val: number) => void,
  resolve: (v: Value) => number = getNumericValue,
): boolean {
  const parts = isListValue(value) ? value.values : [value];
  switch (property) {
    case "translate":
      set("translateX", resolve(parts[0]));
      set("translateY", parts.length > 1 ? resolve(parts[1]) : 0);
      return true;
    case "rotate":
      set("rotate", resolve(parts[0]));
      return true;
    case "scale": {
      const sx = resolve(parts[0]);
      set("scaleX", sx);
      set("scaleY", parts.length > 1 ? resolve(parts[1]) : sx);
      return true;
    }
  }
  return false;
}

// `object-view-box: xywh(x y w h)` → source-crop rect; null = whole bitmap.
// NOTE: `inset()` unsupported; its edges need the decoded intrinsic size.
export function extractImageViewBox(
  value: Value,
  resolve: (v: Value) => number = getNumericValue,
): ImageViewBox | null {
  if (isKeywordValue(value) && value.value === "none") return null;
  if (
    isFunctionValue(value) &&
    value.name === "xywh" &&
    value.args.length >= 4
  ) {
    return {
      x: resolve(value.args[0]),
      y: resolve(value.args[1]),
      width: resolve(value.args[2]),
      height: resolve(value.args[3]),
    };
  }
  return null;
}

// A reactive transform operand, bare or as a function arg; re-extracted per frame.
export function transformHasVariable(value: Value): boolean {
  const items = isListValue(value) ? value.values : [value];
  return items.some(
    (item) =>
      hasVariableReference(item) ||
      (isFunctionValue(item) && item.args.some(hasVariableReference)),
  );
}

const ORIGIN_KEYWORDS = new Map([
  ["left", 0],
  ["top", 0],
  ["center", 50],
  ["right", 100],
  ["bottom", 100],
]);

// One transform-origin component; unknown keywords read as 0px, non-% lengths as px.
function originComponent(v: Value): TransformOriginValue | null {
  if (isKeywordValue(v)) {
    const pct = ORIGIN_KEYWORDS.get(v.value);
    return pct === undefined
      ? { value: 0, unit: "px" }
      : { value: pct, unit: "%" };
  }
  if (isLengthValue(v))
    return { value: v.value, unit: v.unit === "%" ? "%" : "px" };
  if (isNumberValue(v)) return { value: v.value, unit: "px" };
  return null;
}

// transform-origin: keywords, %, px, or mixed; a leading top/bottom swaps axes.
export function parseTransformOrigin(
  value: Value,
): Transform["transformOrigin"] {
  const values = isListValue(value) ? value.values : [value];
  const origin = createDefaultTransformOrigin();
  if (values.length === 0) return origin;
  const yFirst = oneOf(values[0], ["top", "bottom"]) !== null;
  const first = originComponent(values[0]);
  if (first && yFirst) {
    origin.y = first;
    origin.x = { value: 50, unit: "%" };
  } else if (first) origin.x = first;
  if (values.length >= 2) {
    const second = originComponent(values[1]);
    if (second) origin[yFirst ? "x" : "y"] = second;
  } else if (!yFirst) {
    // A lone x value defaults y to 50% (CSS: `100px` = `100px 50%`).
    origin.y = { value: 50, unit: "%" };
  }
  return origin;
}
