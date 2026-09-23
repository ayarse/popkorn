// sibling-index()/sibling-count() fold to literals per node at build time (same seam as random()).
import type { CalcExpr, Value } from "@popkorn/parser";

/** 1-based position among siblings and the total count. */
export interface SiblingContext {
  index: number;
  count: number;
}

export function valueHasSiblingFn(v: Value): boolean {
  switch (v.type) {
    case "calc":
      return calcHasSiblingFn(v.expr);
    case "function":
      return v.args.some(valueHasSiblingFn);
    case "list":
      return v.values.some(valueHasSiblingFn);
    case "variable":
      return v.fallback ? valueHasSiblingFn(v.fallback) : false;
    default:
      return false;
  }
}

function calcHasSiblingFn(expr: CalcExpr): boolean {
  if (expr.type === "calc-operand") return valueHasSiblingFn(expr.value);
  if (expr.type === "calc-function")
    return (
      expr.name === "sibling-index" ||
      expr.name === "sibling-count" ||
      expr.args.some(calcHasSiblingFn)
    );
  return calcHasSiblingFn(expr.left) || calcHasSiblingFn(expr.right);
}

export function foldSiblingFns(v: Value, ctx: SiblingContext): Value {
  switch (v.type) {
    case "calc":
      return { ...v, expr: foldCalc(v.expr, ctx) };
    case "function":
      return { ...v, args: v.args.map((a) => foldSiblingFns(a, ctx)) };
    case "list":
      return { ...v, values: v.values.map((a) => foldSiblingFns(a, ctx)) };
    case "variable":
      return v.fallback
        ? { ...v, fallback: foldSiblingFns(v.fallback, ctx) }
        : v;
    default:
      return v;
  }
}

function foldCalc(expr: CalcExpr, ctx: SiblingContext): CalcExpr {
  if (expr.type === "calc-operand")
    return { type: "calc-operand", value: foldSiblingFns(expr.value, ctx) };
  if (expr.type === "calc-function") {
    if (expr.name === "sibling-index")
      return {
        type: "calc-operand",
        value: { type: "number", value: ctx.index },
      };
    if (expr.name === "sibling-count")
      return {
        type: "calc-operand",
        value: { type: "number", value: ctx.count },
      };
    return { ...expr, args: expr.args.map((a) => foldCalc(a, ctx)) };
  }
  return {
    type: "calc-binary",
    op: expr.op,
    left: foldCalc(expr.left, ctx),
    right: foldCalc(expr.right, ctx),
  };
}
