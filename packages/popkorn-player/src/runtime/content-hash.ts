import {
  childrenInPaintOrder,
  type SceneNode,
  type Transform,
} from "../scene/types";

/**
 * Content addressing for composite subtrees.
 *
 * The raster cache (see loop.ts renderFilter/renderMask + canvas2d) must decide
 * whether a filtered/masked subtree would rasterize to the same pixels it did
 * last time. This module answers that as a pure function of the subtree's
 * RESOLVED state: it hashes exactly the live fields the render walk reads, in
 * paint order, so equal hashes mean equal draw calls (invariant 4 — the hash
 * depends on time only through the values the resolve walk produced, never on a
 * frame counter or wall clock, so seek(t) twice hashes identically).
 *
 * The field list mirrors `resetNodeToBase` — the definitive set of per-frame
 * mutable fields — plus `hidden` (set by the resolve walk) and the static paint
 * fields, which are free to include and keep the hash honest.
 *
 * NOTE: no memoization — every hashed node re-walks its own values each frame.
 * Only composite subtrees are ever hashed (the loop asks lazily), so the cost
 * tracks the filtered/masked part of the scene, not the whole scene. The upgrade
 * path is a per-node dirty bit stamped at the resolve-walk write sites, which
 * removes the re-walk at the cost of instrumenting every writer.
 */

// FNV-1a, two independent 32-bit lanes (different basis/prime) combined into one
// token — a single 32-bit lane collides too easily for something whose failure
// mode is a frozen sublayer.
const A_BASIS = 2166136261;
const B_BASIS = 2654435769;
const A_PRIME = 16777619;
const B_PRIME = 40503;

// Scratch view for hashing a float exactly (both halves of its bit pattern),
// reused so hashing allocates nothing on the hot path.
const FLOAT = new Float64Array(1);
const WORDS = new Uint32Array(FLOAT.buffer);

// A subtree deeper than this is treated as unhashable rather than risking
// unbounded recursion on a malformed (cyclic) mask reference.
const MAX_DEPTH = 256;

export class ContentHash {
  private a = A_BASIS;
  private b = B_BASIS;
  /** Set when the hash could not be computed honestly (depth bail). A poisoned
   *  hash must never be used as a cache key — the caller skips caching. */
  poisoned = false;

  num(v: number): void {
    FLOAT[0] = v;
    this.word(WORDS[0]);
    this.word(WORDS[1]);
  }

  str(v: string | null | undefined): void {
    if (v === null || v === undefined) {
      this.word(0x9e37);
      return;
    }
    this.word(v.length);
    for (let i = 0; i < v.length; i++) this.word(v.charCodeAt(i));
  }

  flag(v: boolean | null | undefined): void {
    this.word(v ? 1 : v === false ? 2 : 3);
  }

  /** Arity marker (array length, key count) — keeps a 2-element list from
   *  hashing like the 2 fields of an object. */
  len(n: number): void {
    this.word(0xa11a);
    this.word(n);
  }

  private word(w: number): void {
    this.a = Math.imul(this.a ^ (w & 0xffff), A_PRIME);
    this.a = Math.imul(this.a ^ (w >>> 16), A_PRIME);
    this.b = Math.imul(this.b ^ (w & 0xffff), B_PRIME);
    this.b = Math.imul(this.b ^ (w >>> 16), B_PRIME);
  }

  /** The accumulated token. Two lanes, base-36, so it is short enough to sit in
   *  a cache-key string. */
  toString(): string {
    return (this.a >>> 0).toString(36) + ":" + (this.b >>> 0).toString(36);
  }
}

/** Hash an arbitrary structural value (shape data, gradients, filter ops, clip
 *  geometry). Keys are hashed alongside values, so a differently-shaped object
 *  can't collide with a same-valued one. */
export function hashValue(h: ContentHash, v: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) {
    h.poisoned = true;
    return;
  }
  switch (typeof v) {
    case "number":
      h.num(v);
      return;
    case "string":
      h.str(v);
      return;
    case "boolean":
    case "undefined":
      h.flag(v);
      return;
    case "object":
      break;
    default:
      // A function-valued field (none today) can't be compared — refuse to cache
      // rather than pretend it matched.
      h.poisoned = true;
      return;
  }
  if (v === null) {
    h.flag(null);
    return;
  }
  if (Array.isArray(v)) {
    h.len(v.length);
    for (const item of v) hashValue(h, item, depth + 1);
    return;
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  h.len(keys.length);
  for (const k of keys) {
    h.str(k);
    hashValue(h, obj[k], depth + 1);
  }
}

function hashTransform(h: ContentHash, t: Transform): void {
  h.num(t.translateX);
  h.num(t.translateY);
  h.num(t.rotate);
  h.num(t.scaleX);
  h.num(t.scaleY);
  h.num(t.skewX);
  h.num(t.skewY);
  h.num(t.transformOrigin.x.value);
  h.str(t.transformOrigin.x.unit);
  h.num(t.transformOrigin.y.value);
  h.str(t.transformOrigin.y.unit);
}

/**
 * Hash one node's own renderable state (not its children). Mirrors what
 * `renderNode` reads before recursing.
 */
export function hashNodeState(h: ContentHash, node: SceneNode): void {
  h.flag(node.hidden);
  h.flag(node.displayNone);
  // Gated out of the walk entirely: nothing below contributes pixels, so
  // nothing below may contribute to the hash either (this mirrors renderNode's
  // early return exactly — hashing less than the walk paints would be a false
  // hit, hashing more is only a missed hit).
  if (node.hidden || node.displayNone) return;

  hashTransform(h, node.transform);
  h.num(node.zIndex);
  h.num(node.opacity);
  h.str(node.fill);
  h.str(node.stroke);
  h.num(node.strokeWidth);
  h.num(node.trimStart);
  h.num(node.trimEnd);
  h.num(node.trimOffset);
  h.num(node.strokeDashOffset);
  hashValue(h, node.strokeDashArray);
  h.str(node.strokeLineCap);
  h.str(node.strokeLineJoin);
  h.num(node.strokeMiterLimit);
  h.str(node.fillRule);
  h.str(node.paintOrder);
  h.str(node.mixBlendMode);
  h.num(node.offsetDistance);
  h.flag(node.offsetRotate.auto);
  h.num(node.offsetRotate.angle);
  h.flag(node.offsetPath !== null);
  hashValue(h, node.shapeData);
  hashValue(h, node.fillGradient);
  hashValue(h, node.strokeGradient);
  hashValue(h, node.clipPath);
  hashValue(h, node.filter);
  hashValue(h, node.boxShadow);
}

/**
 * Hash a whole subtree's resolved state, in paint order, following the mask
 * source a masked node composites against (the source lives elsewhere in the
 * tree but is part of what this subtree paints).
 */
export function hashSubtree(h: ContentHash, node: SceneNode, depth = 0): void {
  if (depth > MAX_DEPTH) {
    h.poisoned = true;
    return;
  }
  hashNodeState(h, node);
  if (node.hidden || node.displayNone) return;
  if (node.mask) {
    h.str(node.mask.mode);
    hashSubtree(h, node.mask.source, depth + 1);
  }
  for (const child of childrenInPaintOrder(node)) {
    hashSubtree(h, child, depth + 1);
  }
}

/** Content token for a composite subtree, or null when it can't be hashed
 *  honestly (and so must not be cached). */
export function subtreeToken(node: SceneNode): string | null {
  const h = new ContentHash();
  hashSubtree(h, node);
  return h.poisoned ? null : h.toString();
}
