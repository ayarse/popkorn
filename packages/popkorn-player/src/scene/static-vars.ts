// Build-time folding of static :root var()s and calc().

import type { CalcValue, Value, VariableRefValue } from "@popkorn/parser";
import { evalCalcStatic, mapValue, someValue } from "@popkorn/parser";

const isReactive = (v: Value): boolean =>
  v.type === "variable" || (v.type === "function" && v.name === "input");

// var()/input() in the value, a list, or calc(); other function args and random() are build-time and never bind.
export function hasVariableReference(value: Value): boolean {
  if (isReactive(value)) return true;
  if (value.type === "list") return value.values.some(hasVariableReference);
  if (value.type === "calc") return someValue(value, isReactive);
  return false;
}

// Inline static :root var()s; reactive/undefined ones stay for bindings.
export function resolveStaticVars(
  value: Value,
  variables: Map<string, Value>,
): Value {
  return mapValue(value, (v) => {
    if (v.type === "variable") return resolveVar(v, variables);
    if (v.type === "function" && v.name === "input") return v; // reactive; args left alone
    if (v.type === "calc") return foldCalc(v, variables);
    return undefined;
  });
}

function resolveVar(v: VariableRefValue, variables: Map<string, Value>): Value {
  const resolved = variables.get(v.name);
  if (resolved)
    return hasVariableReference(resolved)
      ? v
      : resolveStaticVars(resolved, variables);
  // Undefined var: fall back to the authored fallback (if static).
  if (v.fallback && !hasVariableReference(v.fallback))
    return resolveStaticVars(v.fallback, variables);
  return v;
}

// Resolve the calc()'s leaves, then fold it to a literal unless still reactive.
function foldCalc(v: CalcValue, variables: Map<string, Value>): Value {
  const resolved = mapValue(v, (x) =>
    x === v ? undefined : resolveStaticVars(x, variables),
  );
  if (resolved.type !== "calc" || hasVariableReference(resolved))
    return resolved;
  return evalCalcStatic(resolved) ?? resolved;
}
