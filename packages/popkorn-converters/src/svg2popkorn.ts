/**
 * SVG -> Popkorn DSL converter core (phase 1: static import).
 *
 * Pure conversion logic — no Node builtins (fs/path/process), so this module is
 * importable from both a CLI wrapper and browser code (the demo's "Import SVG"
 * tool). It mirrors `packages/popkorn-converters/src/lottie2popkorn.ts` in spirit: a small normalization
 * layer over real-world SVG quirks, a warning/blocked-feature ledger, and a
 * self-contained emitter that produces CSS the `@popkorn/parser` can parse.
 *
 * The high-level model: the SVG's `viewBox` becomes the `:root` stage (with a
 * root translate baked when its min corner is non-zero); each drawable element
 * becomes one rule. Representable `transform`s (translate/rotate/scale, incl.
 * `rotate(a cx cy)` and shear-free `matrix()`) decompose onto the node; a
 * sheared transform bakes into the geometry instead. Presentation attributes,
 * `<style>` rules and inline `style=""` cascade into one computed style per
 * element; inheritable paint flows down the tree. `<use>`/`<symbol>` expand
 * inline; gradients/clipPaths/masks/filters resolve from `<defs>`.
 *
 * Phase 2 (part 1): CSS `@keyframes` from `<style>` blocks import into Popkorn
 * `@keyframes` + `animation-*` decls (opacity/fill/stroke/transform/dash channels;
 * timing/easing/iteration/direction/fill-mode). Unmappable properties, gradient
 * keyframes, `@media`-wrapped keyframes, and animated transforms on baked/sheared
 * geometry degrade to a warning.
 *
 * Phase 2 (part 2): SMIL `<animate>`/`<animateTransform>` import through the same
 * IR — attributeName routes through the CSS property mapping; animateTransform
 * translate/rotate/scale become transform keyframes (rotate center → transform-
 * origin). values/keyTimes, from/to/by, calcMode spline/discrete/paced, dur,
 * clock-value begin, repeatCount, and fill="freeze" are honored. `<set>`,
 * `<animateMotion>`, event/sync-base begins, additive/accumulate, and skew
 * degrade to a warning.
 */
import { parsePath } from "@popkorn/player";
import {
  emitColor,
  type Rule,
  sanitizeIdent,
  serializeRule,
  num as sharedNum,
  warnOnce,
} from "./shared";
import { parseXml, type SvgNode } from "./svg-xml";

export { validate } from "./shared";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Round to `dec` decimals; the SVG emitter defaults to 3 decimals. */
const num = (x: number, dec = 3): string => sharedNum(x, dec);

// ---------------------------------------------------------------------------
// 2D affine matrices — SVG convention [a b c d e f] mapping
//   (x, y) -> (a*x + c*y + e, b*x + d*y + f)
// ---------------------------------------------------------------------------

