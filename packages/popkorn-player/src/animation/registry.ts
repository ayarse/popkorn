import { parseColor } from "../renderer/color.js";
import {
  isOklabSpelling,
  mixOklab,
  oklabToString,
  rgbaToOklab,
} from "../renderer/oklab.js";
import type {
  GradientData,
  PathCommand,
  RadialGradientData,
} from "../renderer/types.js";
import { isGradientData } from "../renderer/types.js";
import { lerp } from "../scene/matrix.js";
import type {
  FilterOp,
  ImageViewBox,
  NodeBase,
  SceneNode,
} from "../scene/types.js";

// Property registry: the only path to animatability; keyframes and bindings both dispatch through it.
// gradient/path kinds are hints; interpolateProp dispatches object values by type.
type PropKind = "number" | "color" | "gradient" | "path";

export type PropValue =
  | number
  | string
  | GradientData
  | PathCommand[]
  | FilterOp[]
  | ImageViewBox;

export interface PropHandler {
  kind: PropKind;
  // Endpoint when a keyframe omits this property.
  readBase(base: NodeBase): PropValue | null;
  apply(node: SceneNode, value: PropValue): void;
  // Live value for add/accumulate composition; numeric handlers only.
  readLive?(node: SceneNode): number;
}

// --- transform components ---
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

// --- shapeData numbers; stray keys on shapes that don't declare them are inert ---
function shapeNumber(
  key: string,
  fallback: number,
  markDirty: (node: SceneNode) => void,
): PropHandler {
  const read = (sd: object): number =>
    ((sd as Record<string, unknown>)[key] as number) ?? fallback;
  return {
    kind: "number",
    readBase: (base) => read(base.shapeData),
    readLive: (node) => read(node.shapeData),
    apply: (node, value) => {
      const sd = node.shapeData as unknown as Record<string, unknown>;
      if (key in sd) {
        sd[key] = value;
        markDirty(node);
      }
    },
  };
}

// Stale: outline length (trim paths) and synthesized polystar path.
const geometryDirty = (node: SceneNode): void => {
  node.outlineLengthDirty = true;
  node.polystarDirty = true;
};
const textDirty = (node: SceneNode): void => {
  node.textBoundsDirty = true;
};
const geometryNumber = (key: string) => shapeNumber(key, 0, geometryDirty);
const textNumber = (key: string) => shapeNumber(key, 0, textDirty);

// --- per-corner rect radii (0=tl,1=tr,2=br,3=bl); seeds from uniform rx ---
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
      const rect = node.shapeData;
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

// --- plain numeric node fields ---
function nodeNumber(
  key:
    | "opacity"
    | "strokeWidth"
    | "strokeDashOffset"
    | "offsetDistance"
    | "trimStart"
    | "trimEnd"
    | "trimOffset"
    | "timeRemapValue",
): PropHandler {
  return {
    kind: "number",
    readBase: (base) => base[key],
    readLive: (node) => node[key] ?? 0,
    apply: (node, value) => {
      node[key] = value as number;
    },
  };
}

export const PROPERTY_REGISTRY: Record<string, PropHandler> = {
  translateX: transformNumber("translateX"),
  translateY: transformNumber("translateY"),
  rotate: transformNumber("rotate"),
  scaleX: transformNumber("scaleX"),
  scaleY: transformNumber("scaleY"),
  skewX: transformNumber("skewX"),
  skewY: transformNumber("skewY"),

  // display: 0 removes node + subtree from render and hit-testing.
  // NOTE: threshold, not discrete step; only an exact 0 hides. A discrete registry kind is the upgrade.
  display: {
    kind: "number",
    readBase: (base) => (base.displayNone ? 0 : 1),
    readLive: (node) => (node.displayNone ? 0 : 1),
    apply: (node, value) => {
      node.displayNone = (value as number) === 0;
    },
  },

  // z-index: CSS rounds interpolated <integer>; static scenes keep the no-resort fast path.
  "z-index": {
    kind: "number",
    readBase: (base) => base.zIndex,
    readLive: (node) => node.zIndex,
    apply: (node, value) => {
      node.zIndex = Math.round(value as number);
    },
  },

  opacity: nodeNumber("opacity"),

  // A fill endpoint is a color string or GradientData; apply routes by type.
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
  "stroke-width": nodeNumber("strokeWidth"),

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

  // path morphing: pairwise when command sequences match; invalidates geometry caches.
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

  // clip-path: only path() morphs; read live each frame, so no dirty flag.
  "clip-path": {
    kind: "path",
    readBase: (base) =>
      base.clipPath?.type === "path" ? base.clipPath.commands : null,
    apply: (node, value) => {
      if (node.clipPath?.type !== "path" || !Array.isArray(value)) return;
      node.clipPath.commands = value as PathCommand[];
    },
  },

  // object-view-box: lerped component-wise (steps() pages sprite sheets); null draws the whole bitmap.
  "object-view-box": {
    kind: "path",
    readBase: (base) =>
      base.shapeData.type === "image" ? base.shapeData.viewBox : null,
    apply: (node, value) => {
      if (node.shapeData.type === "image") {
        node.shapeData.viewBox = (value as ImageViewBox | null) ?? null;
      }
    },
  },

  // sides is static, so not registered.
  "outer-radius": geometryNumber("outerRadius"),
  "inner-radius": geometryNumber("innerRadius"),
  rotation: geometryNumber("rotation"),

  "stroke-dashoffset": nodeNumber("strokeDashOffset"),

  // Trim window: 0..1 of the outline.
  "trim-start": nodeNumber("trimStart"),
  "trim-end": nodeNumber("trimEnd"),
  "trim-offset": nodeNumber("trimOffset"),

  // time-remap (ms): read after the state merge to drive the subtree's local time; no dirty flag.
  "time-remap": nodeNumber("timeRemapValue"),

  // offset-distance: 0..1 of arc length.
  "offset-distance": nodeNumber("offsetDistance"),

  // filter: ops lerp when function sequences match, else the departing list holds.
  filter: {
    kind: "path",
    readBase: (base) => base.filter,
    apply: (node, value) => {
      node.filter = value as FilterOp[];
    },
  },

  // box-shadow: a drop-shadow FilterOp list, morphed like `filter`.
  "box-shadow": {
    kind: "path",
    readBase: (base) => base.boxShadow,
    apply: (node, value) => {
      node.boxShadow = value as FilterOp[];
    },
  },

  // Text fields invalidate text metrics; inert on non-text nodes.
  "font-size": shapeNumber("fontSize", 16, textDirty),
  "letter-spacing": textNumber("letterSpacing"),
  "line-height": textNumber("lineHeight"),
};

