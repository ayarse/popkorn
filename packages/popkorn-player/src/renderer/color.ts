// CSS color strings → RGBA: hex, rgb(a), hsl(a), oklab/oklch and CSS named colors.

import { NAMED_COLOR_RGB } from "@popkorn/parser";
import { oklabToRgba, tryParseOklabColor } from "./oklab.js";
import type { Color, RGBAColor } from "./types.js";

export function colorToCSS(color: Color): string {
  if (typeof color === "string") {
    return color;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

// HSL (h degrees, s/l 0..1) → sRGB bytes.
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ];
}

// CSS number or percentage; `pct` is the value 100% maps to.
function channel(v: string | undefined, pct: number): number {
  if (v == null) return Number.NaN;
  return v.endsWith("%") ? (parseFloat(v) / 100) * pct : parseFloat(v);
}

const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));

// Hex, rgb/rgba, hsl/hsla (legacy or space syntax, % channels), oklab/oklch and CSS named colors; null when unrecognized.
export function tryParseColor(value: string): RGBAColor | null {
  const s = value.trim().toLowerCase();

  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) hex = hex.replace(/./g, "$&$&");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return {
      r: byte(0),
      g: byte(2),
      b: byte(4),
      a: hex.length === 8 ? byte(6) / 255 : 1,
    };
  }

  const fn = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    const a = parts[3] != null ? clamp(channel(parts[3], 1), 1) : 1;
    const byte = (i: number) => Math.round(clamp(channel(parts[i], 255), 255));
    const rgb: [number, number, number] = fn[1].startsWith("rgb")
      ? [byte(0), byte(1), byte(2)]
      : // s/l: `%` or a bare number (CSS Color 4), both 0..100.
        hslToRgb(
          parseFloat(parts[0]),
          parseFloat(parts[1]) / 100,
          parseFloat(parts[2]) / 100,
        );
    if (rgb.some(Number.isNaN) || Number.isNaN(a)) return null;
    return { r: rgb[0], g: rgb[1], b: rgb[2], a };
  }

  // oklab()/oklch() (CSS Color 4). Wide-gamut input clips per channel.
  if (s.startsWith("okl")) {
    const ok = tryParseOklabColor(s);
    if (ok) return oklabToRgba(ok);
  }

  const named = NAMED_COLOR_RGB.get(s);
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 };

  return null;
}

// Total (never null) for hot paths: unknown input is opaque black.
export function parseColor(value: string): RGBAColor {
  return tryParseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
}
