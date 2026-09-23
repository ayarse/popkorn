// CSS color strings → RGBA: hex, rgb(a), hsl(a), oklab/oklch and a named subset.

import { oklabToRgba, tryParseOklabColor } from "./oklab.js";
import type { Color, RGBAColor } from "./types.js";

export function colorToCSS(color: Color): string {
  if (typeof color === "string") {
    return color;
  }
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

// Duplicated from converters svg2popkorn.ts `hslToRgb` so the player stays dependency-free; keep in sync.
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

// Hand-authoring subset of CSS named colors, duplicated from converters `NAMED`; keep in sync.
const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  lime: [0, 255, 0],
  aqua: [0, 255, 255],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  fuchsia: [255, 0, 255],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  gold: [255, 215, 0],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  crimson: [220, 20, 60],
  coral: [255, 127, 80],
  salmon: [250, 128, 114],
  khaki: [240, 230, 140],
  orchid: [218, 112, 214],
  plum: [221, 160, 221],
  tan: [210, 180, 140],
  turquoise: [64, 224, 208],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  darkblue: [0, 0, 139],
  darkgreen: [0, 100, 0],
  darkred: [139, 0, 0],
  steelblue: [70, 130, 180],
  slategray: [112, 128, 144],
  skyblue: [135, 206, 235],
  tomato: [255, 99, 71],
  seagreen: [46, 139, 87],
  royalblue: [65, 105, 225],
  dodgerblue: [30, 144, 255],
};

// Hex, rgb/rgba, hsl/hsla, oklab/oklch and the named subset; null when unrecognized.
export function tryParseColor(value: string): RGBAColor | null {
  const s = value.trim().toLowerCase();

  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3)
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length !== 6 && hex.length !== 8) return null;
    const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return {
      r: byte(0),
      g: byte(2),
      b: byte(4),
      a: hex.length === 8 ? byte(6) / 255 : 1,
    };
  }

  const rgbaMatch = s.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/,
  );
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  const hslMatch = s.match(/^hsla?\(([^)]*)\)$/);
  if (hslMatch) {
    const parts = hslMatch[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = hslToRgb(
      parseFloat(parts[0]),
      parseFloat(parts[1]) / 100,
      parseFloat(parts[2]) / 100,
    );
    return { r, g, b, a: parts[3] != null ? parseFloat(parts[3]) : 1 };
  }

  // oklab()/oklch() (CSS Color 4). Wide-gamut input clips per channel.
  if (s.startsWith("okl")) {
    const ok = tryParseOklabColor(s);
    if (ok) return oklabToRgba(ok);
  }

  const named = NAMED_COLORS[s];
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 };

  return null;
}

// Total (never null) for hot paths: unknown input is opaque black.
export function parseColor(value: string): RGBAColor {
  return tryParseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
}
