// Declaration Value → paint, gradient, clip, mask, filter and offset data.

import type { FunctionValue, Value } from "@popkorn/parser";
import {
  evalCalcStatic,
  getNumericValue,
  getStringValue,
  isCalcValue,
  isColorValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
  isStringValue,
} from "@popkorn/parser";
import type { HueMethod } from "../renderer/oklab.js";
import type {
  GradientData,
  GradientInterpolation,
  GradientStop,
  PathCommand,
} from "../renderer/types.js";
import { colorStringFromValue } from "./color.js";
import { parsePath } from "./path-parser.js";
import type { PendingMask } from "./post-build.js";
import type {
  ClipPathData,
  FilterOp,
  MaskMode,
  OffsetRotate,
  SceneNode,
  StateStyles,
} from "./types.js";
import { MASK_MODES } from "./types.js";

// The keyword when `v` is one of `options`, else null.
export function oneOf<T extends string>(
  v: Value,
  options: readonly T[],
): T | null {
  return isKeywordValue(v) && (options as readonly string[]).includes(v.value)
    ? (v.value as T)
    : null;
}

// CSS gradient functions accepted as fill/stroke paint (all via parseGradient).
export const GRADIENT_FN = new Set([
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
]);

// fill/stroke → its solid or gradient channel; `exclusive` also nulls the solid.
export function applyPaint(
  target: Pick<
    StateStyles,
    "fill" | "stroke" | "fillGradient" | "strokeGradient"
  >,
  prop: "fill" | "stroke",
  value: Value,
  exclusive: boolean,
): void {
  const paint = parsePaint(value);
  if (paint?.type === "gradient") {
    // Invalid gradient falls back to no fill.
    target[prop === "fill" ? "fillGradient" : "strokeGradient"] =
      paint.gradient;
    if (exclusive) target[prop] = null;
  } else if (paint) {
    target[prop] = paint.color;
  }
}

/** Image source from a `url('…')` function value, or a bare string. */
export function imageSrc(value: Value): string {
  if (isFunctionValue(value) && value.name === "url") {
    return value.args.length > 0 ? getStringValue(value.args[0]) : "";
  }
  return getStringValue(value);
}

// Fill/stroke → gradient or color (either null if invalid/none); null if not paint.
export function parsePaint(
  value: Value,
):
  | { type: "gradient"; gradient: GradientData | null }
  | { type: "color"; color: string | null }
  | null {
  if (isFunctionValue(value) && GRADIENT_FN.has(value.name)) {
    return { type: "gradient", gradient: parseGradient(value) };
  }
  // Named colors normalize to hex at build, so endpoints are hex.
  if (isKeywordValue(value) && value.value === "none") {
    return { type: "color", color: null };
  }
  const color = colorStringFromValue(value);
  if (color !== null) return { type: "color", color };
  return null;
}

