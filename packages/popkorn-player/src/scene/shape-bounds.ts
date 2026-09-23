import type { SceneNode, TextAnchor, TextData } from "./types.js";

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
      // Alphabetic baseline, so the first line sits above y.
      return {
        x: anchorX(sd.x, width, sd.anchor),
        y: sd.y - sd.fontSize,
        width,
        height,
      };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/** Left edge of a text run of `width` anchored at `x`, shifting like ctx.textAlign. */
export function anchorX(x: number, width: number, anchor: TextAnchor): number {
  return anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
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
