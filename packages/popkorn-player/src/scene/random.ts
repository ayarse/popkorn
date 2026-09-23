// random() rolls once at build time; seed = source hash + call-site key (+ node id for per-element).

import type {
  CalcExpr,
  LengthValue,
  RandomValue,
  Value,
} from "@popkorn/parser";
import { getNumericValue, isLengthValue } from "@popkorn/parser";

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32, single-shot: pure function of seed to [0, 1).
function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

interface RandomContext {
  documentSeed: number;
  nodeId: string;
  property: string;
}

/** "" for a plain number. */
function unitOf(v: Value): string {
  return isLengthValue(v) ? v.unit : "";
}

function sig(v: Value): string {
  return `${getNumericValue(v)}${unitOf(v)}`;
}

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
    // `by <step>`: uniform over {min, min+step, ...} <= max; the clamp keeps t->1 in range.
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

/** Returns the same object when nothing was frozen. */
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
