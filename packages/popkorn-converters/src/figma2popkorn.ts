/**
 * Figma -> Popkorn DSL converter core.
 *
 * Pure conversion logic — no Node builtins (fs/path/process) and no Figma
 * runtime access — so this module imports cleanly from both a CLI wrapper and
 * browser code (the Figma plugin's UI iframe). It mirrors
 * `packages/popkorn-converters/src/{lottie,svg}2popkorn.ts` in spirit: a small
 * normalization layer, a warning/blocked-feature ledger, and a self-contained
 * emitter producing CSS the `@popkorn/parser` can parse.
 *
 * Input is a plain-JSON **capture bundle** (`FigmaCaptureBundle`) — a snapshot
 * of a Figma node tree plus per-node Motion keyframe tracks. The Figma plugin's
 * sandbox side reads the live document (`node.relativeTransform`,
 * `node.manualKeyframeTracks`, `node.timelines`, `figma.motion`) and flattens it
 * into this bundle; this core knows nothing about the Figma runtime, which keeps
 * it testable under bun with fixture bundles.
 *
 * Model: the document becomes the `:root` stage; each captured node becomes one
 * rule. `relativeTransform` decomposes to translate/rotate/scale (shear warns and
 * is dropped). Geometry is authored at the node's local origin so the decomposed
 * transform places it exactly (Popkorn's origin-0 T·R·S matches Figma's
 * [a c e; b d f]). Motion keyframe tracks become one `@keyframes` per animated
 * channel, joined into a comma-separated `animation:` list with per-keyframe
 * easing; springs sample into a `linear()` curve.
 */
import {
  emitColor,
  type Rule,
  sanitizeIdent,
  serializeRule,
  num as sharedNum,
  warnOnce,
} from "./shared";

export { validate } from "./shared";

const num = (x: number, dec = 3): string => sharedNum(x, dec);

// ---------------------------------------------------------------------------
// Capture-bundle types — the plain-JSON contract between the plugin and this
// core. These mirror the Figma Motion Plugin API shapes (v1 update 127), but
// flattened: absolute keyframe times in seconds, paint/track data pre-read.
// ---------------------------------------------------------------------------

export interface RGBA {
  r: number; // 0..1
  g: number;
  b: number;
  a?: number; // 0..1, default 1
}

/** A captured Figma paint (subset of the runtime Paint union). */
export interface FigmaPaint {
  type: string; // SOLID | GRADIENT_LINEAR | GRADIENT_RADIAL | GRADIENT_ANGULAR | GRADIENT_DIAMOND | IMAGE | VIDEO
  visible?: boolean;
  opacity?: number; // 0..1, paint-level alpha
  color?: RGBA; // SOLID
  gradientStops?: { position: number; color: RGBA }[];
  // Normalized (0..1 in node space) gradient handles: [start, end, width].
  gradientHandlePositions?: { x: number; y: number }[];

  // IMAGE. The plugin resolves the bitmap to a base64 data URI (or leaves it
  // unset when the bytes exceed the capture cap); imageHash dedupes repeats.
  scaleMode?: string; // FILL | FIT | CROP | TILE
  imageHash?: string;
  dataUri?: string;
  oversize?: boolean; // bytes exceeded the 4 MB cap — skipped by the plugin
}

/** A Motion keyframe value (subset of the runtime KeyframeValue union). */
export type FigmaKeyframeValue =
  | { type: "FLOAT"; value: number }
  | { type: "COLOR"; value: RGBA }
  | { type: "VECTOR"; value: { x: number; y: number } }
  | { type: "BOOL"; value: boolean }
  | { type: "TEXT_DATA"; value: string };

/** Departing-keyframe easing (subset of the runtime MotionEasing union). */
export interface FigmaCaptureEasing {
  type: string; // LINEAR | EASE_IN | EASE_OUT | EASE_IN_AND_OUT | *_BACK | CUSTOM_CUBIC_BEZIER | HOLD | CUSTOM_SPRING | GENTLE | QUICK | BOUNCY | SLOW
  bezier?: { x1: number; y1: number; x2: number; y2: number };
  bounce?: number; // normalized 0..1 (CUSTOM_SPRING)
}

export interface FigmaCaptureKeyframe {
  t: number; // timelinePosition, SECONDS
  value: FigmaKeyframeValue;
  easing?: FigmaCaptureEasing;
}

export interface FigmaCaptureTrack {
  // A KeyframePropertyFieldName (TRANSLATION_X, ROTATION, OPACITY, …) or a
  // synthetic name for indexed paint tracks: FILL_COLOR / STROKE_COLOR.
  property: string;
  baseValue?: FigmaKeyframeValue;
  keyframes: FigmaCaptureKeyframe[];
}

export interface FigmaCaptureNode {
  id: string;
  name: string;
  type: string; // FRAME | GROUP | RECTANGLE | ELLIPSE | VECTOR | STAR | POLYGON | LINE | BOOLEAN_OPERATION | TEXT | COMPONENT | INSTANCE | ...
  visible?: boolean;
  opacity?: number; // 0..1
  blendMode?: string; // PASS_THROUGH | NORMAL | MULTIPLY | ...
  isMask?: boolean;
  maskType?: string; // ALPHA | LUMINANCE | VECTOR (isMask nodes)

  // Geometry (parent-relative). Prefer relativeTransform; x/y/rotation are a
  // fallback the plugin fills when the transform is unavailable.
  relativeTransform?: number[][]; // [[a,c,e],[b,d,f]]
  x?: number;
  y?: number;
  rotation?: number; // degrees, Figma CCW-positive
  width?: number;
  height?: number;

  cornerRadius?: number; // uniform
  rectangleCornerRadii?: number[]; // [tl, tr, br, bl]

  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;

  // FRAME/COMPONENT/INSTANCE clip toggle. Groups don't paint or clip in Popkorn,
  // so a visible frame fill is re-emitted as a synthetic background rect child.
  clipsContent?: boolean;

