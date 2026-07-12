import type {
  GradientData,
  PathCommand,
  RadialGradientData,
} from "../renderer/types";
import { isGradientData, parseColor } from "../renderer/types";
import { lerp } from "../scene/transform";
import type { FilterOp, NodeBase, RectData, SceneNode } from "../scene/types";

/**
 * Property registry.
 *
 * One table mapping an animatable property name to how it is read from a node's
 * authored base, interpolated, and written to the live node. The keyframe
 * interpolator and the binding resolver both dispatch through this table, so
 * geometry (x/y/width/height/rx/ry/cx/cy/r), stroke, stroke-width, opacity,
 * fill and the individual transform components are all animatable and bindable
 * without any hardcoded per-property branching.
 */
// 'gradient' and 'path' properties (fill/stroke, `d`) carry object values;
// interpolateProp dispatches those by value type (a fill can also be a plain
// color), so the kind is a hint — number/color drive the scalar fast path.
export type PropKind = "number" | "color" | "gradient" | "path";

// A resolved/authored value for any animatable property.
export type PropValue =
  | number
  | string
  | GradientData
  | PathCommand[]
  | FilterOp[];

export interface PropHandler {
  kind: PropKind;
  // Base value used as the endpoint when a keyframe omits this property.
  readBase(base: NodeBase): PropValue | null;
  // Write a resolved value into the node's live render fields.
  apply(node: SceneNode, value: PropValue): void;
  // Read the current LIVE value (this frame's accumulated result). Only present
  // on numeric handlers; used by animation-composition add/accumulate to add a
  // sampled value onto what earlier layers already wrote. Object-valued
  // properties (color/gradient/path) omit it and fall back to replace.
  readLive?(node: SceneNode): number;
}

// --- transform components (all plain-number lerp; rotate is direct, matching
// the existing full-turn animation behaviour) --------------------------------
function transformNumber(
  key:
    | "translateX"
    | "translateY"
    | "rotate"
    | "scaleX"
    | "scaleY"
    | "skewX"
    | "skewY",
): PropHandler {
  return {
    kind: "number",
    readBase: (base) => base.transform[key],
    readLive: (node) => node.transform[key],
    apply: (node, value) => {
      node.transform[key] = value as number;
    },
  };
}

// --- geometry (numeric fields living on shapeData) ---------------------------
function geometryNumber(key: string): PropHandler {
  return {
    kind: "number",
    readBase: (base) =>
      ((base.shapeData as unknown as Record<string, unknown>)[key] as number) ??
      0,
    readLive: (node) =>
      ((node.shapeData as unknown as Record<string, unknown>)[key] as number) ??
      0,
    apply: (node, value) => {
      // Geometry keys only exist on the shapes that declare them; the renderer
      // reads type-specific fields, so a stray assignment is inert.
      const sd = node.shapeData as unknown as Record<string, unknown>;
      if (key in sd) {
        sd[key] = value;
        // Geometry changed -> the cached outline length is stale (trim paths),
        // and a star/polygon's synthesized path must be regenerated.
        node.outlineLengthDirty = true;
        node.polystarDirty = true;
      }
    },
  };
}

// --- per-corner rect radii (border-radius longhands) -------------------------
// Each corner (0=tl,1=tr,2=br,3=bl) lives in RectData.cornerRadii; animating one
// seeds the tuple from the uniform rx and marks the outline length stale (the
// perimeter depends on the corner arcs). Falls back to rx when no per-corner
// tuple exists yet, so a rect authored with a uniform rx animates a corner up
// from that radius.
function cornerRadiusNumber(index: number): PropHandler {
  const read = (sd: {
    type?: string;
    cornerRadii?: readonly number[];
    rx?: number;
  }): number => sd.cornerRadii?.[index] ?? sd.rx ?? 0;
  return {
    kind: "number",
    readBase: (base) => read(base.shapeData as never),
    readLive: (node) => read(node.shapeData as never),
    apply: (node, value) => {
      if (node.shapeData.type !== "rect") return;
      const rect = node.shapeData as RectData;
      const seed = rect.rx || 0;
      const c: [number, number, number, number] = rect.cornerRadii
        ? [...rect.cornerRadii]
        : [seed, seed, seed, seed];
      c[index] = value as number;
      rect.cornerRadii = c;
      node.outlineLengthDirty = true;
    },
  };
}

// --- trim paths (fractions 0..1 of the outline; render clamps to range) ------
function trimNumber(key: "trimStart" | "trimEnd" | "trimOffset"): PropHandler {
  return {
    kind: "number",
    readBase: (base) => base[key],
    readLive: (node) => node[key],
    apply: (node, value) => {
      node[key] = value as number;
    },
  };
}

