import type { Matrix3x3 } from "./matrix.js";
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  skewMatrix,
  translationMatrix,
} from "./matrix.js";
import { samplePathAt } from "./path-parser.js";
import type { SceneNode, TextData, TransformOriginValue } from "./types.js";

/** Uniform scale of an affine matrix: √|det|, the geometric mean of its axis scales. */
export function matrixScale(m: Matrix3x3): number {
  const det = m[0] * m[4] - m[1] * m[3];
  return Math.sqrt(Math.abs(det));
}

// Local-space AABB; groups and paths have no intrinsic box, so % origins resolve to 0.
export function getShapeBounds(node: SceneNode): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const sd = node.shapeData;
  switch (sd.type) {
    case "rect":
      return { x: sd.x, y: sd.y, width: sd.width, height: sd.height };
    case "circle":
      return {
        x: sd.cx - sd.r,
        y: sd.cy - sd.r,
        width: sd.r * 2,
        height: sd.r * 2,
      };
    case "ellipse":
      return {
        x: sd.cx - sd.rx,
        y: sd.cy - sd.ry,
        width: sd.rx * 2,
        height: sd.ry * 2,
      };
    case "star":
    case "polygon": {
      // Outer-radius square around the center; exact enough for origins/clip.
      const r = sd.outerRadius;
      return { x: sd.cx - r, y: sd.cy - r, width: r * 2, height: r * 2 };
    }
    case "image":
      return { x: sd.x, y: sd.y, width: sd.width, height: sd.height };
    case "text": {
      const { width, height } = measureText(node, sd);
      // Anchor shifts like ctx.textAlign; alphabetic baseline, so the first line sits above y.
      const x =
        sd.anchor === "middle"
          ? sd.x - width / 2
          : sd.anchor === "end"
            ? sd.x - width
            : sd.x;
      return { x, y: sd.y - sd.fontSize, width, height };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

// Platform text measurer (e.g. Skia on RN); null defers to the next stage.
export type TextMeasurer = (
  text: string,
  style: { fontSize: number; fontFamily: string; fontWeight: number | string },
) => { width: number; height: number } | null;

let textMeasurer: TextMeasurer | null = null;
// Bumped on measurer swap so text measured under an earlier measurer re-measures on next read.
let measurerGeneration = 0;
const measuredGeneration = new WeakMap<SceneNode, number>();
const measuredText = new WeakMap<SceneNode, string>();

export function setTextMeasurer(fn: TextMeasurer | null): void {
  textMeasurer = fn;
  measurerGeneration++;
}

// Cached on the node; platform measurer -> scratch 2D context -> headless em-estimate.
export function measureText(
  node: SceneNode,
  t: TextData,
): { width: number; height: number } {
  // String inputs aren't registry-animated, so no dirty flag covers them; key on them.
  const key = `${t.content}\0${t.fontFamily}\0${t.fontWeight}`;
  if (
    node.cachedTextBounds &&
    !node.textBoundsDirty &&
    measuredGeneration.get(node) === measurerGeneration &&
    measuredText.get(node) === key
  )
    return node.cachedTextBounds;

  // Multi-line: widest line, heights stacked by line-height (auto = 1.2em).
  const lines = t.content.split("\n");
  const lh = t.lineHeight > 0 ? t.lineHeight : t.fontSize * 1.2;
  const ls = t.letterSpacing || 0;

  const lineWidth = (line: string): number => {
    let w: number | null = null;
    if (textMeasurer) {
      const m = textMeasurer(line, {
        fontSize: t.fontSize,
        fontFamily: t.fontFamily,
        fontWeight: t.fontWeight,
      });
      if (m) w = m.width;
    }
    if (w === null) {
      const ctx = getScratchContext();
      if (ctx) {
        ctx.font = `${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
        w = ctx.measureText(line).width;
      } else {
        // NOTE: headless (no canvas) — estimate so tests/bun stay DOM-free.
        w = 0.6 * t.fontSize * line.length;
      }
    }
    return w + Math.max(0, line.length - 1) * ls;
  };

  const width = Math.max(0, ...lines.map(lineWidth));
  const height =
    lines.length > 1 ? (lines.length - 1) * lh + t.fontSize : t.fontSize;
  const bounds = { width, height };

  node.cachedTextBounds = bounds;
  node.textBoundsDirty = false;
  measuredGeneration.set(node, measurerGeneration);
  measuredText.set(node, key);
  return bounds;
}

let scratchContext: CanvasRenderingContext2D | null | undefined;

// Lazily-created scratch 2D context for text measurement; null when headless.
function getScratchContext(): CanvasRenderingContext2D | null {
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

// Order (CSS): translate -> motion-path (point, rotate) -> origin sandwich around rotate/scale/skew.
export function computeLocalMatrix(node: SceneNode): Matrix3x3 {
  const t = node.transform;
  const { x: ox, y: oy } = resolveTransformOrigin(node);
  const hasOrigin = ox !== 0 || oy !== 0;

  let matrix = translationMatrix(t.translateX, t.translateY);

  // With a path, offset-distance 0 still places the node at the path start, per CSS.
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
  if (t.skewX !== 0 || t.skewY !== 0)
    matrix = multiplyMatrices(
      matrix,
      skewMatrix((t.skewX * Math.PI) / 180, (t.skewY * Math.PI) / 180),
    );
  if (hasOrigin) matrix = multiplyMatrices(matrix, translationMatrix(-ox, -oy));

  return matrix;
}

export function computeWorldMatrix(
  node: SceneNode,
  parentWorld: Matrix3x3 = IDENTITY_MATRIX,
): Matrix3x3 {
  return multiplyMatrices(parentWorld, computeLocalMatrix(node));
}

// World matrix folded from the root, for callers without the parent's world matrix (e.g. masks).
export function computeWorldMatrixFromRoot(node: SceneNode | null): Matrix3x3 {
  if (!node) return IDENTITY_MATRIX;
  const chain: SceneNode[] = [];
  for (let n: SceneNode | null = node; n; n = n.parent) chain.push(n);
  let m = IDENTITY_MATRIX;
  for (let i = chain.length - 1; i >= 0; i--)
    m = multiplyMatrices(m, computeLocalMatrix(chain[i]));
  return m;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