  vectorPaths?: { windingRule?: string; data: string }[];

  // Polystar fallback. Figma POLYGON/STAR frequently omit vectorPaths (a real,
  // not-rare API quirk); pointCount/innerRadius let the converter synthesize a
  // native polygon/star from the bounding box when path data is missing.
  pointCount?: number; // POLYGON/STAR vertex count
  innerRadius?: number; // STAR inner/outer radius ratio, 0..1

  // Text
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  fontWeight?: number;
  textAlignHorizontal?: string; // LEFT | CENTER | RIGHT | JUSTIFIED
  hasMixedStyle?: boolean;

  children?: FigmaCaptureNode[];

  // Motion. Duration in seconds; tracks carry absolute-time keyframes.
  timelineDuration?: number;
  tracks?: FigmaCaptureTrack[];
}

export interface FigmaCaptureBundle {
  version?: number;
  name?: string;
  document: {
    width: number;
    height: number;
    background?: RGBA | null;
  };
  nodes: FigmaCaptureNode[];
}

// ---------------------------------------------------------------------------
// 2D affine matrices — Figma relativeTransform [[a,c,e],[b,d,f]] maps
//   (x, y) -> (a*x + c*y + e, b*x + d*y + f). Stored here as [a,b,c,d,e,f].
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/** Decompose a shear-free affine matrix into translate/rotate(deg)/scale. */
function decompose(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
) {
  let sx = Math.hypot(a, b);
  const tx = e,
    ty = f;
  if (sx === 0)
    return { tx, ty, rot: 0, sx: 0, sy: Math.hypot(c, d), shear: 0 };
  let na = a / sx,
    nb = b / sx;
  let shear = na * c + nb * d;
  let nc = c - na * shear;
  let nd = d - nb * shear;
  const sy = Math.hypot(nc, nd);
  if (sy === 0)
    return { tx, ty, rot: Math.atan2(nb, na) / DEG, sx, sy: 0, shear: 0 };
  nc /= sy;
  nd /= sy;
  shear /= sy;
  if (na * nd - nb * nc < 0) {
    na = -na;
    nb = -nb;
    sx = -sx;
    shear = -shear;
  }
  return { tx, ty, rot: Math.atan2(nb, na) / DEG, sx, sy, shear };
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

function colorCss(c: RGBA, extraAlpha = 1): string {
  const a = (c.a ?? 1) * extraAlpha;
  return emitColor(c.r * 255, c.g * 255, c.b * 255, a);
}

// ---------------------------------------------------------------------------
// Easing — Figma MotionEasing -> Popkorn timing-function string. Departing-
// keyframe convention matches Popkorn per-keyframe easing (segment to next).
// ---------------------------------------------------------------------------

// Named cubic-bezier back curves (CSS-idiomatic approximations of Figma's
// overshoot presets).
const BACK: Record<string, string> = {
  EASE_IN_BACK: "cubic-bezier(0.36, 0, 0.66, -0.56)",
  EASE_OUT_BACK: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  EASE_IN_AND_OUT_BACK: "cubic-bezier(0.68, -0.6, 0.32, 1.6)",
};

// NOTE: named spring presets read back without physical params, so their bounce
// is approximated from this table. Upgrade path: read easingFunctionSpring.bounce
// off the preset if a future API populates it, then drop the table.
const NAMED_SPRING_BOUNCE: Record<string, number> = {
  GENTLE: 0.15,
  QUICK: 0.2,
  BOUNCY: 0.6,
  SLOW: 0.1,
};

/**
 * Sample a normalized spring step-response into a `linear()` easing.
 * NOTE: fixed 20-stop resolution — enough to read as a spring, not frame-exact.
 * Upgrade path: adapt stop count to bounce (more oscillation => more stops).
 */
function springLinear(bounce: number): string {
  const b = Math.max(0, Math.min(1, bounce));
  const zeta = Math.max(0.05, 1 - b); // damping ratio: b=0 critically damped
  const w = 8; // natural frequency (normalized over the segment)
  const N = 20;
  const stops: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let s: number;
    if (zeta >= 1) {
      s = 1 - Math.exp(-w * t) * (1 + w * t);
    } else {
      const wd = w * Math.sqrt(1 - zeta * zeta);
      s =
        1 -
        Math.exp(-zeta * w * t) *
          (Math.cos(wd * t) +
            (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));
    }
    const pct = i === 0 ? "" : ` ${num((i / N) * 100, 1)}%`;
    stops.push(`${num(s, 3)}${pct}`);
  }
  return `linear(${stops.join(", ")})`;
}

/** Returns a Popkorn timing-function string, warning on approximations. */
function easingCss(
  e: FigmaCaptureEasing | undefined,
  warn: (m: string) => void,
): string {
  if (!e) return "linear";
  switch (e.type) {
    case "LINEAR":
      return "linear";
    case "EASE_IN":
      return "ease-in";
    case "EASE_OUT":
      return "ease-out";
    case "EASE_IN_AND_OUT":
      return "ease-in-out";
    case "HOLD":
      return "step-end";
    case "EASE_IN_BACK":
    case "EASE_OUT_BACK":
    case "EASE_IN_AND_OUT_BACK":
      return BACK[e.type];
    case "CUSTOM_CUBIC_BEZIER":
      if (e.bezier)
        return `cubic-bezier(${num(e.bezier.x1, 4)}, ${num(e.bezier.y1, 4)}, ${num(e.bezier.x2, 4)}, ${num(e.bezier.y2, 4)})`;
      return "ease-in-out";
    case "CUSTOM_SPRING":
      warn("spring easing sampled into a linear() approximation");
      return springLinear(e.bounce ?? 0.2);
    case "GENTLE":
    case "QUICK":
    case "BOUNCY":
    case "SLOW":
      warn("named spring easing approximated (bounce estimated, not read)");
      return springLinear(NAMED_SPRING_BOUNCE[e.type]);
    default:
      warn(`unmapped easing '${e.type}' -> linear`);
      return "linear";
  }
}