export const PROPERTY_REGISTRY: Record<string, PropHandler> = {
  // transform components
  translateX: transformNumber("translateX"),
  translateY: transformNumber("translateY"),
  rotate: transformNumber("rotate"),
  scaleX: transformNumber("scaleX"),
  scaleY: transformNumber("scaleY"),
  skewX: transformNumber("skewX"),
  skewY: transformNumber("skewY"),

  // opacity
  opacity: {
    kind: "number",
    readBase: (base) => base.opacity,
    readLive: (node) => node.opacity,
    apply: (node, value) => {
      node.opacity = value as number;
    },
  },

  // colors / gradients. A fill endpoint is either a color string (solid) or a
  // GradientData (animated gradient stops); apply routes by value type.
  fill: {
    kind: "color",
    readBase: (base) => base.fillGradient ?? base.fill,
    apply: (node, value) => {
      if (isGradientData(value)) node.fillGradient = value;
      else node.fill = value as string;
    },
  },
  stroke: {
    kind: "color",
    readBase: (base) => base.strokeGradient ?? base.stroke,
    apply: (node, value) => {
      if (isGradientData(value)) node.strokeGradient = value;
      else node.stroke = value as string;
    },
  },
  "stroke-width": {
    kind: "number",
    readBase: (base) => base.strokeWidth,
    readLive: (node) => node.strokeWidth,
    apply: (node, value) => {
      node.strokeWidth = value as number;
    },
  },

  // geometry
  x: geometryNumber("x"),
  y: geometryNumber("y"),
  width: geometryNumber("width"),
  height: geometryNumber("height"),
  rx: geometryNumber("rx"),
  ry: geometryNumber("ry"),
  "border-top-left-radius": cornerRadiusNumber(0),
  "border-top-right-radius": cornerRadiusNumber(1),
  "border-bottom-right-radius": cornerRadiusNumber(2),
  "border-bottom-left-radius": cornerRadiusNumber(3),
  cx: geometryNumber("cx"),
  cy: geometryNumber("cy"),
  r: geometryNumber("r"),

  // path morphing: `d` is the command list. Interpolated pairwise when the two
  // endpoints share a command sequence (see interpolatePath); applying it swaps
  // in the morphed commands and invalidates the geometry-keyed caches. Bounds
  // and hit-test read node.shapeData.commands directly, so they follow for free.
  d: {
    kind: "path",
    readBase: (base) =>
      base.shapeData.type === "path" ? base.shapeData.commands : null,
    apply: (node, value) => {
      if (node.shapeData.type !== "path" || !Array.isArray(value)) return;
      node.shapeData.commands = value as PathCommand[];
      node.outlineLengthDirty = true; // trim window keys off the outline length
    },
  },

  // clip-path morphing: reuses the path (command-list) kind exactly like `d`.
  // Only the path() clip variant is animatable — its commands morph pairwise
  // (Lottie animated masks). No cache keys off the clip region: resolveClip and
  // the renderer read node.clipPath live each frame, so no dirty flag is needed.
  "clip-path": {
    kind: "path",
    readBase: (base) =>
      base.clipPath?.type === "path" ? base.clipPath.commands : null,
    apply: (node, value) => {
      if (node.clipPath?.type !== "path" || !Array.isArray(value)) return;
      node.clipPath.commands = value as PathCommand[];
    },
  },

  // star / polygon geometry (sides is static, so not registered)
  "outer-radius": geometryNumber("outerRadius"),
  "inner-radius": geometryNumber("innerRadius"),
  rotation: geometryNumber("rotation"),

  // stroke dashing
  "stroke-dashoffset": {
    kind: "number",
    readBase: (base) => base.strokeDashOffset,
    readLive: (node) => node.strokeDashOffset,
    apply: (node, value) => {
      node.strokeDashOffset = value as number;
    },
  },

  // trim paths
  "trim-start": trimNumber("trimStart"),
  "trim-end": trimNumber("trimEnd"),
  "trim-offset": trimNumber("trimOffset"),

  // motion path: position along offset-path, 0..1 of arc length
  "offset-distance": {
    kind: "number",
    readBase: (base) => base.offsetDistance,
    readLive: (node) => node.offsetDistance,
    apply: (node, value) => {
      node.offsetDistance = value as number;
    },
  },

  // filter: the whole FilterOp list is the endpoint. interpolateProp lerps each
  // op's numerics when two endpoints share the same function sequence, else holds
  // the departing list (structural replace) — same object-endpoint contract as
  // gradients/paths, so `kind` is the object hint and readLive is omitted.
  filter: {
    kind: "path",
    readBase: (base) => base.filter,
    apply: (node, value) => {
      node.filter = value as FilterOp[];
    },
  },

  // text: font-size lives on shapeData under a different key than its property
  // name, and animating it invalidates the cached text metrics.
  "font-size": {
    kind: "number",
    readBase: (base) =>
      ((base.shapeData as unknown as Record<string, unknown>)
        .fontSize as number) ?? 16,
    readLive: (node) =>
      ((node.shapeData as unknown as Record<string, unknown>)
        .fontSize as number) ?? 16,
    apply: (node, value) => {
      const sd = node.shapeData as unknown as Record<string, unknown>;
      if ("fontSize" in sd) {
        sd.fontSize = value;
        node.textBoundsDirty = true;
      }
    },
  },
};

