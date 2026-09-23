import type { FunctionValue, Value } from "@popkorn/parser";
import {
  getNumericValue,
  isColorValue,
  isFunctionValue,
  isKeywordValue,
  isStringValue,
} from "@popkorn/parser";
import { tryParseColor } from "../renderer/color.js";
import { oklabToString, tryParseOklabColor } from "../renderer/oklab.js";

// Canonical hex/rgba or null; folds hsl()/named colors at build time so the hot path only parses hex/rgb.
function canonicalColor(raw: string): string | null {
  const c = tryParseColor(raw);
  if (!c) return null;
  if (c.a >= 1) {
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  }
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

// Back to a CSS token so tryParseOklabColor owns component rules; alpha arrives as the 4th arg.
function colorArgToken(v: Value): string {
  if (v.type === "number") return String(v.value);
  if (v.type === "length") return `${v.value}${v.unit}`;
  if (v.type === "keyword") return v.value;
  return "0";
}

function buildColorString(func: FunctionValue): string {
  if (func.name === "rgb" || func.name === "rgba") {
    // One component per letter: rgb() drops a 4th arg, rgba() requires it.
    const parts = [...func.name].map((_, i) => getNumericValue(func.args[i]));
    return `${func.name}(${parts.join(", ")})`;
  }
  if (func.name === "oklab" || func.name === "oklch") {
    // Kept as oklab(), not hex: the spelling tells interpolateColor to skip sRGB.
    const tokens = func.args.map(colorArgToken);
    const args =
      tokens.length > 3
        ? `${tokens.slice(0, 3).join(" ")} / ${tokens[3]}`
        : tokens.join(" ");
    const ok = tryParseOklabColor(`${func.name}(${args})`);
    return ok ? oklabToString(ok) : "#000000";
  }
  if (func.name === "hsl" || func.name === "hsla") {
    // s/l carry `%`, which getNumericValue strips to 0..100.
    const h = getNumericValue(func.args[0]);
    const s = getNumericValue(func.args[1]);
    const l = getNumericValue(func.args[2]);
    const a = func.args[3] != null ? getNumericValue(func.args[3]) : 1;
    const suffix = a >= 1 ? "" : `, ${a}`;
    return canonicalColor(`hsla(${h}, ${s}%, ${l}%${suffix})`) ?? "#000000";
  }
  return "#000000";
}

const COLOR_FUNCS = new Set(["rgb", "rgba", "hsl", "hsla", "oklab", "oklch"]);

// Named colors -> hex; other keywords pass through; `none` -> null (no paint).
export function colorStringFromValue(value: Value): string | null {
  if (isColorValue(value)) return value.value;
  if (isKeywordValue(value)) {
    if (value.value === "none") return null;
    return canonicalColor(value.value) ?? value.value;
  }
  // Host-set strings count only if they parse as a color.
  if (isStringValue(value)) return canonicalColor(value.value);
  if (isFunctionValue(value) && COLOR_FUNCS.has(value.name)) {
    return buildColorString(value);
  }
  return null;
}