// ---------------------------------------------------------------------------
// @keyframes emission
// ---------------------------------------------------------------------------

interface KfStop {
  offset: number; // percent 0..100
  decls: string[];
  easing?: string;
}

function emitKeyframes(name: string, stops: KfStop[]): string {
  const lines = [`@keyframes ${name} {`];
  for (const s of stops) {
    const parts = [...s.decls];
    if (s.easing && s.easing !== "linear")
      parts.push(`animation-timing-function: ${s.easing}`);
    lines.push(
      `  ${num(s.offset, 3)}% { ${parts.map((p) => `${p};`).join(" ")} }`,
    );
  }
  lines.push(`}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Blend modes — Figma BlendMode -> CSS mix-blend-mode.
// ---------------------------------------------------------------------------

const BLEND: Record<string, string> = {
  MULTIPLY: "multiply",
  SCREEN: "screen",
  OVERLAY: "overlay",
  DARKEN: "darken",
  LIGHTEN: "lighten",
  COLOR_DODGE: "color-dodge",
  COLOR_BURN: "color-burn",
  HARD_LIGHT: "hard-light",
  SOFT_LIGHT: "soft-light",
  DIFFERENCE: "difference",
  EXCLUSION: "exclusion",
  HUE: "hue",
  SATURATION: "saturation",
  COLOR: "color",
  LUMINOSITY: "luminosity",
};

/**
 * SVG path data for an axis-aligned rect at (x,y) with size w×h and a uniform
 * corner radius r. Used for `clip-path: path(...)` (frame clipping + shape
 * masks). r<=0 emits square corners; r clamps to half the shorter side.
 */
function rectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r0: number,
): string {
  const r = Math.min(r0, w / 2, h / 2);
  const n = (v: number) => num(v);
  if (r <= 0)
    return `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h)} H ${n(x)} Z`;
  return (
    `M ${n(x + r)} ${n(y)} H ${n(x + w - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)} ` +
    `V ${n(y + h - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)} ` +
    `H ${n(x + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)} ` +
    `V ${n(y + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)} Z`
  );
}

// Which node types are pure containers (-> Popkorn group).
const GROUP_TYPES = new Set([
  "FRAME",
  "GROUP",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SECTION",
]);
// Which node types carry vector geometry we emit as type: path.
const VECTOR_TYPES = new Set([
  "VECTOR",
  "STAR",
  "POLYGON",
  "LINE",
  "BOOLEAN_OPERATION",
]);

export class Converter {
  warnings: string[] = [];
  blocked = new Set<string>();
  private ids = new Set<string>();
  private counter = 0;
  private keyframeBlocks: string[] = [];
  // Each emitted image node's decl list + its Figma image hash and data URI, so a
  // hash used by >1 node is hoisted to a `:root { --img-N }` var (like the Lottie
  // converter's image dedupe — a multi-MB data URI inlined once, referenced many).
  private imageUses: { decls: string[]; hash: string; uri: string }[] = [];

  warnOnce(m: string) {
    warnOnce(this.warnings, m);
  }

  private uniqueId(raw: string, tag: string): string {
    let base = sanitizeIdent(raw);
    if (!base || !/^[a-zA-Z_]/.test(base)) base = `${tag}${++this.counter}`;
    let id = base,
      k = 2;
    while (this.ids.has(id)) id = `${base}-${k++}`;
    this.ids.add(id);
    return id;
  }

  convert(source: string | FigmaCaptureBundle): string {
    const bundle: FigmaCaptureBundle =
      typeof source === "string" ? JSON.parse(source) : source;
    if (!bundle || !bundle.document || !Array.isArray(bundle.nodes))
      throw new Error("invalid Figma capture bundle: missing document/nodes");

    const top: Rule[] = [];
    for (const n of bundle.nodes) {
      const r = this.walk(n);
      if (r) top.push(r);
    }

    const w = bundle.document.width || 800;
    const h = bundle.document.height || 600;
    const out: string[] = [];
    out.push("/* Generated from Figma by @popkorn/converters */");
    out.push(`:root {`);
    out.push(`  width: ${num(w)}px;`);
    out.push(`  height: ${num(h)}px;`);
    if (bundle.document.background)
      out.push(`  background: ${colorCss(bundle.document.background)};`);
    // Hoist any repeated image data URI to a custom property (mutates the emitted
    // decls in place; must run before the rules serialize below).
    for (const v of this.dedupeImages()) out.push(v);
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

  /** Convert one captured node into a rule (or null if skipped). */
  private walk(node: FigmaCaptureNode): Rule | null {
    if (node.visible === false) return null;

    const isGroup = GROUP_TYPES.has(node.type);
    const isVector = VECTOR_TYPES.has(node.type);
    let type: string;
    if (isGroup) type = "group";
    else if (node.type === "RECTANGLE") type = "rect";
    else if (node.type === "ELLIPSE")
      type = node.width === node.height ? "circle" : "ellipse";
    else if (node.type === "TEXT") type = "text";
    else if (isVector) {
      const d = (node.vectorPaths || [])
        .map((p) => p.data)
        .join(" ")
        .trim();
      if (d) type = "path";
      else if (
        (node.type === "POLYGON" || node.type === "STAR") &&
        (node.width ?? 0) > 0 &&
        (node.height ?? 0) > 0
      ) {
        // No path data (Figma's documented POLYGON/STAR vectorPaths flakiness):
        // synthesize a native polystar from the bounding box + point count.
        type = node.type === "STAR" ? "star" : "polygon";
      } else {
        this.warnOnce(
          `node '${node.name}' (${node.type}) has no geometry — skipped`,
        );
        this.blocked.add(`vector-no-geometry:${node.type}`);
        return null;
      }
    } else {
      this.warnOnce(
        `unsupported node type '${node.type}' ('${node.name}') — skipped`,
      );
      this.blocked.add(`node-type:${node.type}`);
      return null;
    }

    // A node whose visible fill is a resolved IMAGE paint draws as an image node
    // in the same bounds box (its transform still places it).
    const imgPaint =
      type !== "group" && type !== "text" ? this.imageFill(node) : null;
    if (imgPaint) type = "image";

    const id = this.uniqueId(
      node.name || node.type.toLowerCase(),
      type[0] || "n",
    );
    // `type:` is emitted by serializeRule from rule.type; decls carry the rest.
    const decls: string[] = [];

    // --- transform (relativeTransform -> translate/rotate/scale) ------------
    const st = this.staticTransform(node);
    const t = this.transformDecl(st);
    if (t) decls.push(t);

    // --- geometry -----------------------------------------------------------
    const w = node.width ?? 0;
    const h = node.height ?? 0;
    if (type === "rect") {
      decls.push(
        `x: 0px`,
        `y: 0px`,
        `width: ${num(w)}px`,
        `height: ${num(h)}px`,
      );
      const br = this.borderRadius(node);
      if (br) decls.push(br);
    } else if (type === "circle") {
      decls.push(
        `cx: ${num(w / 2)}px`,
        `cy: ${num(h / 2)}px`,
        `r: ${num(w / 2)}px`,
      );
    } else if (type === "ellipse") {
      decls.push(
        `cx: ${num(w / 2)}px`,
        `cy: ${num(h / 2)}px`,
        `rx: ${num(w / 2)}px`,
        `ry: ${num(h / 2)}px`,
      );
    } else if (type === "polygon" || type === "star") {
      // Native polystar synthesized from bounds. Popkorn's polystar is radial
      // (uniform outer radius); Figma polygons can be stretched to a non-square
      // box, so a non-uniform box under-fills.
      // NOTE: uniform radius = min(w,h)/2 — non-square Figma polystars are
      // approximated. Upgrade path: emit an explicit vector path when the box
      // is non-square (capture fillGeometry harder in the plugin).
      const outer = Math.min(w, h) / 2;
      const sides =
        typeof node.pointCount === "number" && node.pointCount >= 3
          ? Math.round(node.pointCount)
          : type === "star"
            ? 5
            : 3;
      if (typeof node.pointCount !== "number")
        this.warnOnce(
          `node '${node.name}' (${node.type}) missing pointCount — defaulted to ${sides} sides`,
        );
      decls.push(
        `sides: ${sides}`,
        `outer-radius: ${num(outer)}px`,
        `cx: ${num(w / 2)}px`,
        `cy: ${num(h / 2)}px`,
      );
      if (type === "star") {
        const ratio =
          typeof node.innerRadius === "number" ? node.innerRadius : 0.5;
        decls.push(`inner-radius: ${num(outer * ratio)}px`);
      }
    } else if (type === "path") {
      const d = (node.vectorPaths || [])
        .map((p) => p.data)
        .join(" ")
        .trim();
      decls.push(`d: "${d.replace(/"/g, '\\"')}"`);
      const wind = node.vectorPaths?.[0]?.windingRule;
      if (wind === "EVENODD") decls.push(`fill-rule: evenodd`);
    } else if (type === "text") {
      this.textDecls(node, decls);
    } else if (type === "image") {
      this.imageDecls(node, imgPaint!, decls);
    }

    // --- paint --------------------------------------------------------------
    // Groups don't paint in Popkorn; a frame's fill is re-emitted below as a
    // synthetic background rect. Images carry their own `content`. Everything
    // else paints directly.
    if (type !== "text" && type !== "group" && type !== "image")
      this.paintDecls(node, decls);

    // --- opacity / blend ----------------------------------------------------
    if (node.opacity !== undefined && node.opacity < 0.999)
      decls.push(`opacity: ${num(node.opacity, 3)}`);
    if (node.blendMode && node.blendMode in BLEND)
      decls.push(`mix-blend-mode: ${BLEND[node.blendMode]}`);

    // --- motion -------------------------------------------------------------
    this.motionDecls(node, id, st, decls);

    // --- children -----------------------------------------------------------
    const children: Rule[] = [];
    // A frame's own fill (dropped by group semantics) becomes a background rect
    // (or image) as the first child so it paints behind the frame's content.
    if (type === "group") {
      const bg = this.frameBackground(node, id);
      if (bg) children.push(bg);
      // clipsContent: the frame's explicit box becomes a clip-path on the group.
      if (node.clipsContent) {
        const clip = this.clipRectPath(node);
        if (clip) decls.push(clip);
      }
    }
    // Masks are resolved among the siblings here (Figma masks clip the siblings
    // that follow them), possibly adding a clip-path to this group's decls.
    this.emitChildren(node, decls, children);

    return { id, type, decls, children };
  }

  /** relativeTransform (or x/y/rotation fallback) -> decomposed static TRS. */
  private staticTransform(node: FigmaCaptureNode): {
    tx: number;
    ty: number;
    rot: number;
    sx: number;
    sy: number;
  } {
    let tx = node.x ?? 0,
      ty = node.y ?? 0,
      rot = node.rotation ? -node.rotation : 0, // Figma CCW+ -> canvas CW+
      sx = 1,
      sy = 1;
    const rt = node.relativeTransform;
    if (rt && rt.length === 2 && rt[0].length === 3) {
      const d = decompose(
        rt[0][0],
        rt[1][0],
        rt[0][1],
        rt[1][1],
        rt[0][2],
        rt[1][2],
      );
      if (Math.abs(d.shear) > 1e-4) {
        this.warnOnce(
          `node '${node.name}' has skew (dropped — not representable)`,
        );
        this.blocked.add("skew");
      }
      tx = d.tx;
      ty = d.ty;
      rot = d.rot;
      sx = d.sx;
      sy = d.sy;
    }
    return { tx, ty, rot, sx, sy };
  }

  /** Decomposed static TRS -> `transform:` decl. */
  private transformDecl(st: {
    tx: number;
    ty: number;
    rot: number;
    sx: number;
    sy: number;
  }): string | null {
    const parts: string[] = [];
    if (Math.abs(st.tx) > 1e-6 || Math.abs(st.ty) > 1e-6)
      parts.push(`translate(${num(st.tx)}px, ${num(st.ty)}px)`);
    if (Math.abs(st.rot) > 1e-4) parts.push(`rotate(${num(st.rot, 4)}deg)`);
    if (Math.abs(st.sx - 1) > 1e-4 || Math.abs(st.sy - 1) > 1e-4)
      parts.push(`scale(${num(st.sx, 4)}, ${num(st.sy, 4)})`);
    return parts.length ? `transform: ${parts.join(" ")}` : null;
  }

  /**
   * A visible frame fill re-emitted as a background rect (groups don't paint).
   * Placed at the frame's local origin with its size + corner radius; returns
   * null when the frame has no visible fill.
   */
  private frameBackground(
    node: FigmaCaptureNode,
    parentId: string,
  ): Rule | null {
    const img = this.imageFill(node);
    if (img) {
      const decls: string[] = [];
      this.imageDecls(node, img, decls);
      return {
        id: this.uniqueId(`${parentId}-bg`, "bg"),
        type: "image",
        decls,
        children: [],
      };
    }
    const fill = this.paint(node.fills, node.name);
    if (fill === "none") return null;
    const decls = [
      `x: 0px`,
      `y: 0px`,
      `width: ${num(node.width ?? 0)}px`,
      `height: ${num(node.height ?? 0)}px`,
      `fill: ${fill}`,
    ];
    const br = this.borderRadius(node);
    if (br) decls.push(br);
    return {
      id: this.uniqueId(`${parentId}-bg`, "bg"),
      type: "rect",
      decls,
      children: [],
    };
  }

  // -------------------------------------------------------------------------
  // Images — an IMAGE paint becomes a `type: image` node in the same box.
  // -------------------------------------------------------------------------

  /** The topmost visible IMAGE paint with resolved bytes, or null. */
  private imageFill(node: FigmaCaptureNode): FigmaPaint | null {
    const visible = (node.fills || []).filter((p) => p.visible !== false);
    // Unresolved/oversize images fall through to paint(), which warns + blocks.
    const img = visible.find((p) => p.type === "IMAGE" && p.dataUri);
    if (!img) return null;
    if (visible.length > 1)
      this.warnOnce(
        `node '${node.name}': image fill drawn; ${visible.length - 1} other paint(s) dropped`,
      );
    return img;
  }

  /** Push `content: url(...)` + the node's bounds box for an image node. */
  private imageDecls(
    node: FigmaCaptureNode,
    paint: FigmaPaint,
    decls: string[],
  ) {
    // NOTE: Popkorn images have no object-fit; the bitmap stretches to fill the
    // box. Figma FILL (cover) / FIT (contain) both degrade to that stretch;
    // CROP/TILE aren't representable and warn. Upgrade path: an object-fit
    // property + a tiling paint on the player.
    if (paint.scaleMode === "CROP" || paint.scaleMode === "TILE")
      this.warnOnce(
        `node '${node.name}': image scaleMode ${paint.scaleMode} unsupported — stretched to the box`,
      );
    decls.push(
      `content: url('${paint.dataUri}')`,
      `x: 0px`,
      `y: 0px`,
      `width: ${num(node.width ?? 0)}px`,
      `height: ${num(node.height ?? 0)}px`,
    );
    if (paint.imageHash)
      this.imageUses.push({
        decls,
        hash: paint.imageHash,
        uri: paint.dataUri!,
      });
  }

  /**
   * Hoist any image data URI used by >1 node to a `:root` custom property,
   * rewriting each use's `content: url(...)` to `content: var(--img-N)`. Returns
   * the `:root` var declarations (single-use images stay inlined).
   */
  private dedupeImages(): string[] {
    const count = new Map<string, number>();
    for (const u of this.imageUses)
      count.set(u.hash, (count.get(u.hash) || 0) + 1);
    const vars: string[] = [];
    const varFor = new Map<string, string>();
    let n = 0;
    for (const u of this.imageUses) {
      if ((count.get(u.hash) || 0) < 2) continue;
      let name = varFor.get(u.hash);
      if (!name) {
        name = `--img-${++n}`;
        varFor.set(u.hash, name);
        vars.push(`  ${name}: url('${u.uri}');`);
      }
      const i = u.decls.findIndex((d) => d.startsWith("content:"));
      if (i >= 0) u.decls[i] = `content: var(${name})`;
    }
    return vars;
  }

  private borderRadius(node: FigmaCaptureNode): string | null {
    const rr = node.rectangleCornerRadii;
    if (rr && rr.length === 4 && rr.some((v) => v !== rr[0]))
      return `border-radius: ${rr.map((v) => `${num(v)}px`).join(" ")}`;
    const r = node.cornerRadius ?? (rr ? rr[0] : 0);
    return r > 0 ? `border-radius: ${num(r)}px` : null;
  }

  /** A node's uniform corner radius, or 0 (per-corner radii warn + fall to 0). */
  private uniformRadius(node: FigmaCaptureNode): number {
    const rr = node.rectangleCornerRadii;
    if (rr && rr.length === 4 && rr.some((v) => v !== rr[0])) {
      this.warnOnce(
        `node '${node.name}': per-corner radius not carried into its clip-path (square clip)`,
      );
      return 0;
    }
    return node.cornerRadius ?? (rr ? rr[0] : 0);
  }

  /** A clipsContent frame's box as a `clip-path: path(...)` in its local space. */
  private clipRectPath(node: FigmaCaptureNode): string | null {
    const w = node.width ?? 0,
      h = node.height ?? 0;
    if (w <= 0 || h <= 0) return null;
    return `clip-path: path('${rectPath(0, 0, w, h, this.uniformRadius(node))}')`;
  }

  // -------------------------------------------------------------------------
  // Masks — a Figma isMask node clips the siblings that FOLLOW it in the same
  // parent. The clean case (a single simple mask that is the first child, so it
  // covers every sibling) maps to a clip-path on the parent group; everything
  // else maps to Popkorn's `mask: #id <mode>` track matte per masked sibling.
  // -------------------------------------------------------------------------

  private emitChildren(
    node: FigmaCaptureNode,
    parentDecls: string[],
    out: Rule[],
  ) {
    const kids = node.children || [];
    if (kids.length === 0) return;
    if (!kids.some((k) => k.isMask)) {
      for (const c of kids) {
        const r = this.walk(c);
        if (r) out.push(r);
      }
      return;
    }

    // Clean case: one mask, first child, a simple non-luminance shape whose
    // geometry maps to a clip-path (which also clips hit-testing, and is cheaper
    // than an offscreen matte). Skips when clipsContent already set a clip-path.
    const maskCount = kids.filter((k) => k.isMask).length;
    const clipped = parentDecls.some((d) => d.startsWith("clip-path"));
    if (
      !clipped &&
      maskCount === 1 &&
      kids[0].isMask &&
      kids[0].maskType !== "LUMINANCE"
    ) {
      const clip = this.maskClipPath(kids[0]);
      if (clip) {
        parentDecls.push(clip);
        for (let i = 1; i < kids.length; i++) {
          const r = this.walk(kids[i]);
          if (r) out.push(r);
        }
        return;
      }
    }

    // General case: each mask becomes a (non-painting) matte source referenced by
    // the siblings that follow it. Handles luminance masks, non-first masks, and
    // partial coverage uniformly.
    this.warnOnce("mask mapped to per-sibling track mattes");
    let current: { id: string; mode: string } | null = null;
    for (const c of kids) {
      const r = this.walk(c);
      if (!r) continue;
      if (c.isMask) {
        current = {
          id: r.id,
          mode: c.maskType === "LUMINANCE" ? "luminance" : "alpha",
        };
      } else if (current) {
        r.decls.push(`mask: #${current.id} ${current.mode}`);
      }
      out.push(r);
    }
  }

  /** A simple mask node's geometry as a `clip-path` value, or null if unmappable. */
  private maskClipPath(mask: FigmaCaptureNode): string | null {
    const st = this.staticTransform(mask);
    // Only translate-only masks map to an absolute clip-path faithfully.
    if (
      Math.abs(st.rot) > 1e-4 ||
      Math.abs(st.sx - 1) > 1e-4 ||
      Math.abs(st.sy - 1) > 1e-4
    )
      return null;
    const tx = st.tx,
      ty = st.ty,
      w = mask.width ?? 0,
      h = mask.height ?? 0;
    if (w <= 0 || h <= 0) return null;
    if (mask.type === "ELLIPSE" && Math.abs(w - h) < 1e-4)
      return `clip-path: circle(${num(w / 2)}px at ${num(tx + w / 2)}px ${num(ty + h / 2)}px)`;
    if (mask.type === "RECTANGLE")
      return `clip-path: path('${rectPath(tx, ty, w, h, this.uniformRadius(mask))}')`;
    if (mask.type === "VECTOR" || mask.type === "BOOLEAN_OPERATION") {
      // Vector path data is in the mask's local space; only usable untranslated.
      if (Math.abs(tx) > 1e-4 || Math.abs(ty) > 1e-4) return null;
      const d = (mask.vectorPaths || [])
        .map((p) => p.data)
        .join(" ")
        .trim();
      if (d) return `clip-path: path('${d.replace(/'/g, "\\'")}')`;
    }
    return null;
  }

  private textDecls(node: FigmaCaptureNode, decls: string[]) {
    if (node.hasMixedStyle)
      this.warnOnce(
        `text '${node.name}' has mixed per-range styling — using the dominant style`,
      );
    const content = (node.characters ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    decls.push(`content: "${content}"`);
    // NOTE: Figma text box is top-left anchored; Popkorn text y is the first
    // line's alphabetic baseline. Approximate baseline as one font-size down.
    // Upgrade path: capture textAutoResize/lineHeight metrics for exact baseline.
    const fs = node.fontSize ?? 16;
    decls.push(`x: 0px`, `y: ${num(fs)}px`, `font-size: ${num(fs)}px`);
    if (node.fontName?.family)
      decls.push(`font-family: "${node.fontName.family}"`);
    if (node.fontWeight) decls.push(`font-weight: ${num(node.fontWeight, 0)}`);
    const anchor =
      node.textAlignHorizontal === "CENTER"
        ? "middle"
        : node.textAlignHorizontal === "RIGHT"
          ? "end"
          : "start";
    if (node.textAlignHorizontal === "JUSTIFIED")
      this.warnOnce("justified text mapped to start-aligned");
    decls.push(`text-anchor: ${anchor}`);
    this.paintDecls(node, decls);
  }

  /** Map the topmost visible fill and stroke into `fill`/`stroke` decls. */
  private paintDecls(node: FigmaCaptureNode, decls: string[]) {
    const fill = this.paint(node.fills, node.name);
    decls.push(`fill: ${fill}`);
    const stroke = this.paint(node.strokes, node.name);
    if (stroke !== "none") {
      decls.push(`stroke: ${stroke}`);
      if (node.strokeWeight)
        decls.push(`stroke-width: ${num(node.strokeWeight)}`);
    }
  }

  /** Reduce a paint stack to one Popkorn paint value (topmost wins). */
  private paint(paints: FigmaPaint[] | undefined, name: string): string {
    const visible = (paints || []).filter((p) => p.visible !== false);
    if (visible.length === 0) return "none";
    if (visible.length > 1)
      this.warnOnce(
        `node '${name}' has ${visible.length} paints — using the topmost`,
      );
    const p = visible[visible.length - 1]; // last painted = on top
    if (p.type === "SOLID" && p.color) return colorCss(p.color, p.opacity ?? 1);
    if (p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL")
      return this.gradient(p, name);
    if (p.type === "GRADIENT_ANGULAR" || p.type === "GRADIENT_DIAMOND") {
      this.warnOnce(`node '${name}': ${p.type} unsupported — using first stop`);
      this.blocked.add(p.type);
      const s = p.gradientStops?.[0];
      return s ? colorCss(s.color, p.opacity ?? 1) : "none";
    }
    if (p.type === "IMAGE") {
      // A resolved image is handled upstream (imageFill); reaching here means the
      // bytes were oversize or unresolved by the plugin.
      this.warnOnce(
        p.oversize
          ? `node '${name}': image fill exceeds the 4 MB capture cap — dropped`
          : `node '${name}': image fill has no captured bytes — dropped`,
      );
      this.blocked.add("IMAGE");
      return "none";
    }
    if (p.type === "VIDEO") {
      this.warnOnce(`node '${name}': ${p.type} fill unsupported — dropped`);
      this.blocked.add(p.type);
      return "none";
    }
    this.warnOnce(`node '${name}': paint '${p.type}' unsupported — dropped`);
    return "none";
  }

  /**
   * Emit a Popkorn gradient. Handles are normalized 0..1 in node space; scale
   * by width/height into local px. Handles: [0]=start, [1]=end, [2]=width.
   */
  private gradient(p: FigmaPaint, name: string): string {
    const stops = (p.gradientStops || [])
      .map(
        (s) =>
          `${colorCss(s.color, p.opacity ?? 1)} ${num(s.position * 100, 1)}%`,
      )
      .join(", ");
    if (!stops) return "none";
    // NOTE: gradient handle px need the node's local box; the plugin bakes
    // width/height into the handles so they arrive pre-scaled to local px.
    const hs = p.gradientHandlePositions || [];
    if (p.type === "GRADIENT_LINEAR" && hs.length >= 2) {
      return `linear-gradient(from ${num(hs[0].x)}px ${num(hs[0].y)}px to ${num(hs[1].x)}px ${num(hs[1].y)}px, ${stops})`;
    }
    if (p.type === "GRADIENT_RADIAL" && hs.length >= 2) {
      const cx = hs[0].x,
        cy = hs[0].y;
      const r = Math.hypot(hs[1].x - cx, hs[1].y - cy);
      return `radial-gradient(circle ${num(r)}px at ${num(cx)}px ${num(cy)}px, ${stops})`;
    }
    // No handles captured: fall back to the angle/bbox-centered default form.
    this.warnOnce(
      `node '${name}': gradient without handles — using default geometry`,
    );
    return p.type === "GRADIENT_RADIAL"
      ? `radial-gradient(${stops})`
      : `linear-gradient(${stops})`;
  }

  // -------------------------------------------------------------------------
  // Motion — keyframe tracks -> one @keyframes per channel + `animation:` list.
  // -------------------------------------------------------------------------

  private motionDecls(
    node: FigmaCaptureNode,
    id: string,
    st: { tx: number; ty: number; rot: number; sx: number; sy: number },
    decls: string[],
  ) {
    const tracks = (node.tracks || []).filter((t) => t.keyframes.length > 0);
    if (tracks.length === 0) return;
    let dur = node.timelineDuration ?? 0;
    if (dur <= 0)
      for (const t of tracks)
        for (const k of t.keyframes) dur = Math.max(dur, k.t);
    if (dur <= 0) return;

    // Figma rotates/scales around the node's visual center; Popkorn's default
    // origin is the local (0,0) corner. Re-pivot when those channels animate.
    const pivots = tracks.some((t) =>
      /^(ROTATION|SCALE_X|SCALE_Y|SCALE_XY)$/.test(t.property),
    );
    if (pivots) {
      // NOTE: a node with BOTH a baked static rotation/scale AND an animated
      // one can't share a single origin faithfully (static decomposes around
      // the corner, animated around center). Rare in Motion files; the static
      // part re-pivots here.
      if (
        Math.abs(st.rot) > 1e-4 ||
        Math.abs(st.sx - 1) > 1e-4 ||
        Math.abs(st.sy - 1) > 1e-4
      )
        this.warnOnce(
          `node '${node.name}': static rotate/scale + animated rotate/scale share one origin (approximated)`,
        );
      decls.push(`transform-origin: center`);
    }

    const anims: string[] = [];
    for (const track of tracks) {
      const emitted = this.emitTrack(id, track, dur, st);
      if (emitted) anims.push(emitted);
    }
    if (anims.length) {
      decls.push(`animation: ${anims.join(", ")}`);
      decls.push(`animation-fill-mode: both`);
    }
  }

  /** One track -> a top-level @keyframes block; returns its `animation:` entry. */
  private emitTrack(
    id: string,
    track: FigmaCaptureTrack,
    dur: number,
    st: { tx: number; ty: number; rot: number; sx: number; sy: number },
  ): string | null {
    const declFor = this.channelDecl(track.property, st);
    if (!declFor) {
      this.warnOnce(
        `animated property '${track.property}' unsupported — track dropped`,
      );
      this.blocked.add(`anim-property:${track.property}`);
      return null;
    }

    const stops: KfStop[] = [];
    // Prepend the base value at 0% when the first keyframe starts later, so the
    // pre-animation pose is faithful (Popkorn fill-mode both then holds it).
    const first = track.keyframes[0];
    if (first.t > 1e-6 && track.baseValue) {
      const d = declFor(track.baseValue);
      if (d) stops.push({ offset: 0, decls: d });
    }
    // Figma easing on keyframe K animates FROM the previous keyframe TO K, so it
    // belongs on the PRECEDING Popkorn keyframe (which eases toward the next).
    // K[0]'s easing is meaningless (no previous) and dropped; the last stop has
    // no outgoing segment. This is the opposite shift from Lottie.
    for (let i = 0; i < track.keyframes.length; i++) {
      const k = track.keyframes[i];
      const d = declFor(k.value);
      if (!d) continue;
      const nextEasing = track.keyframes[i + 1]?.easing;
      stops.push({
        offset: Math.max(0, Math.min(100, (k.t / dur) * 100)),
        decls: d,
        easing: nextEasing
          ? easingCss(nextEasing, (m) => this.warnOnce(m))
          : undefined,
      });
    }
    if (stops.length === 0) return null;

    const name = this.uniqueId(`${id}-${track.property.toLowerCase()}`, "kf");
    this.keyframeBlocks.push(emitKeyframes(name, stops));
    return `${name} ${num(dur, 3)}s linear 1`;
  }

  /**
   * Map a captured track property to a function producing the per-keyframe
   * declaration(s). Returns null for unmappable properties.
   *
   * TRANSLATION/ROTATION/SCALE use `transform: <fn>` so they decompose to the
   * matching channel and merge with the node's base transform rather than
   * replacing it. Figma tracks are COMPOSED with the node's resting transform,
   * not absolute: translation is added (neutral 0), rotation added in CCW degrees
   * (neutral 0), scale multiplied (neutral 1). Since animating a channel replaces
   * that channel's base value outright, the static transform is baked into every
   * emitted keyframe value here.
   */
  private channelDecl(
    property: string,
    st: { tx: number; ty: number; rot: number; sx: number; sy: number },
  ): ((v: FigmaKeyframeValue) => string[] | null) | null {
    const f = (v: FigmaKeyframeValue) => (v.type === "FLOAT" ? v.value : null);
    switch (property) {
      case "TRANSLATION_X":
        return (v) =>
          f(v) === null
            ? null
            : [`transform: translateX(${num(st.tx + f(v)!)}px)`];
      case "TRANSLATION_Y":
        return (v) =>
          f(v) === null
            ? null
            : [`transform: translateY(${num(st.ty + f(v)!)}px)`];
      case "TRANSLATION_XY":
        return (v) =>
          v.type === "VECTOR"
            ? [
                `transform: translate(${num(st.tx + v.value.x)}px, ${num(st.ty + v.value.y)}px)`,
              ]
            : null;
      case "ROTATION":
        // Figma additive CCW degrees -> canvas CW; composed onto static rotation.
        return (v) =>
          f(v) === null
            ? null
            : [`transform: rotate(${num(st.rot - f(v)!, 4)}deg)`];
      case "SCALE_X":
        return (v) =>
          f(v) === null
            ? null
            : [`transform: scaleX(${num(st.sx * f(v)!, 4)})`];
      case "SCALE_Y":
        return (v) =>
          f(v) === null
            ? null
            : [`transform: scaleY(${num(st.sy * f(v)!, 4)})`];
      case "SCALE_XY":
        return (v) =>
          v.type === "VECTOR"
            ? [
                `transform: scale(${num(st.sx * v.value.x, 4)}, ${num(st.sy * v.value.y, 4)})`,
              ]
            : null;
      case "OPACITY":
        return (v) => (f(v) === null ? null : [`opacity: ${num(f(v)!, 3)}`]);
      case "STROKE_WEIGHT":
        return (v) => (f(v) === null ? null : [`stroke-width: ${num(f(v)!)}`]);
      case "WIDTH":
        return (v) => (f(v) === null ? null : [`width: ${num(f(v)!)}px`]);
      case "HEIGHT":
        return (v) => (f(v) === null ? null : [`height: ${num(f(v)!)}px`]);
      case "CORNER_RADIUS":
        return (v) =>
          f(v) === null ? null : [`rx: ${num(f(v)!)}px`, `ry: ${num(f(v)!)}px`];
      // Per-corner radii are ABSOLUTE (replace, not composed) — emit the value
      // straight into the matching border-radius longhand. Easing is already
      // shifted back one keyframe by emitTrack (Figma eases FROM previous TO here).
      case "RECTANGLE_TOP_LEFT_CORNER_RADIUS":
        return (v) =>
          f(v) === null ? null : [`border-top-left-radius: ${num(f(v)!)}px`];
      case "RECTANGLE_TOP_RIGHT_CORNER_RADIUS":
        return (v) =>
          f(v) === null ? null : [`border-top-right-radius: ${num(f(v)!)}px`];
      case "RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS":
        return (v) =>
          f(v) === null
            ? null
            : [`border-bottom-right-radius: ${num(f(v)!)}px`];
      case "RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS":
        return (v) =>
          f(v) === null ? null : [`border-bottom-left-radius: ${num(f(v)!)}px`];
      case "PATH_TRIM_START":
        return (v) => (f(v) === null ? null : [`trim-start: ${num(f(v)!, 4)}`]);
      case "PATH_TRIM_END":
        return (v) => (f(v) === null ? null : [`trim-end: ${num(f(v)!, 4)}`]);
      case "FILL_COLOR":
        return (v) =>
          v.type === "COLOR" ? [`fill: ${colorCss(v.value)}`] : null;
      case "STROKE_COLOR":
        return (v) =>
          v.type === "COLOR" ? [`stroke: ${colorCss(v.value)}`] : null;
      default:
        return null;
    }
  }
}

export function convertFigma(source: string | FigmaCaptureBundle): {
  css: string;
  warnings: string[];
  blocked: string[];
} {
  const c = new Converter();
  const css = c.convert(source);
  return { css, warnings: c.warnings, blocked: [...c.blocked] };
}