type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function matMul(A: Mat, B: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = A;
  const [a2, b2, c2, d2, e2, f2] = B;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function matApply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function matInvert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

function isIdentity(m: Mat): boolean {
  return (
    m[0] === 1 &&
    m[1] === 0 &&
    m[2] === 0 &&
    m[3] === 1 &&
    m[4] === 0 &&
    m[5] === 0
  );
}

const DEG = Math.PI / 180;

/** Parse an SVG `transform` attribute into a composed matrix. */
function parseTransform(s: string): Mat {
  let m: Mat = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null = re.exec(s);
  for (; match !== null; match = re.exec(s)) {
    const name = match[1];
    const args = match[2]
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !isNaN(n));
    let t: Mat | null = null;
    switch (name) {
      case "translate":
        t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
        break;
      case "scale":
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = (args[0] || 0) * DEG;
        const cos = Math.cos(a),
          sin = Math.sin(a);
        const rot: Mat = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          const cx = args[1],
            cy = args[2];
          t = matMul(matMul([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
        } else t = rot;
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan((args[0] || 0) * DEG), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan((args[0] || 0) * DEG), 0, 1, 0, 0];
        break;
      case "matrix":
        if (args.length >= 6)
          t = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
    }
    if (t) m = matMul(m, t);
  }
  return m;
}

/** Decompose a shear-free affine matrix into translate/rotate(deg)/scale. */
function decompose(m: Mat): {
  tx: number;
  ty: number;
  rot: number;
  sx: number;
  sy: number;
  shear: number;
} {
  let [a, b, c, d] = m;
  const tx = m[4],
    ty = m[5];
  let sx = Math.hypot(a, b);
  if (sx === 0)
    return { tx, ty, rot: 0, sx: 0, sy: Math.hypot(c, d), shear: 0 };
  a /= sx;
  b /= sx;
  let shear = a * c + b * d;
  c -= a * shear;
  d -= b * shear;
  const sy = Math.hypot(c, d);
  if (sy === 0)
    return { tx, ty, rot: Math.atan2(b, a) / DEG, sx, sy: 0, shear: 0 };
  c /= sy;
  d /= sy;
  shear /= sy;
  // Restore a mirror (negative determinant) as a negative x scale.
  if (a * d - b * c < 0) {
    a = -a;
    b = -b;
    sx = -sx;
    shear = -shear;
  }
  return { tx, ty, rot: Math.atan2(b, a) / DEG, sx, sy, shear };
}

// ---------------------------------------------------------------------------
// Colors — normalize any SVG color to hex / rgba(), folding an opacity 0..1 in.
// ---------------------------------------------------------------------------

// A pragmatic subset of the 147 CSS named colors — the ones that actually show
// up in hand-authored/exported SVG. Unknown names fall back with a warning.
const NAMED: Record<string, [number, number, number]> = {
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

/** Parse a CSS/SVG color to [r,g,b,a] (0..255, a 0..1), or null if unrecognized. */
function parseColor(raw: string): [number, number, number, number] | null {
  const s = raw.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  if (s[0] === "#") {
    const h = s.slice(1);
    const x = (i: number, len: number) =>
      parseInt(len === 1 ? h[i] + h[i] : h.slice(i, i + 2), 16);
    if (h.length === 3 || h.length === 4) {
      return [x(0, 1), x(1, 1), x(2, 1), h.length === 4 ? x(3, 1) / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      return [x(0, 2), x(2, 2), x(4, 2), h.length === 8 ? x(6, 2) / 255 : 1];
    }
    return null;
  }
  const fn = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    const p = (v: string, scale = 1) =>
      v.endsWith("%") ? (parseFloat(v) / 100) * scale : parseFloat(v);
    if (fn[1].startsWith("rgb")) {
      return [
        Math.round(p(parts[0], 255)),
        Math.round(p(parts[1], 255)),
        Math.round(p(parts[2], 255)),
        parts[3] != null ? p(parts[3]) : 1,
      ];
    }
    const [r, g, b] = hslToRgb(parseFloat(parts[0]), p(parts[1]), p(parts[2]));
    return [r, g, b, parts[3] != null ? p(parts[3]) : 1];
  }
  if (NAMED[s]) return [...NAMED[s], 1];
  return null;
}

/** Serialize [r,g,b,a] to #rrggbb (alpha≈1) or rgba(). */
function colorString(c: [number, number, number, number]): string {
  return emitColor(c[0], c[1], c[2], c[3]);
}

// ---------------------------------------------------------------------------
// Style cascade
// ---------------------------------------------------------------------------

type Style = Record<string, string>;

// SVG-inherited presentation properties (opacity/display/stop-* do NOT inherit).
const INHERITED = new Set([
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "visibility",
]);

const PRESENTATION = [
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "stop-color",
  "stop-opacity",
  "display",
  "visibility",
];

interface StyleSelector {
  compounds: { tag?: string; id?: string; classes: string[] }[];
  specificity: number;
  order: number;
}
interface StyleBlock {
  sel: StyleSelector;
  decls: Style;
}

/** One `@keyframes` stop: its offset selectors (0..100) and raw declarations. */
interface RawStop {
  offsets: number[];
  decls: Style;
}

interface StyleSheet {
  blocks: StyleBlock[];
  keyframes: Map<string, RawStop[]>;
}

/** Split CSS into top-level `{prelude, body}` rules, respecting brace nesting. */
function splitTopLevelRules(css: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = [];
  let i = 0;
  const nStart = css.length;
  while (i < nStart) {
    // Read a prelude up to the next '{' (or end).
    const brace = css.indexOf("{", i);
    if (brace < 0) break;
    const prelude = css.slice(i, brace);
    // Capture a balanced body.
    let depth = 1,
      j = brace + 1;
    for (; j < nStart && depth > 0; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
    }
    out.push({ prelude, body: css.slice(brace + 1, j - 1) });
    i = j;
  }
  return out;
}

function parseDecls(body: string): Style {
  const decls: Style = {};
  for (const d of body.split(";")) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
  }
  return decls;
}

/** Parse a `@keyframes` body into its stops (from/to/percent selectors + decls). */
function parseKeyframeStops(body: string): RawStop[] {
  const stops: RawStop[] = [];
  for (const { prelude, body: stopBody } of splitTopLevelRules(body)) {
    const offsets: number[] = [];
    for (const sel of prelude.split(",")) {
      const s = sel.trim().toLowerCase();
      if (s === "from") offsets.push(0);
      else if (s === "to") offsets.push(100);
      else {
        const v = parseFloat(s);
        if (!isNaN(v)) offsets.push(v);
      }
    }
    if (offsets.length) stops.push({ offsets, decls: parseDecls(stopBody) });
  }
  return stops;
}

/** Parse a `<style>` element's CSS into flat selector->decls blocks + keyframes. */
function parseCss(css: string, warn: (m: string) => void): StyleSheet {
  // Strip comments.
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: StyleBlock[] = [];
  const keyframes = new Map<string, RawStop[]>();
  let order = 0;
  for (const { prelude, body } of splitTopLevelRules(css)) {
    const selText = prelude.trim();
    if (selText[0] === "@") {
      const kf = selText.match(/^@(?:-webkit-)?keyframes\s+([\w-]+)/i);
      if (kf) {
        keyframes.set(kf[1], parseKeyframeStops(body));
      } else if (/^@media/i.test(selText)) {
        // Nested keyframes/rules inside @media aren't cascaded here.
        if (/@(?:-webkit-)?keyframes/i.test(body))
          warn("SVG <style> @media-wrapped @keyframes skipped");
        else warn("SVG <style> @media rule skipped");
      } else {
        warn("SVG <style> at-rule skipped");
      }
      continue;
    }
    const decls = parseDecls(body);
    for (const one of selText.split(",")) {
      const sel = parseSelector(one.trim(), warn);
      if (sel) blocks.push({ sel: { ...sel, order: order++ }, decls });
    }
  }
  return { blocks, keyframes };
}

function parseSelector(
  text: string,
  warn: (m: string) => void,
): Omit<StyleSelector, "order"> | null {
  if (/[>+~]/.test(text)) {
    warn(
      `exotic CSS selector '${text}' ignored (only descendant combinators supported)`,
    );
    return null;
  }
  const compounds: StyleSelector["compounds"] = [];
  let spec = 0;
  for (const part of text.split(/\s+/).filter(Boolean)) {
    const c: { tag?: string; id?: string; classes: string[] } = { classes: [] };
    const re = /([.#]?)([\w-]+)|\*/g;
    let t: RegExpExecArray | null = re.exec(part);
    for (; t !== null; t = re.exec(part)) {
      if (t[0] === "*") continue;
      if (t[1] === "#") {
        c.id = t[2];
        spec += 100;
      } else if (t[1] === ".") {
        c.classes.push(t[2]);
        spec += 10;
      } else {
        c.tag = t[2].toLowerCase();
        spec += 1;
      }
    }
    compounds.push(c);
  }
  return compounds.length ? { compounds, specificity: spec } : null;
}

function compoundMatches(
  c: { tag?: string; id?: string; classes: string[] },
  el: SvgNode,
): boolean {
  if (c.tag && c.tag !== el.tag) return false;
  if (c.id && c.id !== el.attrs.get("id")) return false;
  if (c.classes.length) {
    const cls = (el.attrs.get("class") || "").split(/\s+/);
    if (!c.classes.every((k) => cls.includes(k))) return false;
  }
  return true;
}

/** Descendant-combinator match of a selector against an element + its ancestors. */
function selectorMatches(
  sel: StyleSelector,
  el: SvgNode,
  ancestors: SvgNode[],
): boolean {
  const cs = sel.compounds;
  if (!compoundMatches(cs[cs.length - 1], el)) return false;
  let ai = ancestors.length - 1;
  for (let i = cs.length - 2; i >= 0; i--) {
    while (ai >= 0 && !compoundMatches(cs[i], ancestors[ai])) ai--;
    if (ai < 0) return false;
    ai--;
  }
  return true;
}

/** Resolve the final computed style for an element (cascade + inheritance). */
function computeStyle(
  el: SvgNode,
  ancestors: SvgNode[],
  inherited: Style,
  sheet: StyleBlock[],
): Style {
  const s: Style = {};
  for (const k of INHERITED)
    if (inherited[k] !== undefined) s[k] = inherited[k];
  for (const p of PRESENTATION) {
    const v = el.attrs.get(p);
    if (v !== undefined) s[p] = v;
  }
  const matched = sheet.filter((b) => selectorMatches(b.sel, el, ancestors));
  matched.sort(
    (a, b) =>
      a.sel.specificity - b.sel.specificity || a.sel.order - b.sel.order,
  );
  for (const b of matched)
    for (const [k, v] of Object.entries(b.decls)) s[k] = v;
  const inline = el.attrs.get("style");
  if (inline)
    for (const d of inline.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) s[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    }
  return s;
}

// ---------------------------------------------------------------------------
// Geometry -> absolute path commands (for shear-baking and clip synthesis)
// ---------------------------------------------------------------------------

const KAPPA = 0.5522847498307936;
type Cmd = {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  rx?: number;
  ry?: number;
  angle?: number;
  largeArc?: boolean;
  sweep?: boolean;
};

function n(el: SvgNode, k: string, def = 0): number {
  const v = el.attrs.get(k);
  if (v === undefined || v === "") return def;
  const f = parseFloat(v);
  return isNaN(f) ? def : f;
}

function ellipseCmds(cx: number, cy: number, rx: number, ry: number): Cmd[] {
  const ox = rx * KAPPA,
    oy = ry * KAPPA;
  return [
    { type: "M", x: cx, y: cy - ry },
    {
      type: "C",
      x1: cx + ox,
      y1: cy - ry,
      x2: cx + rx,
      y2: cy - oy,
      x: cx + rx,
      y: cy,
    },
    {
      type: "C",
      x1: cx + rx,
      y1: cy + oy,
      x2: cx + ox,
      y2: cy + ry,
      x: cx,
      y: cy + ry,
    },
    {
      type: "C",
      x1: cx - ox,
      y1: cy + ry,
      x2: cx - rx,
      y2: cy + oy,
      x: cx - rx,
      y: cy,
    },
    {
      type: "C",
      x1: cx - rx,
      y1: cy - oy,
      x2: cx - ox,
      y2: cy - ry,
      x: cx,
      y: cy - ry,
    },
    { type: "Z" },
  ];
}

function pointsAttr(el: SvgNode): number[] {
  return (el.attrs.get("points") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((v) => !isNaN(v));
}

/** Absolute path commands for any drawable element, or null if not geometry. */
function elementCmds(el: SvgNode): Cmd[] | null {
  switch (el.tag) {
    case "rect": {
      const x = n(el, "x"),
        y = n(el, "y"),
        w = n(el, "width"),
        h = n(el, "height");
      // Rounded corners are dropped when baking (rare under shear); the sharp
      // rect is the honest fallback.
      return [
        { type: "M", x, y },
        { type: "L", x: x + w, y },
        { type: "L", x: x + w, y: y + h },
        { type: "L", x, y: y + h },
        { type: "Z" },
      ];
    }
    case "circle":
      return ellipseCmds(n(el, "cx"), n(el, "cy"), n(el, "r"), n(el, "r"));
    case "ellipse":
      return ellipseCmds(n(el, "cx"), n(el, "cy"), n(el, "rx"), n(el, "ry"));
    case "line":
      return [
        { type: "M", x: n(el, "x1"), y: n(el, "y1") },
        { type: "L", x: n(el, "x2"), y: n(el, "y2") },
      ];
    case "polyline":
    case "polygon": {
      const pts = pointsAttr(el);
      if (pts.length < 2) return [];
      const cmds: Cmd[] = [{ type: "M", x: pts[0], y: pts[1] }];
      for (let i = 2; i + 1 < pts.length; i += 2)
        cmds.push({ type: "L", x: pts[i], y: pts[i + 1] });
      if (el.tag === "polygon") cmds.push({ type: "Z" });
      return cmds;
    }
    case "path":
      return parsePath(el.attrs.get("d") || "") as unknown as Cmd[];
    default:
      return null;
  }
}

/** Transform absolute commands through a matrix, tracking current point for H/V. */
function transformCmds(cmds: Cmd[], m: Mat, warn: (s: string) => void): Cmd[] {
  let cx = 0,
    cy = 0;
  const dec = decompose(m);
  const scale = (Math.abs(dec.sx) + Math.abs(dec.sy)) / 2;
  const out: Cmd[] = [];
  const pt = (x: number, y: number): [number, number] => matApply(m, x, y);
  for (const c of cmds) {
    switch (c.type) {
      case "M":
      case "L":
      case "T": {
        const [x, y] = pt(c.x!, c.y!);
        cx = c.x!;
        cy = c.y!;
        out.push({ type: c.type, x, y });
        break;
      }
      case "H": {
        const [x, y] = pt(c.x!, cy);
        cx = c.x!;
        out.push({ type: "L", x, y });
        break;
      }
      case "V": {
        const [x, y] = pt(cx, c.y!);
        cy = c.y!;
        out.push({ type: "L", x, y });
        break;
      }
      case "C": {
        const [x1, y1] = pt(c.x1!, c.y1!),
          [x2, y2] = pt(c.x2!, c.y2!),
          [x, y] = pt(c.x!, c.y!);
        cx = c.x!;
        cy = c.y!;
        out.push({ type: "C", x1, y1, x2, y2, x, y });
        break;
      }
      case "S": {
        const [x2, y2] = pt(c.x2!, c.y2!),
          [x, y] = pt(c.x!, c.y!);
        cx = c.x!;
        cy = c.y!;
        out.push({ type: "S", x2, y2, x, y });
        break;
      }
      case "Q": {
        const [x1, y1] = pt(c.x1!, c.y1!),
          [x, y] = pt(c.x!, c.y!);
        cx = c.x!;
        cy = c.y!;
        out.push({ type: "Q", x1, y1, x, y });
        break;
      }
      case "A": {
        // Exact only for similarity transforms; under shear the arc radii are
        // approximated by the mean scale (endpoint stays exact).
        const [x, y] = pt(c.x!, c.y!);
        cx = c.x!;
        cy = c.y!;
        if (Math.abs(dec.shear) > 1e-4)
          warn("elliptical arc baked through a shear was approximated");
        out.push({
          type: "A",
          rx: (c.rx || 0) * scale,
          ry: (c.ry || 0) * scale,
          angle: (c.angle || 0) + dec.rot,
          largeArc: c.largeArc,
          sweep: dec.sx * dec.sy < 0 ? !c.sweep : c.sweep,
          x,
          y,
        });
        break;
      }
      case "Z":
        out.push({ type: "Z" });
        break;
    }
  }
  return out;
}

function cmdsToD(cmds: Cmd[]): string {
  return cmds
    .map((c) => {
      switch (c.type) {
        case "M":
        case "L":
        case "T":
          return `${c.type} ${num(c.x!)} ${num(c.y!)}`;
        case "C":
          return `C ${num(c.x1!)} ${num(c.y1!)} ${num(c.x2!)} ${num(c.y2!)} ${num(c.x!)} ${num(c.y!)}`;
        case "S":
          return `S ${num(c.x2!)} ${num(c.y2!)} ${num(c.x!)} ${num(c.y!)}`;
        case "Q":
          return `Q ${num(c.x1!)} ${num(c.y1!)} ${num(c.x!)} ${num(c.y!)}`;
        case "A":
          return `A ${num(c.rx!)} ${num(c.ry!)} ${num(c.angle!)} ${c.largeArc ? 1 : 0} ${c.sweep ? 1 : 0} ${num(c.x!)} ${num(c.y!)}`;
        case "Z":
          return "Z";
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join(" ");
}

/** Rough local-space bbox of an element from its absolute commands (control pts). */
function elementBBox(el: SvgNode): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (el.tag === "rect")
    return {
      x: n(el, "x"),
      y: n(el, "y"),
      w: n(el, "width"),
      h: n(el, "height"),
    };
  if (el.tag === "circle") {
    const r = n(el, "r");
    return { x: n(el, "cx") - r, y: n(el, "cy") - r, w: r * 2, h: r * 2 };
  }
  if (el.tag === "ellipse") {
    const rx = n(el, "rx"),
      ry = n(el, "ry");
    return { x: n(el, "cx") - rx, y: n(el, "cy") - ry, w: rx * 2, h: ry * 2 };
  }
  const cmds = elementCmds(el);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (x?: number, y?: number) => {
    if (x !== undefined) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (y !== undefined) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  };
  for (const c of cmds || []) {
    add(c.x, c.y);
    add(c.x1, c.y1);
    add(c.x2, c.y2);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

export class Converter {
  warnings: string[] = [];
  blocked = new Set<string>();
  private ids = new Set<string>();
  private counter = 0;
  private byId = new Map<string, SvgNode>();
  private sheet: StyleBlock[] = [];
  private keyframes = new Map<string, RawStop[]>();
  // Emitted @keyframes blocks (top-level), and the dedup/name maps that back them.
  private keyframeBlocks: string[] = [];
  private emittedKf = new Map<string, string>(); // `${name}|${allowTransform}` -> emitted name
  private usedKfNames = new Set<string>();
  private vbW = 0;
  private vbH = 0;
  private useStack = new Set<string>();
  // Emitted mask sources: id -> Rule (declared once at top level).
  private maskDefs = new Map<string, Rule>();

  warnOnce(m: string) {
    warnOnce(this.warnings, m);
  }

  private uniqueId(raw: string | undefined, tag: string): string {
    let base = sanitizeIdent(raw);
    if (!base || !/^[a-zA-Z_]/.test(base))
      base = raw ? `el-${base}`.replace(/-+$/g, "") : `${tag}${++this.counter}`;
    if (base === "el-" || base === "el") base = `${tag}${++this.counter}`;
    let id = base,
      k = 2;
    while (this.ids.has(id)) id = `${base}-${k++}`;
    this.ids.add(id);
    return id;
  }

  private index(el: SvgNode) {
    const id = el.attrs.get("id");
    if (id && !this.byId.has(id)) this.byId.set(id, el);
    for (const c of el.children) this.index(c);
  }

  convert(source: string): string {
    const svg = parseXml(source);
    if (svg.tag !== "svg")
      throw new Error(`expected <svg> root, got <${svg.tag}>`);
    this.index(svg);

    // Collect <style> element CSS.
    const styleText = collectStyles(svg);
    if (styleText) {
      const parsed = parseCss(styleText, (m) => this.warnOnce(m));
      this.sheet = parsed.blocks;
      this.keyframes = parsed.keyframes;
    }

    // Stage from viewBox (preferred) or width/height attrs.
    const vb = (svg.attrs.get("viewBox") || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    let minX = 0,
      minY = 0,
      w: number,
      h: number;
    if (vb.length === 4 && vb.every((v) => !isNaN(v))) {
      [minX, minY, w, h] = vb;
      this.vbW = w;
      this.vbH = h;
    } else {
      w = n(svg, "width", 300);
      h = n(svg, "height", 150);
      this.vbW = w;
      this.vbH = h;
    }

    // Root style (svg's own presentation attrs) seeds inheritance.
    const rootStyle = computeStyle(svg, [], {}, this.sheet);
    const rootTranslate =
      minX !== 0 || minY !== 0 ? ([-minX, -minY] as const) : null;

    const children: Rule[] = [];
    for (const c of svg.children) {
      const r = this.walk(c, [svg], rootStyle, IDENTITY, IDENTITY);
      if (r) children.push(...r);
    }

    const top: Rule[] = [];
    if (rootTranslate) {
      top.push({
        id: this.uniqueId("root", "g"),
        type: "group",
        decls: [
          `transform: translate(${num(rootTranslate[0])}px, ${num(rootTranslate[1])}px)`,
        ],
        children,
      });
    } else top.push(...children);
    // Mask sources live at top level (referenced by id, never painted directly).
    for (const md of this.maskDefs.values()) top.push(md);

    const out: string[] = [];
    out.push(
      "/* Generated from SVG by packages/popkorn-converters/src/svg2popkorn.ts */",
    );
    out.push(`:root {`);
    out.push(`  width: ${num(w)}px;`);
    out.push(`  height: ${num(h)}px;`);
    out.push(`}`);
    out.push("");
    for (const kf of this.keyframeBlocks) {
      out.push(kf);
      out.push("");
    }
    for (const r of top) out.push(serializeRule(r, 0, true));
    return (
      out
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd() + "\n"
    );
  }

  /** Walk one element, returning the emitted rule(s) (0..n; <use> may expand). */
  private walk(
    el: SvgNode,
    ancestors: SvgNode[],
    inherited: Style,
    emitCTM: Mat,
    bakeM: Mat,
  ): Rule[] | null {
    // Non-drawable / definition elements.
    switch (el.tag) {
      case "defs":
      case "symbol":
      case "clippath":
      case "mask":
      case "lineargradient":
      case "radialgradient":
      case "style":
      case "title":
      case "desc":
      case "metadata":
      case "filter":
        return null;
      case "pattern":
        this.blocked.add("pattern");
        return null;
      case "marker":
        this.blocked.add("marker");
        return null;
      case "foreignobject":
        this.blocked.add("foreignObject");
        return null;
      case "textpath":
        this.blocked.add("textPath");
        return null;
    }
    const style = computeStyle(el, ancestors, inherited, this.sheet);
    if (style.display === "none" || style.visibility === "hidden") return null;

    // Own transform, composed under the accumulated bake matrix.
    const tf = el.attrs.get("transform") || style.transform;
    const localM = tf ? parseTransform(tf) : IDENTITY;
    const dec = decompose(localM);
    const sheared = Math.abs(dec.shear) > 1e-4;
    // Under an active bake (or a sheared local transform) we fold into geometry;
    // otherwise the representable transform decomposes onto the node.
    const baking = !isIdentity(bakeM) || sheared;
    let childBake = bakeM,
      childEmit = emitCTM;
    const transformDecls: string[] = [];
    if (baking) {
      childBake = matMul(bakeM, localM);
    } else if (!isIdentity(localM)) {
      const d = decls_transform(dec);
      if (d) transformDecls.push(d);
      childEmit = matMul(emitCTM, localM);
    }

    const nextAncestors = [...ancestors, el];
    const ctx = {
      style,
      emitCTM: baking ? emitCTM : childEmit,
      bakeM: childBake,
    };

    if (el.tag === "use")
      return this.expandUse(el, ancestors, inherited, emitCTM, bakeM);

    if (el.tag === "g" || el.tag === "a" || el.tag === "svg") {
      const kids: Rule[] = [];
      for (const c of el.children) {
        const r = this.walk(c, nextAncestors, style, ctx.emitCTM, ctx.bakeM);
        if (r) kids.push(...r);
      }
      if (kids.length === 0) return null;
      const group: Rule = {
        id: this.uniqueId(el.attrs.get("id"), "g"),
        type: "group",
        decls: [...transformDecls],
        children: kids,
      };
      this.applyContainer(el, style, group, ctx.emitCTM, ctx.bakeM);
      this.emitAnimation(style, group, baking);
      this.emitSmil(el, group, baking);
      return [group];
    }

    // Leaf drawables.
    const rule = this.buildLeaf(
      el,
      style,
      ctx.emitCTM,
      ctx.bakeM,
      transformDecls,
    );
    return rule ? [rule] : null;
  }

  /** clip-path / mask / opacity / filter that apply to a container group. */
  private applyContainer(
    el: SvgNode,
    style: Style,
    rule: Rule,
    _emitCTM: Mat,
    _bakeM: Mat,
  ) {
    if (style.opacity !== undefined) {
      const o = parseFloat(style.opacity);
      if (!isNaN(o) && o !== 1) rule.decls.push(`opacity: ${num(o, 3)}`);
    }
    this.applyClip(el, rule);
    this.applyMaskRef(el, rule);
    this.applyFilter(el, rule);
  }

  private buildLeaf(
    el: SvgNode,
    style: Style,
    emitCTM: Mat,
    bakeM: Mat,
    transformDecls: string[],
  ): Rule | null {
    const baking = !isIdentity(bakeM);
    const id = this.uniqueId(el.attrs.get("id"), el.tag);
    const decls: string[] = [...transformDecls];

    const paint = () => this.paintDecls(el, style, emitCTM, bakeM);

    let type: string | null = null;
    if (el.tag === "text") {
      type = "text";
      const content = flattenText(el, () =>
        this.warnOnce("SVG <tspan> flattened into one text run"),
      );
      decls.push(`content: ${JSON.stringify(content)}`);
      decls.push(`x: ${num(n(el, "x"))}px`, `y: ${num(n(el, "y"))}px`);
      if (style["font-size"])
        decls.push(`font-size: ${num(parseFloat(style["font-size"]))}px`);
      if (style["font-family"])
        decls.push(`font-family: ${fontFamily(style["font-family"])}`);
      if (style["font-weight"])
        decls.push(`font-weight: ${style["font-weight"]}`);
      if (style["text-anchor"])
        decls.push(`text-anchor: ${style["text-anchor"]}`);
      decls.push(
        ...this.paintDecls(el, style, emitCTM, bakeM, /*textDefaultFill*/ true),
      );
    } else if (el.tag === "image") {
      type = "image";
      const href = el.attrs.get("href") || "";
      decls.push(`content: url('${href}')`);
      decls.push(`x: ${num(n(el, "x"))}px`, `y: ${num(n(el, "y"))}px`);
      if (el.attrs.has("width")) decls.push(`width: ${num(n(el, "width"))}px`);
      if (el.attrs.has("height"))
        decls.push(`height: ${num(n(el, "height"))}px`);
    } else if (baking) {
      // Any geometry under a bake collapses to a transformed path.
      const cmds = elementCmds(el);
      if (!cmds) return null;
      if (el.tag === "rect" && (el.attrs.has("rx") || el.attrs.has("ry")))
        this.warnOnce(
          "rounded rect corners dropped when baking a sheared transform",
        );
      const baked = transformCmds(cmds, bakeM, (m) => this.warnOnce(m));
      type = "path";
      decls.push(`d: '${cmdsToD(baked)}'`);
      decls.push(...paint());
    } else {
      switch (el.tag) {
        case "rect": {
          type = "rect";
          decls.push(
            `x: ${num(n(el, "x"))}px`,
            `y: ${num(n(el, "y"))}px`,
            `width: ${num(n(el, "width"))}px`,
            `height: ${num(n(el, "height"))}px`,
          );
          const hasRx = el.attrs.has("rx"),
            hasRy = el.attrs.has("ry");
          if (hasRx || hasRy) {
            const rx = hasRx ? n(el, "rx") : n(el, "ry");
            const ry = hasRy ? n(el, "ry") : n(el, "rx");
            decls.push(`rx: ${num(rx)}px`, `ry: ${num(ry)}px`);
          }
          decls.push(...paint());
          break;
        }
        case "circle":
          type = "circle";
          decls.push(
            `cx: ${num(n(el, "cx"))}px`,
            `cy: ${num(n(el, "cy"))}px`,
            `r: ${num(n(el, "r"))}px`,
          );
          decls.push(...paint());
          break;
        case "ellipse":
          type = "ellipse";
          decls.push(
            `cx: ${num(n(el, "cx"))}px`,
            `cy: ${num(n(el, "cy"))}px`,
            `rx: ${num(n(el, "rx"))}px`,
            `ry: ${num(n(el, "ry"))}px`,
          );
          decls.push(...paint());
          break;
        case "path": {
          type = "path";
          const d = (el.attrs.get("d") || "").replace(/\s+/g, " ").trim();
          decls.push(`d: '${d}'`);
          decls.push(...paint());
          break;
        }
        case "line":
        case "polyline":
        case "polygon": {
          type = "path";
          decls.push(`d: '${cmdsToD(elementCmds(el)!)}'`);
          decls.push(...paint());
          break;
        }
        default:
          return null;
      }
    }
    if (!type) return null;
    const rule: Rule = { id, type, decls, children: [] };
    this.applyClip(el, rule);
    this.applyMaskRef(el, rule);
    this.applyFilter(el, rule);
    this.emitAnimation(style, rule, baking);
    this.emitSmil(el, rule, baking);
    return rule;
  }

  // --- CSS @keyframes animation -------------------------------------------

  /** Map raw CSS keyframe decls into Popkorn decl strings (registry-checked). */
  private mapAnimDecls(decls: Style, allowTransform: boolean): string[] {
    const out: string[] = [];
    for (const [prop, raw] of Object.entries(decls)) {
      switch (prop) {
        case "animation-timing-function":
          break; // hoisted to per-keyframe easing, not a value channel
        case "opacity": {
          const o = parseFloat(raw);
          if (!isNaN(o)) out.push(`opacity: ${num(o, 3)}`);
          break;
        }
        case "fill":
        case "stroke": {
          if (/^url\(/i.test(raw.trim())) {
            this.warnOnce(`animated ${prop} gradient not supported — dropped`);
            break;
          }
          if (raw.trim() === "none") {
            this.warnOnce(`animated ${prop}: none keyframe dropped`);
            break;
          }
          out.push(`${prop}: ${this.solid(raw, 1)}`);
          break;
        }
        case "stroke-width":
          out.push(`stroke-width: ${num(parseFloat(raw))}px`);
          break;
        case "stroke-dashoffset":
          out.push(`stroke-dashoffset: ${num(parseFloat(raw))}px`);
          break;
        case "transform": {
          if (!allowTransform) {
            this.warnOnce(
              "animated transform on a baked/sheared element dropped — geometry stays static",
            );
            break;
          }
          const t = mapAnimTransform(raw, (m) => this.warnOnce(m));
          if (t) out.push(`transform: ${t}`);
          break;
        }
        default:
          this.warnOnce(`animated property '${prop}' not supported — dropped`);
      }
    }
    return out;
  }

  /** Map a CSS timing-function to a Popkorn one, or undefined (defaults to ease). */
  private mapEasing(raw: string): string | undefined {
    const s = raw.trim();
    if (
      s === "linear" ||
      s === "ease" ||
      s === "ease-in" ||
      s === "ease-out" ||
      s === "ease-in-out" ||
      s === "step-start" ||
      s === "step-end"
    )
      return s;
    if (/^(cubic-bezier|steps|linear)\s*\(/i.test(s))
      return s.replace(/\s+/g, " ");
    this.warnOnce(
      `animation-timing-function '${s}' not supported — defaulted to ease`,
    );
    return undefined;
  }

  /** Resolve a referenced @keyframes to an emitted Popkorn name, or null. */
  private resolveKeyframes(
    name: string,
    allowTransform: boolean,
  ): string | null {
    const raw = this.keyframes.get(name);
    if (!raw) {
      this.warnOnce(
        `@keyframes '${name}' referenced but not defined — animation dropped`,
      );
      return null;
    }
    const key = `${name}|${allowTransform}`;
    const cached = this.emittedKf.get(key);
    if (cached) return cached;

    const stops: AnimStop[] = [];
    for (const rs of raw) {
      const easingRaw = rs.decls["animation-timing-function"];
      const mapped = this.mapAnimDecls(rs.decls, allowTransform);
      if (mapped.length === 0 && !easingRaw) continue;
      stops.push({
        offsets: rs.offsets,
        decls: mapped,
        easing: easingRaw ? this.mapEasing(easingRaw) : undefined,
      });
    }
    if (stops.every((s) => s.decls.length === 0)) {
      this.warnOnce(
        `@keyframes '${name}' had no supported animated properties — animation dropped`,
      );
      return null;
    }

    let base = sanitizeIdent(name);
    if (!base || !/^[a-zA-Z_]/.test(base)) base = `kf-${base}`;
    let emitted = base,
      k = 2;
    while (this.usedKfNames.has(emitted)) emitted = `${base}-${k++}`;
    this.usedKfNames.add(emitted);
    this.emittedKf.set(key, emitted);
    this.keyframeBlocks.push(emitKeyframes({ name: emitted, stops }));
    return emitted;
  }

  /** Emit `animation:`/`transform-origin` decls for an element from its style. */
  private emitAnimation(style: Style, rule: Rule, baked: boolean) {
    const shorthand = style.animation;
    const nameLong = style["animation-name"];
    if (!shorthand && !nameLong) return;

    const allowTransform = !baked;
    const groups = shorthand ? splitTopLevelCommas(shorthand) : [nameLong!];
    const emitted: string[] = [];
    for (const g of groups) {
      const tokens = splitSpaceTokens(g);
      let name: string | undefined;
      const rest: string[] = [];
      for (const t of tokens) {
        if (name === undefined && this.keyframes.has(t)) name = t;
        else rest.push(t);
      }
      if (!name) {
        this.warnOnce(
          "CSS animation with no matching @keyframes name — dropped",
        );
        continue;
      }
      const resolved = this.resolveKeyframes(name, allowTransform);
      if (!resolved) continue;
      emitted.push([resolved, ...rest].join(" ").trim());
    }
    if (emitted.length === 0) return;

    // Any `animation-*` longhand present overrides the shorthand's slots (the
    // builder applies them onto existing slots in source order); a bare
    // `animation-delay: -0.4s` on a higher-specificity rule is how CSS staggers.
    // `animation-name` is deliberately excluded — the shorthand already carries
    // the (renamed) keyframes reference and a raw name would point at the SVG id.
    const longhands: string[] = [];
    for (const p of [
      "animation-duration",
      "animation-delay",
      "animation-timing-function",
      "animation-iteration-count",
      "animation-direction",
      "animation-fill-mode",
    ])
      if (style[p]) longhands.push(`${p}: ${style[p].trim()}`);

    rule.decls.push(`animation: ${emitted.join(", ")}`);
    for (const l of longhands) rule.decls.push(l);

    const origin = style["transform-origin"];
    if (origin && !baked) rule.decls.push(`transform-origin: ${origin.trim()}`);
  }

  // --- SMIL <animate> / <animateTransform> --------------------------------

  /** Convert an element's SMIL animation children into Popkorn animations. */
  private emitSmil(el: SvgNode, rule: Rule, baked: boolean) {
    const anims = el.children.filter((c) =>
      ["animate", "animatetransform", "set", "animatemotion"].includes(c.tag),
    );
    if (anims.length === 0) return;

    const claimed = new Set<string>(); // channel -> already taken
    const shorthands: string[] = [];
    const originDecls: string[] = [];
    for (const a of anims) {
      if (a.tag === "set") {
        this.warnOnce("SVG SMIL <set> skipped (not an interpolated animation)");
        continue;
      }
      if (a.tag === "animatemotion") {
        this.warnOnce("SVG SMIL <animateMotion> skipped");
        continue;
      }
      const track = this.buildSmilTrack(a, baked);
      if (!track) continue;
      if (claimed.has(track.channel)) {
        this.warnOnce(
          `multiple SMIL animations target '${track.channel}' — only the first kept`,
        );
        continue;
      }
      claimed.add(track.channel);

      let base = `${rule.id}-${track.channel}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
      base = base.replace(/^-+|-+$/g, "");
      if (!base || !/^[a-zA-Z_]/.test(base)) base = `smil-${base}`;
      let name = base,
        k = 2;
      while (this.usedKfNames.has(name)) name = `${base}-${k++}`;
      this.usedKfNames.add(name);
      this.keyframeBlocks.push(emitKeyframes({ name, stops: track.stops }));
      shorthands.push([name, ...track.timing].join(" "));
      if (track.origin) originDecls.push(`transform-origin: ${track.origin}`);
    }
    if (shorthands.length === 0) return;
    rule.decls.push(`animation: ${shorthands.join(", ")}`);
    for (const o of originDecls) rule.decls.push(o);
  }

  /**
   * Normalize one <animate>/<animateTransform> into a keyframe track + timing.
   * Returns null (having warned) for anything unrepresentable.
   */
  private buildSmilTrack(
    a: SvgNode,
    baked: boolean,
  ): {
    channel: string;
    stops: AnimStop[];
    timing: string[];
    origin?: string;
  } | null {
    const warn = (m: string) => this.warnOnce(m);

    // additive/accumulate compose onto the base value — can't express as
    // absolute keyframes, so drop the channel.
    if (
      a.attrs.get("additive") === "sum" ||
      a.attrs.get("accumulate") === "sum"
    ) {
      warn("SMIL additive/accumulate='sum' not supported — channel dropped");
      return null;
    }

    // begin: clock-value offsets only (event / sync-base begins are out of scope).
    let delay = 0;
    const begin = a.attrs.get("begin");
    if (begin !== undefined && begin.trim() !== "") {
      const d = parseClock(begin);
      if (d === null) {
        warn("SMIL event/sync-base begin not supported — animation dropped");
        return null;
      }
      delay = d;
    }

    const dur = parseClock(a.attrs.get("dur"));
    if (dur === null || dur <= 0) {
      warn("SMIL animation without a finite dur dropped");
      return null;
    }

    const rawValues = smilValues(a, warn);
    if (!rawValues) return null;

    // Map each raw value to a Popkorn declaration string.
    let channel: string;
    let origin: string | undefined;
    const decls: (string | null)[] = [];
    if (a.tag === "animatetransform") {
      channel = "transform";
      if (baked) {
        warn(
          "animated transform on a baked/sheared element dropped — geometry stays static",
        );
        return null;
      }
      const type = (a.attrs.get("type") || "translate").toLowerCase();
      if (type === "skewx" || type === "skewy") {
        warn(`animated transform '${type}' not supported — dropped`);
        return null;
      }
      let center: string | null = null;
      for (const v of rawValues) {
        const r = smilTransformValue(type, v, warn);
        if (!r) {
          decls.push(null);
          continue;
        }
        const t = mapAnimTransform(r.value, warn);
        decls.push(t === null ? null : `transform: ${t}`);
        if (r.center) {
          if (center && center !== r.center)
            warn(
              "SMIL rotate center varies across keyframes — using the first",
            );
          center = center ?? r.center;
        }
      }
      origin = center ?? undefined;
    } else {
      channel = a.attrs.get("attributeName") || "";
      for (const v of rawValues)
        decls.push(this.mapAnimDecls({ [channel]: v }, false)[0] ?? null);
    }
    if (decls.some((d) => d === null)) return null; // mapper already warned

    const offsets = smilOffsets(a, rawValues.length, warn);
    if (!offsets) return null;
    const easings = smilEasings(a, rawValues.length, warn);

    const stops: AnimStop[] = decls.map((d, i) => ({
      offsets: [offsets[i]],
      decls: [d as string],
      easing: easings[i],
    }));

    // Timing tokens: `<dur>s linear [<delay>s] [<iter>] [forwards]`.
    const timing: string[] = [`${num(dur)}s`, "linear"];
    if (delay !== 0) timing.push(`${num(delay)}s`);
    const iter = smilIterations(a, warn);
    if (iter !== "1") timing.push(iter);
    if ((a.attrs.get("fill") || "").trim() === "freeze")
      timing.push("forwards");

    return { channel, stops, timing, origin };
  }

  /** fill / stroke / stroke-* / opacity / fill-rule decls from computed style. */
  private paintDecls(
    el: SvgNode,
    style: Style,
    emitCTM: Mat,
    bakeM: Mat,
    _textDefaultFill = false,
  ): string[] {
    const out: string[] = [];
    const fillOpacity =
      style["fill-opacity"] !== undefined
        ? parseFloat(style["fill-opacity"])
        : 1;
    const strokeOpacity =
      style["stroke-opacity"] !== undefined
        ? parseFloat(style["stroke-opacity"])
        : 1;

    // Fill: default is black in SVG unless explicitly none.
    const fillRaw = style.fill ?? "#000000";
    const fill = this.resolvePaint(
      fillRaw,
      fillOpacity,
      el,
      style,
      emitCTM,
      bakeM,
      "fill",
    );
    if (fill === null) out.push("fill: none");
    else if (fill !== undefined) out.push(`fill: ${fill}`);

    if (style.stroke !== undefined) {
      const stroke = this.resolvePaint(
        style.stroke,
        strokeOpacity,
        el,
        style,
        emitCTM,
        bakeM,
        "stroke",
      );
      if (stroke && stroke !== null) out.push(`stroke: ${stroke}`);
    }
    if (style["stroke-width"] !== undefined)
      out.push(`stroke-width: ${num(parseFloat(style["stroke-width"]))}px`);
    if (style["stroke-linecap"])
      out.push(`stroke-linecap: ${style["stroke-linecap"]}`);
    if (style["stroke-linejoin"])
      out.push(`stroke-linejoin: ${style["stroke-linejoin"]}`);
    if (style["stroke-miterlimit"])
      out.push(
        `stroke-miterlimit: ${num(parseFloat(style["stroke-miterlimit"]))}`,
      );
    if (style["stroke-dasharray"] && style["stroke-dasharray"] !== "none") {
      const dashes = style["stroke-dasharray"]
        .split(/[\s,]+/)
        .map(Number)
        .filter((v) => !isNaN(v));
      if (dashes.length)
        out.push(
          `stroke-dasharray: ${dashes.map((d) => `${num(d)}px`).join(" ")}`,
        );
    }
    if (style["stroke-dashoffset"])
      out.push(
        `stroke-dashoffset: ${num(parseFloat(style["stroke-dashoffset"]))}px`,
      );
    if (style["fill-rule"] === "evenodd") out.push("fill-rule: evenodd");
    if (style.opacity !== undefined) {
      const o = parseFloat(style.opacity);
      if (!isNaN(o) && o !== 1) out.push(`opacity: ${num(o, 3)}`);
    }
    return out;
  }

  /** Resolve a paint value: none -> null, url(#grad) -> gradient css, else color. */
  private resolvePaint(
    raw: string,
    opacity: number,
    el: SvgNode,
    style: Style,
    emitCTM: Mat,
    bakeM: Mat,
    kind: string,
  ): string | null | undefined {
    raw = raw.trim();
    if (raw === "none") return null;
    const url = raw.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/);
    if (url) {
      const def = this.byId.get(url[1]);
      if (def && (def.tag === "lineargradient" || def.tag === "radialgradient"))
        return (
          this.resolveGradient(def, el, opacity, emitCTM, bakeM) ?? "#000000"
        );
      this.warnOnce(
        `unsupported ${kind} reference url(#${url[1]}) — fell back to none`,
      );
      return null;
    }
    if (raw === "currentcolor" || raw === "currentColor") {
      const c = style.color;
      if (c) return this.solid(c, opacity);
      this.warnOnce("currentColor with no inherited color — resolved to black");
      return this.solid("#000000", opacity);
    }
    return this.solid(raw, opacity);
  }

  private solid(raw: string, opacity: number): string {
    const c = parseColor(raw);
    if (!c) {
      this.warnOnce(`unrecognized color '${raw}' — resolved to black`);
      return colorString([0, 0, 0, opacity]);
    }
    return colorString([c[0], c[1], c[2], c[3] * opacity]);
  }

  // --- gradients ----------------------------------------------------------

  /** Resolve a gradient element (href template + units + gradientTransform). */
  private resolveGradient(
    grad: SvgNode,
    target: SvgNode,
    opacity: number,
    emitCTM: Mat,
    bakeM: Mat,
  ): string | null {
    const g = this.flattenGradient(grad, new Set());
    const stops = this.gradientStops(g.stops, opacity);
    if (stops.length === 0) return null;

    const userSpace = g.attrs.get("gradientUnits") === "userSpaceOnUse";
    const gt = g.attrs.get("gradientTransform");
    const gtM = gt ? parseTransform(gt) : IDENTITY;
    const spread = g.attrs.get("spreadMethod");
    if (spread === "reflect" || spread === "repeat")
      this.warnOnce(`gradient spreadMethod '${spread}' approximated as pad`);

    const bbox = elementBBox(target);
    // Map a coordinate in the gradient's declared units into the shape's emit-local
    // space (matching the emitted geometry). objectBoundingBox coords are already
    // local (bbox is in raw authored space); userSpaceOnUse coords route through
    // the inverse of the accumulated representable transform. Baking, if active,
    // is then folded in so the endpoints track the baked geometry.
    const toLocal = (x: number, y: number): [number, number] => {
      if (userSpace) {
        const [ux, uy] = matApply(gtM, x, y);
        const [lx, ly] = matApply(matInvert(emitCTM), ux, uy);
        return matApply(bakeM, lx, ly);
      }
      const bboxMap: Mat = [bbox.w || 1, 0, 0, bbox.h || 1, bbox.x, bbox.y];
      const [gx, gy] = matApply(gtM, x, y);
      const [lx, ly] = matApply(bboxMap, gx, gy);
      return matApply(bakeM, lx, ly);
    };

    const coord = (attr: string, def: number, axis: 0 | 1): number => {
      const v = g.attrs.get(attr);
      if (v === undefined) return def;
      if (v.endsWith("%"))
        return (
          (parseFloat(v) / 100) *
          (userSpace ? (axis === 0 ? this.vbW : this.vbH) : 1)
        );
      return parseFloat(v);
    };

    if (grad.tag === "radialgradient") {
      const cx = coord("cx", 0.5, 0),
        cy = coord("cy", 0.5, 1),
        r = coord("r", 0.5, 0);
      const fx = g.attrs.has("fx") ? coord("fx", cx, 0) : cx;
      const fy = g.attrs.has("fy") ? coord("fy", cy, 1) : cy;
      const [lcx, lcy] = toLocal(cx, cy);
      const [px, py] = toLocal(cx + r, cy);
      const [qx, qy] = toLocal(cx, cy + r);
      const radX = Math.hypot(px - lcx, py - lcy);
      const radY = Math.hypot(qx - lcx, qy - lcy);
      const radius = (radX + radY) / 2;
      if (Math.abs(radX - radY) > Math.max(1e-3, radius * 0.02))
        this.warnOnce("elliptical radial gradient approximated as circular");
      let geom = `circle ${num(radius)}px at ${num(lcx)}px ${num(lcy)}px`;
      if (fx !== cx || fy !== cy) {
        const [lfx, lfy] = toLocal(fx, fy);
        geom += ` from ${num(lfx)}px ${num(lfy)}px`;
      }
      return `radial-gradient(${geom}, ${stops.join(", ")})`;
    }

    const x1 = coord("x1", 0, 0),
      y1 = coord("y1", 0, 1),
      x2 = coord("x2", userSpace ? 0 : 1, 0),
      y2 = coord("y2", 0, 1);
    const [fx, fy] = toLocal(x1, y1);
    const [tx, ty] = toLocal(x2, y2);
    return `linear-gradient(from ${num(fx)}px ${num(fy)}px to ${num(tx)}px ${num(ty)}px, ${stops.join(", ")})`;
  }

  /** Resolve a gradient's stops + geometry attrs, following href templates. */
  private flattenGradient(
    grad: SvgNode,
    seen: Set<string>,
  ): { attrs: Map<string, string>; stops: SvgNode[] } {
    const attrs = new Map(grad.attrs);
    let stops = grad.children.filter((c) => c.tag === "stop");
    const href = grad.attrs.get("href");
    if (href && href[0] === "#") {
      const id = href.slice(1);
      const parent = this.byId.get(id);
      if (
        parent &&
        !seen.has(id) &&
        (parent.tag === "lineargradient" || parent.tag === "radialgradient")
      ) {
        seen.add(id);
        const p = this.flattenGradient(parent, seen);
        for (const [k, v] of p.attrs) if (!attrs.has(k)) attrs.set(k, v);
        if (stops.length === 0) stops = p.stops;
      }
    }
    return { attrs, stops };
  }

  private gradientStops(stops: SvgNode[], opacity: number): string[] {
    const out: string[] = [];
    for (const s of stops) {
      const st = computeStyle(s, [], {}, this.sheet);
      const off = s.attrs.get("offset") ?? st["offset"] ?? "0";
      const pct = off.endsWith("%") ? parseFloat(off) : parseFloat(off) * 100;
      const so =
        st["stop-opacity"] !== undefined ? parseFloat(st["stop-opacity"]) : 1;
      const c = parseColor(st["stop-color"] ?? "#000000") ?? [0, 0, 0, 1];
      out.push(
        `${colorString([c[0], c[1], c[2], c[3] * so * opacity])} ${num(pct)}%`,
      );
    }
    return out;
  }

  // --- clip / mask / filter refs ------------------------------------------

  private applyClip(el: SvgNode, rule: Rule) {
    const cp = el.attrs.get("clip-path");
    if (!cp) return;
    const m = cp.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/);
    if (!m) return;
    const def = this.byId.get(m[1]);
    if (!def || def.tag !== "clippath") {
      this.warnOnce(`clip-path url(#${m[1]}) unresolved — ignored`);
      return;
    }
    if (def.attrs.get("clipPathUnits") === "objectBoundingBox") {
      this.warnOnce("clipPath objectBoundingBox units approximated");
    }
    const shapes = def.children.filter((c) => elementCmds(c) !== null);
    if (shapes.length === 0) return;
    // A single circle is the trivial circle() form; anything else unions to path().
    if (shapes.length === 1 && shapes[0].tag === "circle") {
      const c = shapes[0];
      rule.decls.push(
        `clip-path: circle(${num(n(c, "r"))}px at ${num(n(c, "cx"))}px ${num(n(c, "cy"))}px)`,
      );
      return;
    }
    const paths = shapes.map((c) => {
      const t = c.attrs.get("transform");
      const cmds = elementCmds(c)!;
      const abs = t
        ? transformCmds(cmds, parseTransform(t), (w) => this.warnOnce(w))
        : cmds;
      return `path('${cmdsToD(abs)}')`;
    });
    rule.decls.push(`clip-path: ${paths.join(" ")}`);
  }

  private applyMaskRef(el: SvgNode, rule: Rule) {
    const mk = el.attrs.get("mask");
    if (!mk) return;
    const m = mk.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/);
    if (!m) return;
    const def = this.byId.get(m[1]);
    if (!def || def.tag !== "mask") {
      this.warnOnce(`mask url(#${m[1]}) unresolved — ignored`);
      return;
    }
    const srcId = this.emitMaskDef(def);
    if (srcId) rule.decls.push(`mask: #${srcId} luminance`); // SVG mask default is luminance
  }

  /** Emit a <mask>'s content as a top-level source node (once); return its id. */
  private emitMaskDef(def: SvgNode): string | null {
    const key = def.attrs.get("id") || "";
    if (key && this.maskDefs.has(key)) return this.maskDefs.get(key)!.id;
    const kids: Rule[] = [];
    for (const c of def.children) {
      const r = this.walk(c, [def], {}, IDENTITY, IDENTITY);
      if (r) kids.push(...r);
    }
    if (kids.length === 0) return null;
    const id = this.uniqueId(def.attrs.get("id"), "mask");
    const group: Rule = { id, type: "group", decls: [], children: kids };
    if (key) this.maskDefs.set(key, group);
    else this.maskDefs.set(id, group);
    return id;
  }

  private applyFilter(el: SvgNode, rule: Rule) {
    const f = el.attrs.get("filter");
    if (!f) return;
    const m = f.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/);
    if (!m) return;
    const def = this.byId.get(m[1]);
    if (!def || def.tag !== "filter") return;
    const prims = def.children;
    if (prims.length === 1 && prims[0].tag === "fegaussianblur") {
      const sd = parseFloat(
        prims[0].attrs.get("stdDeviation") ||
          prims[0].attrs.get("stddeviation") ||
          "0",
      );
      if (sd > 0) rule.decls.push(`filter: blur(${num(sd)}px)`);
      return;
    }
    if (prims.length === 1 && prims[0].tag === "fedropshadow") {
      const p = prims[0];
      const dx = parseFloat(p.attrs.get("dx") || "0"),
        dy = parseFloat(p.attrs.get("dy") || "0");
      const sd = parseFloat(
        p.attrs.get("stdDeviation") || p.attrs.get("stddeviation") || "0",
      );
      const col = parseColor(p.attrs.get("flood-color") || "#000") ?? [
        0, 0, 0, 1,
      ];
      const fo = p.attrs.get("flood-opacity");
      const a = col[3] * (fo !== undefined ? parseFloat(fo) : 1);
      rule.decls.push(
        `filter: drop-shadow(${num(dx)}px ${num(dy)}px ${num(sd)}px ${colorString([col[0], col[1], col[2], a])})`,
      );
      return;
    }
    this.warnOnce(
      "SVG filter (only single feGaussianBlur / feDropShadow supported) skipped",
    );
  }

  // --- use / symbol expansion ---------------------------------------------

  private expandUse(
    el: SvgNode,
    ancestors: SvgNode[],
    inherited: Style,
    emitCTM: Mat,
    bakeM: Mat,
  ): Rule[] | null {
    const href = el.attrs.get("href");
    if (!href || href[0] !== "#") return null;
    const id = href.slice(1);
    if (this.useStack.has(id)) {
      this.warnOnce(`<use> cycle at #${id} — skipped`);
      return null;
    }
    const target = this.byId.get(id);
    if (!target) {
      this.warnOnce(`<use href="#${id}"> unresolved — skipped`);
      return null;
    }

    const style = computeStyle(el, ancestors, inherited, this.sheet);
    const ux = n(el, "x"),
      uy = n(el, "y");
    // <use> x/y is a translate; a <symbol> viewBox adds a viewport scale.
    let m: Mat = [1, 0, 0, 1, ux, uy];
    const content = target;
    if (target.tag === "symbol") {
      const vb = (target.attrs.get("viewBox") || "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        vb.length === 4 &&
        vb.every((v) => !isNaN(v)) &&
        el.attrs.has("width") &&
        el.attrs.has("height")
      ) {
        const sx = n(el, "width") / (vb[2] || 1),
          sy = n(el, "height") / (vb[3] || 1);
        m = matMul(
          m,
          matMul([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]),
        );
      }
    }

    this.useStack.add(id);
    const dec = decompose(m);
    const baking = !isIdentity(bakeM);
    let childEmit = emitCTM,
      childBake = bakeM;
    const transformDecls: string[] = [];
    if (baking) childBake = matMul(bakeM, m);
    else if (!isIdentity(m)) {
      const d = decls_transform(dec);
      if (d) transformDecls.push(d);
      childEmit = matMul(emitCTM, m);
    }

    // A <symbol>/<svg> target contributes its children; any other element is
    // cloned as a single drawable. Wrap in a group carrying the use transform.
    const sources =
      content.tag === "symbol" || content.tag === "svg"
        ? content.children
        : [content];
    const kids: Rule[] = [];
    for (const c of sources) {
      const r = this.walk(
        c,
        [...ancestors, el],
        style,
        baking ? emitCTM : childEmit,
        childBake,
      );
      if (r) kids.push(...r);
    }
    this.useStack.delete(id);
    if (kids.length === 0) return null;
    if (kids.length === 1 && transformDecls.length === 0) return kids;
    const group: Rule = {
      id: this.uniqueId(el.attrs.get("id") || `use-${id}`, "g"),
      type: "group",
      decls: [...transformDecls],
      children: kids,
    };
    return [group];
  }
}

// ---------------------------------------------------------------------------
// Small element helpers
// ---------------------------------------------------------------------------

/** Concatenate <style> element text across the tree. */
function collectStyles(root: SvgNode): string {
  let out = "";
  const walk = (el: SvgNode) => {
    if (el.tag === "style" && el.text) out += el.text + "\n";
    for (const c of el.children) walk(c);
  };
  walk(root);
  return out;
}

/** Flatten a <text>'s own text plus any <tspan> descendants into one string. */
function flattenText(el: SvgNode, onTspan: () => void): string {
  let out = el.text ?? "";
  for (const c of el.children) {
    if (c.tag === "tspan") {
      onTspan();
      out += flattenText(c, onTspan);
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function fontFamily(v: string): string {
  const first = v
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
  return /[\s]/.test(first) ? JSON.stringify(first) : first;
}

/** transform decls string from a shear-free decomposition, or '' for identity. */
function decls_transform(d: {
  tx: number;
  ty: number;
  rot: number;
  sx: number;
  sy: number;
}): string {
  const parts: string[] = [];
  if (Math.abs(d.tx) > 1e-6 || Math.abs(d.ty) > 1e-6)
    parts.push(`translate(${num(d.tx)}px, ${num(d.ty)}px)`);
  if (Math.abs(d.rot) > 1e-6) parts.push(`rotate(${num(d.rot)}deg)`);
  if (Math.abs(d.sx - 1) > 1e-6 || Math.abs(d.sy - 1) > 1e-6)
    parts.push(
      Math.abs(d.sx - d.sy) < 1e-6
        ? `scale(${num(d.sx)})`
        : `scale(${num(d.sx)}, ${num(d.sy)})`,
    );
  return parts.length ? `transform: ${parts.join(" ")}` : "";
}

// ---------------------------------------------------------------------------
// Animation IR + emitter (shared by the CSS-@keyframes path; the future SMIL
// <animate> path should build the same AnimTrack and reuse emitKeyframes()).
// ---------------------------------------------------------------------------

/** One normalized keyframe stop: offsets 0..100, Popkorn decl strings, easing. */
export interface AnimStop {
  offsets: number[];
  /** Already-Popkorn declaration strings, e.g. `opacity: 0.5`, `transform: rotate(90deg)`. */
  decls: string[];
  /** Popkorn timing-function string (per-keyframe easing), if any. */
  easing?: string;
}
export interface AnimTrack {
  name: string;
  stops: AnimStop[];
}

/** Serialize a normalized track to a Popkorn `@keyframes` block. */
export function emitKeyframes(track: AnimTrack): string {
  const lines = [`@keyframes ${track.name} {`];
  for (const s of track.stops) {
    const sel = s.offsets.map((o) => `${num(o)}%`).join(", ");
    const parts = [...s.decls];
    if (s.easing) parts.push(`animation-timing-function: ${s.easing}`);
    lines.push(`  ${sel} { ${parts.map((p) => `${p};`).join(" ")} }`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

/** Split on top-level commas (respecting parentheses) — for animation lists. */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Split on whitespace, keeping parenthesized groups (cubic-bezier(...)) intact. */
function splitSpaceTokens(s: string): string[] {
  const out: string[] = [];
  let depth = 0,
    cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (/\s/.test(c) && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** Keep only representable transform functions (translate/rotate/scale); reject
 *  skew/matrix. Values pass through verbatim (CSS transform syntax == Popkorn's). */
function mapAnimTransform(
  raw: string,
  warn: (m: string) => void,
): string | null {
  const allowed = new Set([
    "translate",
    "translatex",
    "translatey",
    "rotate",
    "scale",
    "scalex",
    "scaley",
  ]);
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  const parts: string[] = [];
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    if (!allowed.has(m[1].toLowerCase())) {
      warn(
        `animated transform '${m[1]}()' not supported — transform keyframe dropped`,
      );
      return null;
    }
    parts.push(m[0].replace(/\s+/g, ""));
  }
  return parts.length ? parts.join(" ") : null;
}

// ---------------------------------------------------------------------------
// SMIL helpers (shared by buildSmilTrack)
// ---------------------------------------------------------------------------

/** Parse a SMIL clock-value (`2s`, `500ms`, `1min`, `-0.5`, `0`) to seconds. */
function parseClock(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  const m = s.match(/^(-?\d*\.?\d+)(h|min|ms|s)?$/i);
  if (!m) return null; // clock lists, event, sync-base
  const v = parseFloat(m[1]);
  switch ((m[2] || "s").toLowerCase()) {
    case "h":
      return v * 3600;
    case "min":
      return v * 60;
    case "ms":
      return v / 1000;
    default:
      return v;
  }
}

/** Extract the ordered raw value list from values / from-to / from-by / to. */
function smilValues(a: SvgNode, warn: (m: string) => void): string[] | null {
  const values = a.attrs.get("values");
  if (values !== undefined) {
    const list = values.split(";").map((v) => v.trim());
    while (list.length && list[list.length - 1] === "") list.pop();
    if (list.length === 0 || list.some((v) => v === "")) {
      warn("SMIL values list malformed — animation dropped");
      return null;
    }
    return list;
  }
  const from = a.attrs.get("from");
  const to = a.attrs.get("to");
  const by = a.attrs.get("by");
  if (to !== undefined) return from !== undefined ? [from, to] : [to];
  if (by !== undefined) {
    if (from === undefined) {
      warn("SMIL by-animation without from not supported — dropped");
      return null;
    }
    const sum = smilAddBy(from, by);
    if (sum === null) {
      warn("SMIL by-animation on a non-numeric value not supported — dropped");
      return null;
    }
    return [from, sum];
  }
  warn("SMIL animation without values/from/to dropped");
  return null;
}

/** Componentwise `from + by` for numeric SMIL values, or null if non-numeric. */
function smilAddBy(from: string, by: string): string | null {
  const fa = from
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const ba = by
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (fa.length !== ba.length || fa.some(isNaN) || ba.some(isNaN)) return null;
  return fa.map((v, i) => v + ba[i]).join(" ");
}

/** Stop offsets (0..100) from keyTimes, or even spacing across n values. */
function smilOffsets(
  a: SvgNode,
  n: number,
  warn: (m: string) => void,
): number[] | null {
  const kt = a.attrs.get("keyTimes");
  if (kt !== undefined) {
    const list = kt
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (list.length !== n) {
      warn("SMIL keyTimes length ≠ values length — animation dropped");
      return null;
    }
    const nums = list.map(Number);
    if (nums.some((x) => isNaN(x))) {
      warn("SMIL keyTimes malformed — animation dropped");
      return null;
    }
    return nums.map((x) => x * 100);
  }
  if (n === 1) return [100];
  return Array.from({ length: n }, (_, i) => (i / (n - 1)) * 100);
}

/** Per-stop easing from calcMode (linear default / spline / discrete / paced). */
function smilEasings(
  a: SvgNode,
  n: number,
  warn: (m: string) => void,
): (string | undefined)[] {
  const mode = (a.attrs.get("calcMode") || "linear").toLowerCase();
  const out: (string | undefined)[] = new Array(n).fill(undefined);
  if (mode === "discrete") {
    for (let i = 0; i < n; i++) out[i] = "step-end";
    return out;
  }
  if (mode === "paced") {
    warn("SMIL calcMode='paced' approximated as linear");
    return out;
  }
  if (mode === "spline") {
    const ks = (a.attrs.get("keySplines") || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = 0; i < n - 1; i++) {
      const parts = (ks[i] || "").split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every((x) => !isNaN(x)))
        out[i] = `cubic-bezier(${parts.join(", ")})`;
      else {
        warn("SMIL keySplines malformed — segment defaulted to linear");
        out[i] = "linear";
      }
    }
  }
  return out;
}

/** repeatCount → Popkorn iteration-count token (`infinite`, or a number). */
function smilIterations(a: SvgNode, warn: (m: string) => void): string {
  const rc = a.attrs.get("repeatCount");
  if (rc === undefined) {
    if (a.attrs.get("repeatDur") !== undefined)
      warn("SMIL repeatDur approximated — using a single iteration");
    return "1";
  }
  const s = rc.trim();
  if (s === "indefinite") return "infinite";
  const v = parseFloat(s);
  if (isNaN(v) || v <= 0) {
    warn("SMIL repeatCount malformed — using a single iteration");
    return "1";
  }
  return num(v);
}

/** One <animateTransform> value → CSS transform syntax (+ rotate center). */
function smilTransformValue(
  type: string,
  raw: string,
  warn: (m: string) => void,
): { value: string; center?: string } | null {
  const p = raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (p.length === 0 || p.some(isNaN)) {
    warn(`SMIL animateTransform value '${raw}' malformed — dropped`);
    return null;
  }
  switch (type) {
    case "translate": {
      const tx = p[0] ?? 0,
        ty = p[1] ?? 0;
      return { value: `translate(${num(tx)}px, ${num(ty)}px)` };
    }
    case "scale": {
      const sx = p[0] ?? 1;
      const sy = p.length > 1 ? p[1] : sx;
      return { value: `scale(${num(sx)}, ${num(sy)})` };
    }
    case "rotate": {
      const out: { value: string; center?: string } = {
        value: `rotate(${num(p[0] ?? 0)}deg)`,
      };
      if (p.length >= 3) out.center = `${num(p[1])}px ${num(p[2])}px`;
      return out;
    }
    default:
      warn(`animated transform '${type}' not supported — dropped`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert SVG source to Popkorn CSS. No file I/O — safe for browser use. */
export function convertSvg(svg: string): {
  css: string;
  warnings: string[];
  blocked: string[];
} {
  const c = new Converter();
  const css = c.convert(svg);
  return { css, warnings: c.warnings, blocked: [...c.blocked] };
}