// Flattened gradient args → GradientData; null without color stops.
function parseGradient(func: FunctionValue): GradientData | null {
  // `repeating-<kind>()` tiles the stop run; otherwise the kind carries through.
  const repeating = func.name.startsWith("repeating-");
  const kind = repeating ? func.name.slice("repeating-".length) : func.name;
  const isLinear = kind === "linear-gradient";
  const isConic = kind === "conic-gradient";
  const args = func.args;
  let i = 0;

  const num = (v?: Value): number | null =>
    v && (isLengthValue(v) || isNumberValue(v)) ? v.value : null;

  // `in <space> [<method> hue]`, either side of the direction.
  // NOTE: only oklab/oklch are realized; other spaces degrade to sRGB.
  let interpolate: GradientInterpolation | undefined;
  const keywordAt = (k: number): string | null => {
    const a = args[k];
    return a && isKeywordValue(a) ? a.value : null;
  };
  const eatInterpolation = (): void => {
    if (keywordAt(i) !== "in") return;
    const space = keywordAt(i + 1);
    if (space === null) return;
    // Consume unrealized spaces too, so they aren't misread as colour stops.
    i += 2;
    if (space !== "oklab" && space !== "oklch") {
      if (keywordAt(i + 1) === "hue") i += 2;
      return;
    }
    let hue: HueMethod | undefined;
    const method = keywordAt(i);
    if (space === "oklch" && keywordAt(i + 1) === "hue") {
      if (
        method === "shorter" ||
        method === "longer" ||
        method === "increasing" ||
        method === "decreasing"
      ) {
        hue = method;
        i += 2;
      }
    }
    interpolate = { space, hue };
  };
  eatInterpolation();

  // CSS default linear direction is `to bottom` (180deg).
  let angle = 180;
  if (
    isLinear &&
    i === 0 &&
    args.length > 0 &&
    isLengthValue(args[0]) &&
    args[0].unit === "deg"
  ) {
    angle = args[0].value;
    i = 1;
  }
  eatInterpolation();

  // `at <x>px <y>px` centre, shared by conic and radial.
  let at: { x: number; y: number } | undefined;

  // conic: `from <angle>` (0 = up, clockwise), `at` defaults to the box centre.
  let fromAngle = 0;
  if (isConic) {
    for (;;) {
      const kw = keywordAt(i);
      if (kw === "from" && args[i + 1] && num(args[i + 1]) != null) {
        fromAngle = num(args[i + 1])!;
        i += 2;
        continue;
      }
      if (kw === "at") {
        const x = num(args[i + 1]);
        const y = num(args[i + 2]);
        if (x != null && y != null) {
          at = { x, y };
          i += 3;
          continue;
        }
      }
      break;
    }
  }

  // Lottie geometry: linear `from/to`, radial `circle <r> at … [from <focal>]`.
  let from: { x: number; y: number } | undefined;
  let to: { x: number; y: number } | undefined;
  let radius: number | undefined;
  let focal: { x: number; y: number } | undefined;
  while (!isConic && keywordAt(i) !== null) {
    const kw = keywordAt(i);
    const x = num(args[i + 1]);
    if (kw === "circle" && x != null) {
      radius = x;
      i += 2;
      continue;
    }
    const y = num(args[i + 2]);
    if (kw === "at" && x != null && y != null) {
      at = { x, y };
      i += 3;
      continue;
    }
    if (kw === "to" && x != null && y != null) {
      to = { x, y };
      i += 3;
      continue;
    }
    if (kw === "from" && x != null && y != null) {
      if (isLinear) from = { x, y };
      else focal = { x, y };
      i += 3;
      continue;
    }
    break; // unknown keyword — leave it for the stop loop to skip
  }

  const stops: GradientStop[] = [];
  while (i < args.length) {
    const color = colorStringFromValue(args[i++]);
    if (color === null) continue; // skip anything that isn't a color
    let offset: number | null = null;
    const next = args[i];
    // `%` for every kind; conic also accepts `deg` (fraction of a turn).
    if (next && isLengthValue(next) && next.unit === "%") {
      offset = next.value / 100;
      i++;
    } else if (isConic && next && isLengthValue(next) && next.unit === "deg") {
      offset = next.value / 360;
      i++;
    }
    stops.push({ color, offset: offset ?? -1 });
  }

  if (stops.length === 0) return null;

  // Fill in any omitted stop offsets by even distribution.
  const n = stops.length;
  for (let k = 0; k < n; k++) {
    if (stops[k].offset < 0) {
      stops[k].offset = n === 1 ? 0 : k / (n - 1);
    }
  }

  if (isConic)
    return {
      type: "conic-gradient",
      from: fromAngle,
      stops,
      at,
      repeating,
      interpolate,
    };
  return isLinear
    ? {
        type: "linear-gradient",
        angle,
        stops,
        from,
        to,
        repeating,
        interpolate,
      }
    : {
        type: "radial-gradient",
        stops,
        radius,
        at,
        focal,
        repeating,
        interpolate,
      };
}

// clip-path: circle(r at x y) | inset(t r b l) | path('d'); null = unclipped.
export function parseClipPath(value: Value): ClipPathData | null {
  // Space-separated path()s union (Lottie add-mode) as one nonzero path.
  if (isListValue(value)) {
    const commands: PathCommand[] = [];
    for (const v of value.values) {
      if (isFunctionValue(v) && v.name === "path") {
        const arg = v.args[0];
        if (arg && isStringValue(arg)) commands.push(...parsePath(arg.value));
      }
    }
    return commands.length > 0 ? { type: "path", commands } : null;
  }

  if (!isFunctionValue(value)) return null;

  if (value.name === "circle") {
    // Args: [r, keyword 'at', x, y] — collect the numeric ones in order.
    const nums = value.args
      .filter((a) => isLengthValue(a) || isNumberValue(a))
      .map(getNumericValue);
    if (nums.length === 0) return null;
    return { type: "circle", r: nums[0], x: nums[1] ?? 0, y: nums[2] ?? 0 };
  }

  if (value.name === "inset") {
    const nums = value.args
      .filter((a) => isLengthValue(a) || isNumberValue(a))
      .map(getNumericValue);
    if (nums.length === 0) return null;
    // CSS shorthand: 1 -> all, 2 -> (t/b, l/r), 4 -> t r b l.
    const top = nums[0];
    const right = nums[1] ?? top;
    const bottom = nums[2] ?? top;
    const left = nums[3] ?? right;
    return { type: "inset", top, right, bottom, left };
  }

  if (value.name === "path") {
    const arg = value.args[0];
    if (arg && isStringValue(arg)) {
      return { type: "path", commands: parsePath(arg.value) };
    }
  }

  return null;
}

