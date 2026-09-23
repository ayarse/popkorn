import type { ColorFilterFn, FilterOp, SceneNode } from "../scene/types.js";

// Inset (any outlined shape) or spread-on-rect/circle/ellipse shadows draw geometrically; others ride the filter.
export function isGeometricShadow(node: SceneNode, s: FilterOp): boolean {
  if (s.type !== "drop-shadow") return false;
  const t = node.shapeData.type;
  const hasOutline =
    t === "rect" ||
    t === "circle" ||
    t === "ellipse" ||
    t === "path" ||
    t === "star" ||
    t === "polygon";
  const inflatable = t === "rect" || t === "circle" || t === "ellipse";
  if (s.inset ?? false) return hasOutline;
  return inflatable && (s.spread ?? 0) !== 0;
}

// Authored `filter` plus non-geometric shadows. NOTE: non-geometric inset shadows are dropped.
export function effectiveFilterOps(node: SceneNode): FilterOp[] | null {
  const authored = node.filter ?? [];
  const shadows: FilterOp[] = [];
  if (node.boxShadow) {
    for (const s of node.boxShadow) {
      if (s.type !== "drop-shadow" || isGeometricShadow(node, s)) continue;
      if (s.inset) continue;
      shadows.push(s);
    }
  }
  const ops = [...authored, ...shadows];
  return ops.length > 0 ? ops : null;
}

/** Sub-half-pixel device blur is invisible, so it counts as identity. */
const MIN_DEVICE_BLUR_PX = 0.5;

/** The amount at which each single-scalar color function is a no-op. */
const COLOR_FN_IDENTITY: Record<ColorFilterFn, number> = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  opacity: 1,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  "hue-rotate": 0,
};

function isTransparentColor(color: string): boolean {
  if (color === "transparent") return true;
  const rgba = color.match(/^rgba?\(([^)]*)\)$/);
  if (rgba) {
    const parts = rgba[1].split(/[,/]/);
    return parts.length === 4 && Number(parts[3].trim()) === 0;
  }
  if (/^#[0-9a-f]{4}$/i.test(color)) return color[4] === "0";
  if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(7) === "00";
  return false;
}

// A zero-offset shadow still paints under translucent content, so only a transparent one is identity.
function isIdentityOp(op: FilterOp, scale: number): boolean {
  if (op.type === "blur") return op.radius * scale < MIN_DEVICE_BLUR_PX;
  if (op.type === "drop-shadow") return isTransparentColor(op.color);
  if (op.type === "hue-rotate") return op.amount % 360 === 0;
  return op.amount === COLOR_FN_IDENTITY[op.type];
}

/** Device-px filter string or null if all identity; adjacent blurs merge (σ = √Σσᵢ²), safe as bounds.ts pads 3σ per blur. */
export function filterToCSS(ops: FilterOp[], scale: number): string | null {
  const parts: string[] = [];
  let blurSigmaSq = 0;
  const flushBlur = (): void => {
    const sigma = Math.sqrt(blurSigmaSq);
    if (sigma >= MIN_DEVICE_BLUR_PX) parts.push(`blur(${sigma}px)`);
    blurSigmaSq = 0;
  };
  for (const op of ops) {
    if (op.type === "blur") {
      const radius = op.radius * scale;
      blurSigmaSq += radius * radius;
      continue;
    }
    flushBlur();
    if (isIdentityOp(op, scale)) continue;
    if (op.type === "drop-shadow") {
      parts.push(
        `drop-shadow(${op.dx * scale}px ${op.dy * scale}px ${op.blur * scale}px ${op.color})`,
      );
    } else if (op.type === "hue-rotate") {
      parts.push(`hue-rotate(${op.amount}deg)`);
    } else {
      parts.push(`${op.type}(${op.amount})`);
    }
  }
  flushBlur();
  return parts.length > 0 ? parts.join(" ") : null;
}
