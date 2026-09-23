// Build-time folding of static :root var()s and calc().

import type { CalcExpr, Value } from "@popkorn/parser";
import {
  evalCalcStatic,
  isCalcValue,
  isFunctionValue,
  isListValue,
  isVariableRefValue,
} from "@popkorn/parser";

// var()/input() anywhere outside a function's args (lists and calc() included).
export function hasVariableReference(value: Value): boolean {
  if (isVariableRefValue(value)) return true;
  if (isFunctionValue(value)) return value.name === "input";
  if (isListValue(value)) return value.values.some(hasVariableReference);
  if (isCalcValue(value))
    return calcOperands(value.expr).some(hasVariableReference);
  return false;
}

// Inline static :root var()s; reactive/undefined ones stay for bindings.
export function resolveStaticVars(
  value: Value,
  variables: Map<string, Value>,
): Value {
  if (isVariableRefValue(value)) {
    const resolved = variables.get(value.name);
    if (resolved) {
      if (hasVariableReference(resolved)) return value;
      return resolveStaticVars(resolved, variables);
    }
    // Undefined var: fall back to the authored fallback (if static).
    if (value.fallback && !hasVariableReference(value.fallback)) {
      return resolveStaticVars(value.fallback, variables);
    }
    return value;
  }
  if (isFunctionValue(value)) {
    if (value.name === "input") return value; // reactive; leave args alone
    let changed = false;
    const args = value.args.map((a) => {
      const r = resolveStaticVars(a, variables);
      if (r !== a) changed = true;
      return r;
    });
    return changed ? { ...value, args } : value;
  }
  if (isListValue(value)) {
    let changed = false;
    const values = value.values.map((v) => {
      const r = resolveStaticVars(v, variables);
      if (r !== v) changed = true;
      return r;
    });
    return changed ? { ...value, values } : value;
  }
  if (isCalcValue(value)) {
    // Fold static calc() to a literal; reactive ones stay per-frame.
    const resolved = {
      type: "calc" as const,
      expr: mapCalcOperands(value.expr, (v) => resolveStaticVars(v, variables)),
    };
    if (!hasVariableReference(resolved)) {
      return evalCalcStatic(resolved) ?? resolved;
    }
    return resolved;
  }
  return value;
}

// Every leaf Value in a calc() expression tree (left→right).
function calcOperands(expr: CalcExpr): Value[] {
  if (expr.type === "calc-operand") return [expr.value];
  if (expr.type === "calc-function") return expr.args.flatMap(calcOperands);
  return [...calcOperands(expr.left), ...calcOperands(expr.right)];
}

// Rebuild a calc() expression tree, mapping each leaf Value through `fn`.
function mapCalcOperands(expr: CalcExpr, fn: (v: Value) => Value): CalcExpr {
  if (expr.type === "calc-operand")
    return { type: "calc-operand", value: fn(expr.value) };
  if (expr.type === "calc-function")
    return {
      type: "calc-function",
      name: expr.name,
      args: expr.args.map((a) => mapCalcOperands(a, fn)),
    };
  return {
    type: "calc-binary",
    op: expr.op,
    left: mapCalcOperands(expr.left, fn),
    right: mapCalcOperands(expr.right, fn),
  };
}
