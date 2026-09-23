// sibling-index()/sibling-count() fold to literals per node at build time (same seam as random()).
import type { CalcExpr, CalcFunction, Value } from "@popkorn/parser";

/** 1-based position among siblings and the total count. */
export interface SiblingContext {
  index: number;
  count: number;
}

// Build-time Value rewrite: `value`/`calcFn` return a replacement, or undefined to recurse.
export interface ValueRewrite {
  value?(v: Value): Value | undefined;
  calcFn?(e: CalcFunction): CalcExpr | undefined;
}

export function rewriteValue(v: Value, r: ValueRewrite): Value {
  const hit = r.value?.(v);
  if (hit) return hit;
  switch (v.type) {
    case "calc":
      return { ...v, expr: rewriteCalc(v.expr, r) };
    case "function":
      return { ...v, args: v.args.map((a) => rewriteValue(a, r)) };
    case "list":
      return { ...v, values: v.values.map((a) => rewriteValue(a, r)) };
    case "variable":
      return v.fallback ? { ...v, fallback: rewriteValue(v.fallback, r) } : v;
    default:
      return v;
  }
}

function rewriteCalc(expr: CalcExpr, r: ValueRewrite): CalcExpr {
  if (expr.type === "calc-operand")
    return { type: "calc-operand", value: rewriteValue(expr.value, r) };
  if (expr.type === "calc-function")
    return (
      r.calcFn?.(expr) ?? {
        ...expr,
        args: expr.args.map((a) => rewriteCalc(a, r)),
      }
    );
  return {
    type: "calc-binary",
    op: expr.op,
    left: rewriteCalc(expr.left, r),
    right: rewriteCalc(expr.right, r),
  };
}

// True when `value` or `calcFn` matches anywhere in the tree.
export function someValue(
  v: Value,
  value: (v: Value) => boolean,
  calcFn: (e: CalcFunction) => boolean = () => false,
): boolean {
  const calc = (e: CalcExpr): boolean =>
    e.type === "calc-operand"
      ? someValue(e.value, value, calcFn)
      : e.type === "calc-function"
        ? calcFn(e) || e.args.some(calc)
        : calc(e.left) || calc(e.right);
  if (value(v)) return true;
  switch (v.type) {
    case "calc":
      return calc(v.expr);
    case "function":
      return v.args.some((a) => someValue(a, value, calcFn));
    case "list":
      return v.values.some((a) => someValue(a, value, calcFn));
    case "variable":
      return v.fallback ? someValue(v.fallback, value, calcFn) : false;
    default:
      return false;
  }
}

const isSiblingFn = (e: CalcFunction): boolean =>
  e.name === "sibling-index" || e.name === "sibling-count";

export function valueHasSiblingFn(v: Value): boolean {
  return someValue(v, () => false, isSiblingFn);
}

export function foldSiblingFns(v: Value, ctx: SiblingContext): Value {
  return rewriteValue(v, {
    calcFn: (e) =>
      isSiblingFn(e)
        ? {
            type: "calc-operand",
            value: {
              type: "number",
              value: e.name === "sibling-index" ? ctx.index : ctx.count,
            },
          }
        : undefined,
  });
}