export function getPropHandler(property: string): PropHandler | undefined {
  return PROPERTY_REGISTRY[property];
}

/**
 * Interpolate two endpoint values for a property.
 *
 * Object-valued properties (gradients, paths) dispatch by value type before the
 * scalar/color fast path, because `fill` can be either a color or a gradient.
 * Incompatible object endpoints (different gradient shape, mismatched path
 * command sequence) step to the departing value rather than crash.
 */
export function interpolateProp(
  handler: PropHandler,
  from: PropValue | null,
  to: PropValue | null,
  t: number,
): PropValue | null {
  // Gradient endpoints.
  if (isGradientData(from) || isGradientData(to)) {
    if (
      isGradientData(from) &&
      isGradientData(to) &&
      gradientsCompatible(from, to)
    ) {
      return interpolateGradient(from, to, t);
    }
    return from ?? to; // step: hold the departing gradient
  }

  // Filter-list endpoints (checked before the generic array branch, since both
  // filters and paths are arrays). Compatible = same function sequence; else the
  // departing list holds (structural replace).
  if (isFilterList(from) || isFilterList(to)) {
    if (isFilterList(from) && isFilterList(to) && filtersCompatible(from, to)) {
      return interpolateFilter(from, to, t);
    }
    return from ?? to;
  }

  // Path (command-list) endpoints.
  if (Array.isArray(from) || Array.isArray(to)) {
    if (Array.isArray(from) && Array.isArray(to) && pathsCompatible(from, to)) {
      return interpolatePath(from, to, t);
    }
    return from ?? to; // step: hold the departing path
  }

  if (handler.kind === "color") {
    if (typeof from !== "string" || typeof to !== "string") return to ?? from;
    return interpolateColor(from, to, t);
  }
  return lerp((from as number) ?? 0, (to as number) ?? 0, t);
}

// --- filters ----------------------------------------------------------------

const FILTER_TYPES = new Set<string>([
  "blur",
  "drop-shadow",
  "brightness",
  "contrast",
  "saturate",
  "grayscale",
  "sepia",
  "invert",
  "opacity",
  "hue-rotate",
]);

// Distinguish a FilterOp[] from a PathCommand[] (both are arrays) by the first
// element's tag — filter names are words, path commands are single letters.
export function isFilterList(v: PropValue | null): v is FilterOp[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof (v[0] as { type?: unknown }).type === "string" &&
    FILTER_TYPES.has((v[0] as { type: string }).type)
  );
}

// Same length and same function at each position (so ops pair up index-for-index).
export function filtersCompatible(a: FilterOp[], b: FilterOp[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].type !== b[i].type) return false;
  return true;
}

// Per-op numeric lerp. Caller guarantees compatibility. Returns a fresh list;
// never mutates (base snapshots stay immutable).
function interpolateFilter(
  a: FilterOp[],
  b: FilterOp[],
  t: number,
): FilterOp[] {
  return a.map((fa, i) => {
    const fb = b[i];
    if (fa.type === "blur" && fb.type === "blur") {
      return { type: "blur", radius: lerp(fa.radius, fb.radius, t) };
    }
    if (fa.type === "drop-shadow" && fb.type === "drop-shadow") {
      return {
        type: "drop-shadow",
        dx: lerp(fa.dx, fb.dx, t),
        dy: lerp(fa.dy, fb.dy, t),
        blur: lerp(fa.blur, fb.blur, t),
        color: interpolateColor(fa.color, fb.color, t),
      };
    }
    // Color-adjust functions (matched types): lerp the scalar amount.
    return {
      type: fa.type,
      amount: lerp(
        (fa as { amount: number }).amount,
        (fb as { amount: number }).amount,
        t,
      ),
    } as FilterOp;
  });
}

