import {
  childrenInPaintOrder,
  type SceneNode,
  type Transform,
} from "../scene/types.js";

/** Pure hash of a composite subtree's resolved render state (mirrors `resetNodeToBase` + paint fields) for the raster cache. */
// NOTE: re-hashes every frame; a per-node dirty bit at resolve-walk write sites would avoid it.

// Two FNV-1a lanes: one 32-bit lane collides too easily when a collision freezes a sublayer.
const A_BASIS = 2166136261;
const B_BASIS = 2654435769;
const A_PRIME = 16777619;
const B_PRIME = 40503;

const FLOAT = new Float64Array(1);
const WORDS = new Uint32Array(FLOAT.buffer);

// Guards against cyclic mask references.
const MAX_DEPTH = 256;

export class ContentHash {
  private a = A_BASIS;
  private b = B_BASIS;
  /** A poisoned hash must never be used as a cache key. */
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

  /** Arity marker so a 2-element list can't hash like a 2-field object. */
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

  toString(): string {
    return (this.a >>> 0).toString(36) + ":" + (this.b >>> 0).toString(36);
  }
}

/** Keys hash alongside values, so differently-shaped objects can't collide. */
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
      // Functions can't be compared; refuse to cache.
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

/** One node's own state, mirroring what `renderNode` reads before recursing. */
export function hashNodeState(h: ContentHash, node: SceneNode): void {
  h.flag(node.hidden);
  h.flag(node.displayNone);
  // Must mirror renderNode's early return: hashing less than the walk paints is a false hit.
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

/** Paint-order subtree hash, including each mask source (it lives elsewhere but is painted here). */
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

/** Null when it can't be hashed honestly (must not be cached). */
export function subtreeToken(node: SceneNode): string | null {
  const h = new ContentHash();
  hashSubtree(h, node);
  return h.poisoned ? null : h.toString();
}
