/**
 * sibling-index() / sibling-count() — CSS Values 5 §10 tree-counting functions.
 *
 * Both are STRUCTURAL: their value is the node's 1-based position among all its
 * siblings, and the total sibling count. They can't fold in the parser's static
 * calc path (that has no node context), so the scene builder resolves them per
 * node at build time by substituting the literal count into the value tree —
 * exactly the seam random() uses. After the fold the calc() is an ordinary
 * numeric expression the existing static/runtime paths handle.
 */
import type { CalcExpr, Value } from "@popkorn/parser";

/** The node's position among its siblings (1-based) and the total count. */
export interface SiblingContext {
  index: number;
  count: number;
}

/** True when a value tree contains any sibling-index()/sibling-count() call. */
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

/**
 * Replace every sibling-index()/sibling-count() leaf in a value tree with the
 * fixed number it resolves to for this node. Non-sibling values pass through
 * unchanged. Use {@link valueHasSiblingFn} first to skip trees with neither.
 */
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