// `mask: #<id> [alpha|luminance][-invert]`; resolved after build.
export function parseMask(
  node: SceneNode,
  value: Value,
  pendingMasks: PendingMask[],
): void {
  const values = isListValue(value) ? value.values : [value];
  let sourceId: string | null = null;
  let mode: MaskMode = "alpha";
  for (const v of values) {
    // A hex-like id (`#fade`) lexes as a color; mask takes no colors.
    if (isColorValue(v) && v.value.startsWith("#")) {
      sourceId = v.value.slice(1);
      continue;
    }
    if (!isKeywordValue(v)) continue;
    if (v.value.startsWith("#")) sourceId = v.value.slice(1);
    else mode = oneOf(v, MASK_MODES) ?? mode;
  }
  if (sourceId) pendingMasks.push({ node, sourceId, mode });
}

// blur, drop-shadow (default black: no currentcolor), color-adjusts (% → 0..1).
export function parseFilter(value: Value): FilterOp[] | null {
  const fns = isListValue(value) ? value.values : [value];
  const ops: FilterOp[] = [];
  // A color-adjust scalar: percent -> fraction (50% => 0.5), else the number.
  const frac = (v: Value | undefined, dflt: number): number => {
    if (!v) return dflt;
    if (isLengthValue(v) && v.unit === "%") return getNumericValue(v) / 100;
    return getNumericValue(v);
  };
  for (const v of fns) {
    if (!isFunctionValue(v)) continue;
    if (v.name === "blur") {
      ops.push({
        type: "blur",
        radius: v.args[0] ? getNumericValue(v.args[0]) : 0,
      });
    } else if (
      v.name === "brightness" ||
      v.name === "contrast" ||
      v.name === "saturate" ||
      v.name === "grayscale" ||
      v.name === "sepia" ||
      v.name === "invert" ||
      v.name === "opacity"
    ) {
      ops.push({ type: v.name, amount: frac(v.args[0], 1) });
    } else if (v.name === "hue-rotate") {
      // NOTE: angle read in degrees; turn/rad units aren't unwound here.
      ops.push({
        type: "hue-rotate",
        amount: v.args[0] ? getNumericValue(v.args[0]) : 0,
      });
    } else if (v.name === "drop-shadow") {
      // Flattened args: lengths are dx/dy/blur, color anywhere.
      const lengths: number[] = [];
      let color = "#000000";
      for (const a of v.args) {
        if (isLengthValue(a) || isNumberValue(a))
          lengths.push(getNumericValue(a));
        else {
          const c = colorStringFromValue(a);
          if (c) color = c;
        }
      }
      ops.push({
        type: "drop-shadow",
        dx: lengths[0] ?? 0,
        dy: lengths[1] ?? 0,
        blur: lengths[2] ?? 0,
        color,
      });
    }
  }
  return ops.length ? ops : null;
}

// box-shadow → drop-shadow FilterOps; source order = first paints on top.
export function parseBoxShadow(value: Value): FilterOp[] | null {
  if (isKeywordValue(value) && value.value === "none") return null;
  // Comma list of shadows, each a space list or a lone value.
  const groups =
    isListValue(value) && value.separator === "comma" ? value.values : [value];
  const ops: FilterOp[] = [];
  for (const g of groups) {
    const parts = isListValue(g) ? g.values : [g];
    const lengths: number[] = [];
    let color = "#000000";
    let inset = false;
    for (const p of parts) {
      if (isKeywordValue(p) && p.value === "inset") {
        inset = true;
      } else if (isLengthValue(p) || isNumberValue(p)) {
        lengths.push(getNumericValue(p));
      } else {
        const c = colorStringFromValue(p);
        if (c) color = c;
      }
    }
    // dx/dy are required in CSS; a shadow with neither is inert — skip it.
    if (lengths.length < 2) continue;
    ops.push({
      type: "drop-shadow",
      dx: lengths[0],
      dy: lengths[1],
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      color,
      inset,
    });
  }
  return ops.length ? ops : null;
}

// offset-rotate: `auto` (default) | `<angle>` | `auto <angle>`.
export function parseOffsetRotate(value: Value): OffsetRotate {
  const values = isListValue(value) ? value.values : [value];
  let auto = false;
  let angle = 0;
  let sawAuto = false;
  let sawAngle = false;
  for (const v of values) {
    if (isKeywordValue(v) && v.value === "auto") {
      auto = true;
      sawAuto = true;
    } else if (isLengthValue(v) || isNumberValue(v)) {
      angle = getNumericValue(v);
      sawAngle = true;
    }
  }
  // Nothing recognized -> CSS default `auto`.
  if (!sawAuto && !sawAngle) auto = true;
  return { auto, angle };
}

// 50% → 0.5; a bare number is taken as-is.
export function normalizeFraction(value: Value): number {
  // Fold calc() first so `calc(… * 100%)` keeps its percent unit.
  const v = isCalcValue(value) ? (evalCalcStatic(value) ?? value) : value;
  if (isLengthValue(v) && v.unit === "%") return v.value / 100;
  return getNumericValue(v);
}
