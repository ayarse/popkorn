import type { FunctionValue, Value } from "@popkorn/parser";
import {
  getNumericValue,
  isColorValue,
  isFunctionValue,
  isKeywordValue,
  isStringValue,
} from "@popkorn/parser";
import { oklabToString, tryParseOklabColor } from "../renderer/oklab.js";
import { tryParseColor } from "../renderer/types.js";

// Resolve any parseable color string to a canonical hex/rgba string, or null if
// unrecognized. Used to fold hsl()/named colors down to hex at build time (so
// animation endpoints are already hex, and the per-frame hot path only parses
// hex/rgb).
export function canonicalColor(raw: string): string | null {
  const c = tryParseColor(raw);
  if (!c) return null;
  if (c.a >= 1) {
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  }
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

/**
 * Render one color-function argument back to its CSS token. Keeps the
 * component rules (`%`, `none`, `<angle>` units) in tryParseOklabColor rather
 * than duplicating them against the AST here. The parser flattens `/` to a
 * positional arg, so alpha arrives as the 4th token and is re-slashed below.
 */
function colorArgToken(v: Value): string {
  if (v.type === "number") return String(v.value);
  if (v.type === "length") return `${v.value}${v.unit}`;
  if (v.type === "keyword") return v.value;
  return "0";
}

function buildColorString(func: FunctionValue): string {
  if (func.name === "rgb") {
    const r = getNumericValue(func.args[0]);
    const g = getNumericValue(func.args[1]);
    const b = getNumericValue(func.args[2]);
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (func.name === "rgba") {
    const r = getNumericValue(func.args[0]);
    const g = getNumericValue(func.args[1]);
    const b = getNumericValue(func.args[2]);
    const a = getNumericValue(func.args[3]);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (func.name === "oklab" || func.name === "oklch") {
    // Normalize to canonical oklab() rather than folding to hex like hsl():
    // the oklab() spelling is what tells interpolateColor this endpoint does
    // not interpolate in sRGB (CSS Color 4's rule). Only opted-in colors pay
    // the wider parse on the hot path.
    const tokens = func.args.map(colorArgToken);
    const args =
      tokens.length > 3
        ? `${tokens.slice(0, 3).join(" ")} / ${tokens[3]}`
        : tokens.join(" ");
    const ok = tryParseOklabColor(`${func.name}(${args})`);
    return ok ? oklabToString(ok) : "#000000";
  }
  if (func.name === "hsl" || func.name === "hsla") {
    // Fold hsl()/hsla() to canonical hex/rgba once so the per-frame hot path
    // only parses hex/rgb (s/l args carry a `%` unit, which getNumericValue
    // strips to 0..100).
    const h = getNumericValue(func.args[0]);
    const s = getNumericValue(func.args[1]);
    const l = getNumericValue(func.args[2]);
    const a = func.args[3] != null ? getNumericValue(func.args[3]) : 1;
    const suffix = a >= 1 ? "" : `, ${a}`;
    return canonicalColor(`hsla(${h}, ${s}%, ${l}%${suffix})`) ?? "#000000";
  }
  return "#000000";
}

/**
 * A CSS color string from a color/keyword/rgb()/rgba()/hsl()/hsla() value, else
 * null. Named colors normalize to canonical hex; transparent/currentColor/
 * unknown keywords pass through untouched; `none` -> null (no paint).
 */
export function colorStringFromValue(value: Value): string | null {
  if (isColorValue(value)) return value.value;
  if (isKeywordValue(value)) {
    if (value.value === "none") return null;
    return canonicalColor(value.value) ?? value.value;
  }
  // An untyped host-set string in a paint slot: accept it only if it parses as a
  // color (canonicalized to hex/rgba); otherwise it's not a color -> null.
  if (isStringValue(value)) return canonicalColor(value.value);
  if (
    isFunctionValue(value) &&
    (value.name === "rgb" ||
      value.name === "rgba" ||
      value.name === "hsl" ||
      value.name === "hsla" ||
      value.name === "oklab" ||
      value.name === "oklch")
  ) {
    return buildColorString(value);
  }
  return null;
}
