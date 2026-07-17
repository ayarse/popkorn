/**
 * CSS Values 5 random() → a FIXED random constant, rolled once at build time and
 * frozen into the node's base snapshot (invariant #4 holds trivially: the value
 * is constant, so `seek(t)` twice gives identical frames). random() is NOT a
 * live noise source — it never re-evaluates per frame.
 *
 * Seeding is fully deterministic (never wall-clock, never bare Math.random) so a
 * build is reproducible: re-parsing the IDENTICAL source yields the IDENTICAL
 * frame (demo hot-reload of an unchanged file never flickers). The seed mixes:
 *   - a DOCUMENT seed: a hash of the canonical serialization of the whole sheet,
 *     so identical source (reformatting aside) rolls identically; editing any
 *     part may reshuffle every roll (spec-consistent, same-source stability is
 *     the hard requirement);
 *   - a CALL-SITE key: the `<dashed-ident>` if given (calls sharing the same
 *     ident + range correlate), else the property name + the occurrence index of
 *     this random() within its declaration value (two calls in one value differ);
 *   - for `per-element`: the instance's node id, so each element/instance rolls
 *     independently (the particle-scatter knob). Ids — not tree position — are
 *     the stable identity in this DSL.
 */

import type {
  CalcExpr,
  LengthValue,
  RandomValue,
  Value,
} from "@popkorn/parser";
import { getNumericValue, isLengthValue } from "@popkorn/parser";

/** 32-bit FNV-1a hash of a string → an unsigned seed component. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32, single-shot: a tiny deterministic PRNG mapping one 32-bit seed to
// one value in [0, 1). No state, no clock — the roll is a pure function of seed.
function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Context a random() call is rolled against — the seed inputs beyond the call itself. */
export interface RandomContext {
  documentSeed: number;
  nodeId: string;
  property: string;
}

/** The unit a numeric operand contributes ("" for a plain number). */
function unitOf(v: Value): string {
  return isLengthValue(v) ? v.unit : "";
}

/** A stable signature of a numeric operand, for the range part of the call key. */
function sig(v: Value): string {
  return `${getNumericValue(v)}${unitOf(v)}`;
}

/** Roll a single random() to its fixed literal (length or number). */
function rollRandom(
  rv: RandomValue,
  ctx: RandomContext,
  occurrence: number,
): Value {
  const rangeSig = `${sig(rv.min)},${sig(rv.max)}${
    rv.step ? `,by ${sig(rv.step)}` : ""
  }`;
  const callKey =
    rv.ident != null
      ? `id:${rv.ident}|${rangeSig}`
      : `site:${ctx.property}|${rangeSig}|#${occurrence}`;
  const seedInput = `${callKey}${rv.perElement ? `|el:${ctx.nodeId}` : ""}`;
  const t = rand01((ctx.documentSeed ^ hashString(seedInput)) >>> 0);

  const min = getNumericValue(rv.min);
  const max = getNumericValue(rv.max);
  let out: number;
  if (rv.step) {
    // `by <step>`: quantize to the discrete set {min, min+step, …} ≤ max, drawn
    // uniformly. floor(t·(buckets+1)) can only reach `buckets` at t→1, and it's
    // clamped there, so the result never exceeds max.
    const step = getNumericValue(rv.step);
    if (step > 0 && max > min) {
      const buckets = Math.floor((max - min) / step);
      const k = Math.min(buckets, Math.floor(t * (buckets + 1)));
      out = min + k * step;
    } else {
      out = min;
    }
  } else {
    out = min + t * (max - min);
  }

  const unit = unitOf(rv.min) || unitOf(rv.max);
  return unit
    ? { type: "length", value: out, unit: unit as LengthValue["unit"] }
    : { type: "number", value: out };
}

/**
 * Replace every random() leaf in a value tree with the fixed literal it rolls to
 * for this node/declaration. Non-random values pass through unchanged (returning
 * the same object when nothing was frozen). Use {@link valueHasRandom} first to
 * skip trees with no random() at all.
 */
export function freezeRandom(value: Value, ctx: RandomContext): Value {
  return freeze(value, ctx, { n: 0 });
}

function freeze(v: Value, ctx: RandomContext, counter: { n: number }): Value {
  switch (v.type) {
    case "random":
      return rollRandom(v, ctx, counter.n++);
    case "function":
      return { ...v, args: v.args.map((a) => freeze(a, ctx, counter)) };
    case "list":
      return { ...v, values: v.values.map((a) => freeze(a, ctx, counter)) };
    case "variable":
      return v.fallback
        ? { ...v, fallback: freeze(v.fallback, ctx, counter) }
        : v;
    case "calc":
      return { ...v, expr: freezeCalc(v.expr, ctx, counter) };
    default:
      return v;
  }
}

function freezeCalc(
  expr: CalcExpr,
  ctx: RandomContext,
  counter: { n: number },
): CalcExpr {
  if (expr.type === "calc-operand")
    return { type: "calc-operand", value: freeze(expr.value, ctx, counter) };
  if (expr.type === "calc-function")
    return {
      ...expr,
      args: expr.args.map((a) => freezeCalc(a, ctx, counter)),
    };
  return {
    type: "calc-binary",
    op: expr.op,
    left: freezeCalc(expr.left, ctx, counter),
    right: freezeCalc(expr.right, ctx, counter),
  };
}

/** True when a value tree contains any random() call. */
export function valueHasRandom(v: Value): boolean {
  switch (v.type) {
    case "random":
      return true;
    case "function":
      return v.args.some(valueHasRandom);
    case "list":
      return v.values.some(valueHasRandom);
    case "variable":
      return v.fallback ? valueHasRandom(v.fallback) : false;
    case "calc":
      return calcHasRandom(v.expr);
    default:
      return false;
  }
}

function calcHasRandom(expr: CalcExpr): boolean {
  if (expr.type === "calc-operand") return valueHasRandom(expr.value);
  if (expr.type === "calc-function") return expr.args.some(calcHasRandom);
  return calcHasRandom(expr.left) || calcHasRandom(expr.right);
}
