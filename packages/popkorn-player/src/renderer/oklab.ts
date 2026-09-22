// Oklab / Oklch (CSS Color 4). Perceptually uniform, so a mix between two
// colors keeps its lightness and chroma instead of dipping through the grey,
// muddy midpoints sRGB gives you (blue -> yellow is the classic offender).
//
// Colors authored as oklab()/oklch() stay spelled `oklab(...)` all the way to
// the interpolation call rather than folding to hex like hsl() does: the
// spelling IS the marker that says "this pair does not interpolate in sRGB",
// which is exactly CSS's rule. Everyone who didn't opt in still hits the
// hex/rgb fast path.

import type { RGBAColor } from "./types.js";

export interface OklabColor {
  L: number; // 0..1 perceptual lightness
  a: number; // green -> red
  b: number; // blue -> yellow
  alpha: number;
}

// CSS Color 4 uses 0.4 as the 100% reference for oklab a/b and oklch chroma.
const AB_REFERENCE = 0.4;

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** sRGB (0-255 channels) -> Oklab. */
export function rgbaToOklab(c: RGBAColor): OklabColor {
  const r = srgbToLinear(c.r / 255);
  const g = srgbToLinear(c.g / 255);
  const b = srgbToLinear(c.b / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: c.a,
  };
}

/**
 * Oklab -> sRGB (0-255 channels). Out-of-gamut results are clipped per channel.
 * NOTE: per-channel clip, not a chroma-reducing gamut map — a saturated wide
 * gamut color clips toward the sRGB cube face rather than desaturating along
 * constant lightness. Upgrade to CSS Color 4 gamut mapping (binary-search
 * chroma against deltaEOK) if authors start feeding real display-p3 values.
 */
export function oklabToRgba(c: OklabColor): RGBAColor {
  const l = (c.L + 0.3963377774 * c.a + 0.2158037573 * c.b) ** 3;
  const m = (c.L - 0.1055613458 * c.a - 0.0638541728 * c.b) ** 3;
  const s = (c.L - 0.0894841775 * c.a - 1.291485548 * c.b) ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: Math.round(clamp01(linearToSrgb(r)) * 255),
    g: Math.round(clamp01(linearToSrgb(g)) * 255),
    b: Math.round(clamp01(linearToSrgb(b)) * 255),
    a: c.alpha,
  };
}

/** Oklch (polar) -> Oklab (rectangular). Hue in degrees. */
export function oklchToOklab(
  L: number,
  C: number,
  hDeg: number,
  alpha: number,
): OklabColor {
  const h = (hDeg * Math.PI) / 180;
  return { L, a: C * Math.cos(h), b: C * Math.sin(h), alpha };
}

