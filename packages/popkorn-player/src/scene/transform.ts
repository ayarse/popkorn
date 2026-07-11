import type { Matrix3x3 } from "./matrix";
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  translationMatrix,
} from "./matrix";
import { samplePathAt } from "./path-parser";
import type {
  CircleData,
  EllipseData,
  ImageData,
  PolystarData,
  RectData,
  SceneNode,
  TextData,
  TransformOriginValue,
} from "./types";

/**
 * Axis-aligned bounding box of a shape in its local coordinate space.
 * Groups and paths have no intrinsic box, so percentage origins resolve to 0.
 */
export function getShapeBounds(node: SceneNode): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (node.shapeData.type) {
    case "rect": {
      const r = node.shapeData as RectData;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    case "circle": {
      const c = node.shapeData as CircleData;
      return { x: c.cx - c.r, y: c.cy - c.r, width: c.r * 2, height: c.r * 2 };
    }
    case "ellipse": {
      const e = node.shapeData as EllipseData;
      return {
        x: e.cx - e.rx,
        y: e.cy - e.ry,
        width: e.rx * 2,
        height: e.ry * 2,
      };
    }
    case "star":
    case "polygon": {
      // Outer-radius square around the center; exact enough for origins/clip.
      const s = node.shapeData as PolystarData;
      const r = s.outerRadius;
      return { x: s.cx - r, y: s.cy - r, width: r * 2, height: r * 2 };
    }
    case "image": {
      const i = node.shapeData as ImageData;
      return { x: i.x, y: i.y, width: i.width, height: i.height };
    }
    case "text": {
      const t = node.shapeData as TextData;
      const { width, height } = measureText(node, t);
      // Anchor shifts the box like ctx.textAlign does; baseline is alphabetic,
      // so the box sits above the y baseline.
      const x =
        t.anchor === "middle"
          ? t.x - width / 2
          : t.anchor === "end"
            ? t.x - width
            : t.x;
      return { x, y: t.y - height, width, height };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/**
 * A platform text measurer. Backends whose paint engine measures real glyph
 * advances (e.g. Skia on React Native) register one so the scene layer's boxes
 * match the painted text. Returns null to defer to the next resolution stage
 * (e.g. a headless font manager that can't measure).
 */
export type TextMeasurer = (
  text: string,
  style: { fontSize: number; fontFamily: string; fontWeight: number | string },
) => { width: number; height: number } | null;

let textMeasurer: TextMeasurer | null = null;
// Bumped whenever the measurer is swapped. measureText stamps each node's cache
// with the generation it was measured under, so a measurer registered AFTER some
// text was already measured (against the estimate) invalidates those caches on
// next read instead of pinning the stale width. Kept off the node type (module
// WeakMap) so no per-node field is added.
let measurerGeneration = 0;
const measuredGeneration = new WeakMap<SceneNode, number>();

/**
 * Register (or clear, with null) the platform text measurer. Registering after
 * nodes were measured still takes effect — see measurerGeneration above.
 */
export function setTextMeasurer(fn: TextMeasurer | null): void {
  textMeasurer = fn;
  measurerGeneration++;
}

/**
 * Measure a text node's width/height, cached on the node (invalidated by the
 * registry when font-size animates, and by a measurer swap via the generation
 * stamp). Resolution order: registered platform measurer (if it returns a box) →
 * a lazily-created scratch 2D context (web; same pattern as the Path2D scratch in
 * runtime/hit-test.ts) → a headless em-estimate.
 */
export function measureText(
  node: SceneNode,
  t: TextData,
): { width: number; height: number } {
  if (
    node.cachedTextBounds &&
    !node.textBoundsDirty &&
    measuredGeneration.get(node) === measurerGeneration
  )
    return node.cachedTextBounds;

  let bounds: { width: number; height: number } | null = null;
  if (textMeasurer) {
    bounds = textMeasurer(t.content, {
      fontSize: t.fontSize,
      fontFamily: t.fontFamily,
      fontWeight: t.fontWeight,
    });
  }
  if (!bounds) {
    const ctx = getScratchContext();
    if (ctx) {
      ctx.font = `${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
      bounds = { width: ctx.measureText(t.content).width, height: t.fontSize };
    } else {
      // NOTE: headless (no canvas) — estimate so tests/bun stay DOM-free.
      bounds = {
        width: 0.6 * t.fontSize * t.content.length,
        height: t.fontSize,
      };
    }
  }

  node.cachedTextBounds = bounds;
  node.textBoundsDirty = false;
  measuredGeneration.set(node, measurerGeneration);
  return bounds;
}

let scratchContext: CanvasRenderingContext2D | null | undefined;

/**
 * Lazily-created shared scratch 2D context (null when no DOM/OffscreenCanvas is
 * available, e.g. headless tests). Used for text measurement here and Path2D
 * hit-testing in runtime/hit-test.ts.
 */
export function getScratchContext(): CanvasRenderingContext2D | null {
  if (scratchContext !== undefined) return scratchContext;
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      scratchContext = new OffscreenCanvas(1, 1).getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D;
    } else if (typeof document !== "undefined") {
      scratchContext = document.createElement("canvas").getContext("2d");
    } else {
      scratchContext = null;
    }
  } catch {
    scratchContext = null;
  }
  return scratchContext;
}

function resolveOriginValue(
  v: TransformOriginValue,
  offset: number,
  dimension: number,
): number {
  // Percentages are relative to the shape's bounding box; pixels are absolute in local space.
  return v.unit === "%" ? offset + (v.value / 100) * dimension : v.value;
}

/**
 * Resolve transform-origin to pixel values in the node's local coordinate space.
 */
export function resolveTransformOrigin(node: SceneNode): {
  x: number;
  y: number;
} {
  const origin = node.transform.transformOrigin;
  const bounds = getShapeBounds(node);
  return {
    x: resolveOriginValue(origin.x, bounds.x, bounds.width),
    y: resolveOriginValue(origin.y, bounds.y, bounds.height),
  };
}

/**
 * Compute the local transform matrix, including transform-origin and any CSS
 * Motion Path placement.
 * Order (CSS): translate -> motion-path (offset point -> offset rotate) ->
 * (move to origin -> rotate -> scale -> move back). The motion-path layer is an
 * independent placement applied after translate and before the node's own TRS.
 */
export function computeLocalMatrix(node: SceneNode): Matrix3x3 {
  const t = node.transform;
  const { x: ox, y: oy } = resolveTransformOrigin(node);
  const hasOrigin = ox !== 0 || oy !== 0;

  let matrix = translationMatrix(t.translateX, t.translateY);

  // Motion-path placement. With a path, the node is placed at the sampled point
  // even at distance 0 — per CSS, `offset-distance: 0` sits the node at the path
  // START, not at the identity offset. (Skipping distance 0 stranded a node at
  // its bare anchor whenever the offset-distance animation hadn't started yet,
  // e.g. a Lottie layer holding its first keyframe before its in-window delay.)
  if (node.offsetPath) {
    const s = samplePathAt(node.offsetPath, node.offsetDistance);
    matrix = multiplyMatrices(matrix, translationMatrix(s.x, s.y));
    const rot = node.offsetRotate.auto
      ? s.angle + (node.offsetRotate.angle * Math.PI) / 180
      : (node.offsetRotate.angle * Math.PI) / 180;
    if (rot !== 0) matrix = multiplyMatrices(matrix, rotationMatrix(rot));
  }

  if (hasOrigin) matrix = multiplyMatrices(matrix, translationMatrix(ox, oy));
  if (t.rotate !== 0)
    matrix = multiplyMatrices(
      matrix,
      rotationMatrix((t.rotate * Math.PI) / 180),
    );
  if (t.scaleX !== 1 || t.scaleY !== 1)
    matrix = multiplyMatrices(matrix, scaleMatrix(t.scaleX, t.scaleY));
  if (hasOrigin) matrix = multiplyMatrices(matrix, translationMatrix(-ox, -oy));

  return matrix;
}

/**
 * Compute world transform by multiplying parent's world transform with local transform
 */
export function computeWorldMatrix(
  node: SceneNode,
  parentWorld: Matrix3x3 = IDENTITY_MATRIX,
): Matrix3x3 {
  return multiplyMatrices(parentWorld, computeLocalMatrix(node));
}

/**
 * World matrix of a node by folding local matrices down from the root along the
 * parent chain. For callers that don't already have the parent's world matrix
 * in hand (e.g. mask compositing).
 */
export function computeWorldMatrixFromRoot(node: SceneNode | null): Matrix3x3 {
  if (!node) return IDENTITY_MATRIX;
  const chain: SceneNode[] = [];
  for (let n: SceneNode | null = node; n; n = n.parent) chain.push(n);
  let m = IDENTITY_MATRIX;
  for (let i = chain.length - 1; i >= 0; i--)
    m = multiplyMatrices(m, computeLocalMatrix(chain[i]));
  return m;
}

/** Clamp to the [0,1] range. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