// --- gradients --------------------------------------------------------------

// Two gradients interpolate only when they paint the same way: same type and
// same stop count (so stops pair up index-for-index).
export function gradientsCompatible(a: GradientData, b: GradientData): boolean {
  if (a.type !== b.type || a.stops.length !== b.stops.length) return false;
  // The repeating flag is a discrete paint mode, not an interpolable value — a
  // mismatch replaces rather than morphs (the registry's gradient contract).
  if (!!a.repeating !== !!b.repeating) return false;
  // Explicit geometry must be present on both (or neither) so fields pair up.
  if (a.type === "linear-gradient" && b.type === "linear-gradient") {
    return !!a.from === !!b.from && !!a.to === !!b.to;
  }
  if (a.type === "radial-gradient" && b.type === "radial-gradient") {
    return !!a.at === !!b.at && !!a.focal === !!b.focal;
  }
  if (a.type === "conic-gradient" && b.type === "conic-gradient") {
    return !!a.at === !!b.at;
  }
  return true;
}

const lerpPt = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
) => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

// Lerp each stop's offset and color (and the linear angle / explicit geometry).
// Caller guarantees compatibility. Returns a fresh GradientData; never mutates.
export function interpolateGradient(
  a: GradientData,
  b: GradientData,
  t: number,
): GradientData {
  const stops = a.stops.map((s, i) => ({
    offset: lerp(s.offset, b.stops[i].offset, t),
    color: interpolateColor(s.color, b.stops[i].color, t),
  }));
  if (a.type === "linear-gradient" && b.type === "linear-gradient") {
    return {
      type: "linear-gradient",
      angle: lerp(a.angle, b.angle, t),
      stops,
      from: a.from && b.from ? lerpPt(a.from, b.from, t) : undefined,
      to: a.to && b.to ? lerpPt(a.to, b.to, t) : undefined,
      repeating: a.repeating,
    };
  }
  if (a.type === "conic-gradient" && b.type === "conic-gradient") {
    return {
      type: "conic-gradient",
      from: lerp(a.from, b.from, t),
      stops,
      at: a.at && b.at ? lerpPt(a.at, b.at, t) : undefined,
      repeating: a.repeating,
    };
  }
  const ra = a as RadialGradientData,
    rb = b as RadialGradientData;
  return {
    type: "radial-gradient",
    stops,
    radius:
      ra.radius != null && rb.radius != null
        ? lerp(ra.radius, rb.radius, t)
        : undefined,
    at: ra.at && rb.at ? lerpPt(ra.at, rb.at, t) : undefined,
    focal: ra.focal && rb.focal ? lerpPt(ra.focal, rb.focal, t) : undefined,
    repeating: ra.repeating,
  };
}

// --- paths ------------------------------------------------------------------

// Two paths morph only when their command sequences match exactly: same length
// and same command letter at every index (so numeric args pair up).
export function pathsCompatible(a: PathCommand[], b: PathCommand[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].type !== b[i].type) return false;
  return true;
}

// Interpolate every numeric argument of each command pairwise. Boolean flags
// (arc largeArc/sweep) step to the departing value. Caller guarantees the
// sequences match. Allocates a fresh command list per call.
// NOTE: path morph isn't a many-instance hot path, so we allocate rather
// than thread a per-node scratch buffer through the registry's apply signature.
export function interpolatePath(
  a: PathCommand[],
  b: PathCommand[],
  t: number,
): PathCommand[] {
  const out: PathCommand[] = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const from = a[i] as Record<string, unknown>;
    const to = b[i] as Record<string, unknown>;
    const cmd: Record<string, unknown> = { type: from.type };
    for (const key of Object.keys(from)) {
      if (key === "type") continue;
      const fv = from[key];
      cmd[key] = typeof fv === "number" ? lerp(fv, to[key] as number, t) : fv;
    }
    out[i] = cmd as unknown as PathCommand;
  }
  return out;
}

/**
 * Interpolate between two colors.
 */
export function interpolateColor(
  color1: string,
  color2: string,
  t: number,
): string {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);

  const r = Math.round(lerp(c1.r, c2.r, t));
  const g = Math.round(lerp(c1.g, c2.g, t));
  const b = Math.round(lerp(c1.b, c2.b, t));
  const a = lerp(c1.a, c2.a, t);

  if (a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}