export function getPropHandler(property: string): PropHandler | undefined {
  return PROPERTY_REGISTRY[property];
}

// Incompatible object endpoints step to the departing value rather than crash.
export function interpolateProp(
  handler: PropHandler,
  from: PropValue | null,
  to: PropValue | null,
  t: number,
): PropValue | null {
  // Image crop: half-present pair steps to the defined rect.
  if (isViewBox(from) || isViewBox(to)) {
    if (isViewBox(from) && isViewBox(to)) {
      return {
        x: lerp(from.x, to.x, t),
        y: lerp(from.y, to.y, t),
        width: lerp(from.width, to.width, t),
        height: lerp(from.height, to.height, t),
      };
    }
    return (from ?? to) as PropValue;
  }

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

  // Filters before paths: both are arrays.
  if (isFilterList(from) || isFilterList(to)) {
    if (isFilterList(from) && isFilterList(to) && filtersCompatible(from, to)) {
      return interpolateFilter(from, to, t);
    }
    return from ?? to;
  }

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

// Neither `stops` (gradient), `type` (filter), nor an array (path).
function isViewBox(v: PropValue | null): v is ImageViewBox {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    !("stops" in v) &&
    !("type" in v) &&
    typeof (v as ImageViewBox).width === "number"
  );
}

// --- filters ---

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

// Filter names are words, path commands single letters.
export function isFilterList(v: PropValue | null): v is FilterOp[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof (v[0] as { type?: unknown }).type === "string" &&
    FILTER_TYPES.has((v[0] as { type: string }).type)
  );
}

// Filters and paths morph only when their type sequences match index-for-index.
export function sameTypeSequence(
  a: readonly { type: string }[],
  b: readonly { type: string }[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].type !== b[i].type) return false;
  return true;
}
export const filtersCompatible = sameTypeSequence;
export const pathsCompatible = sameTypeSequence;

// Returns a fresh list; base snapshots stay immutable.
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
      const out: Extract<FilterOp, { type: "drop-shadow" }> = {
        type: "drop-shadow",
        dx: lerp(fa.dx, fb.dx, t),
        dy: lerp(fa.dy, fb.dy, t),
        blur: lerp(fa.blur, fb.blur, t),
        color: interpolateColor(fa.color, fb.color, t),
      };
      // spread lerps; inset is discrete (holds the departing state).
      if (fa.spread !== undefined || fb.spread !== undefined)
        out.spread = lerp(fa.spread ?? 0, fb.spread ?? 0, t);
      if (fa.inset !== undefined || fb.inset !== undefined)
        out.inset = fa.inset;
      return out;
    }
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

// --- gradients ---

// Same type and stop count so stops pair index-for-index.
export function gradientsCompatible(a: GradientData, b: GradientData): boolean {
  if (a.type !== b.type || a.stops.length !== b.stops.length) return false;
  // repeating is a discrete paint mode: mismatch replaces.
  if (!!a.repeating !== !!b.repeating) return false;
  // So is the interpolation space.
  if (
    a.interpolate?.space !== b.interpolate?.space ||
    a.interpolate?.hue !== b.interpolate?.hue
  )
    return false;
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

// Returns a fresh GradientData; never mutates.
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

// --- paths ---

// Arc flags step to the departing value.
// NOTE: allocates per call; path morph isn't a many-instance hot path.
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

// CSS Color 4: legacy sRGB pairs lerp in sRGB, anything with an oklab() endpoint in Oklab.
export function interpolateColor(
  color1: string,
  color2: string,
  t: number,
): string {
  if (isOklabSpelling(color1) || isOklabSpelling(color2)) {
    const mixed = mixOklab(
      rgbaToOklab(parseColor(color1)),
      rgbaToOklab(parseColor(color2)),
      t,
    );
    return oklabToString(mixed);
  }

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