/** Oklab (rectangular) -> Oklch (polar). Hue in degrees, 0..360. */
export function oklabToOklch(c: OklabColor): {
  L: number;
  C: number;
  h: number;
  alpha: number;
} {
  const C = Math.hypot(c.a, c.b);
  let h = (Math.atan2(c.b, c.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L: c.L, C, h, alpha: c.alpha };
}

/**
 * A `<hue>` component: a bare number or an explicitly-united angle. Bare
 * numbers are degrees, as CSS specifies.
 */
function parseHue(token: string): number | null {
  const m = token.match(/^(-?[\d.]+)(deg|rad|grad|turn)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  switch (m[2]) {
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    case "turn":
      return n * 360;
    default:
      return n;
  }
}

/**
 * One oklab()/oklch() component. `%` resolves against `reference`; a bare
 * number is already in the channel's own units. `none` is CSS Color 4's
 * missing-component keyword and resolves to 0, which is its behavior for
 * every interpolation we do.
 */
function parseComponent(token: string, reference: number): number | null {
  if (token === "none") return 0;
  if (token.endsWith("%")) {
    const n = parseFloat(token.slice(0, -1));
    return Number.isFinite(n) ? (n / 100) * reference : null;
  }
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : null;
}

/** Alpha: `<number>` 0..1 or `<percentage>`. */
function parseAlpha(token: string | undefined): number {
  if (token == null || token === "none") return 1;
  const n = token.endsWith("%")
    ? parseFloat(token.slice(0, -1)) / 100
    : parseFloat(token);
  return Number.isFinite(n) ? clamp01(n) : 1;
}

/**
 * Parse `oklab(L a b[ / alpha])` or `oklch(L C H[ / alpha])`, returning null
 * when the text is not one of those functions or its components don't parse.
 */
export function tryParseOklabColor(value: string): OklabColor | null {
  const m = value
    .trim()
    .toLowerCase()
    .match(/^okl(ab|ch)\(([^)]*)\)$/);
  if (!m) return null;

  const [components, alphaToken] = m[2].split("/").map((s) => s.trim());
  const parts = components.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;

  const alpha = parseAlpha(alphaToken);
  // L accepts 0..1 or 0%..100%.
  const L = parseComponent(parts[0], 1);
  if (L == null) return null;

  if (m[1] === "ab") {
    const a = parseComponent(parts[1], AB_REFERENCE);
    const b = parseComponent(parts[2], AB_REFERENCE);
    return a == null || b == null ? null : { L, a, b, alpha };
  }

  const C = parseComponent(parts[1], AB_REFERENCE);
  const h = parts[2] === "none" ? 0 : parseHue(parts[2]);
  return C == null || h == null ? null : oklchToOklab(L, C, h, alpha);
}

/** Serialize to the canonical `oklab(L a b[ / alpha])` spelling. */
export function oklabToString(c: OklabColor): string {
  const n = (v: number) => +v.toFixed(6);
  const base = `oklab(${n(c.L)} ${n(c.a)} ${n(c.b)}`;
  return c.alpha >= 1 ? `${base})` : `${base} / ${n(c.alpha)})`;
}

/** True when a color string is authored in a non-legacy (wide gamut) space. */
export function isOklabSpelling(value: string): boolean {
  return /^\s*okl(ab|ch)\(/i.test(value);
}

/** Component-wise mix in rectangular Oklab. */
export function mixOklab(
  from: OklabColor,
  to: OklabColor,
  t: number,
): OklabColor {
  return {
    L: from.L + (to.L - from.L) * t,
    a: from.a + (to.a - from.a) * t,
    b: from.b + (to.b - from.b) * t,
    alpha: from.alpha + (to.alpha - from.alpha) * t,
  };
}

/** How a hue arc is chosen when interpolating in a polar space (CSS Color 4). */
export type HueMethod = "shorter" | "longer" | "increasing" | "decreasing";

/** Resolve two hues to the arc `method` selects, per CSS Color 4 §12.4. */
export function resolveHueArc(
  h1: number,
  h2: number,
  method: HueMethod,
): [number, number] {
  let a = h1;
  let b = h2;
  const diff = b - a;
  switch (method) {
    case "shorter":
      if (diff > 180) a += 360;
      else if (diff < -180) b += 360;
      break;
    case "longer":
      if (diff > 0 && diff < 180) a += 360;
      else if (diff > -180 && diff <= 0) b += 360;
      break;
    case "increasing":
      if (diff < 0) b += 360;
      break;
    case "decreasing":
      if (diff > 0) a += 360;
      break;
  }
  return [a, b];
}

/** Mix in polar Oklch, taking the hue arc `method` selects. */
export function mixOklch(
  from: OklabColor,
  to: OklabColor,
  t: number,
  method: HueMethod = "shorter",
): OklabColor {
  const p = oklabToOklch(from);
  const q = oklabToOklch(to);
  // An achromatic endpoint has no meaningful hue — carry the other's so the
  // mix runs along constant hue instead of swinging through an arbitrary arc.
  const ph = p.C < 1e-6 ? q.h : p.h;
  const qh = q.C < 1e-6 ? p.h : q.h;
  const [h1, h2] = resolveHueArc(ph, qh, method);

  return oklchToOklab(
    p.L + (q.L - p.L) * t,
    p.C + (q.C - p.C) * t,
    h1 + (h2 - h1) * t,
    p.alpha + (q.alpha - p.alpha) * t,
  );
}
