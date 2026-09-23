// sibling-index()/sibling-count() fold to literals per node at build time (same seam as random()).
import type { CalcFunction, Value } from "@popkorn/parser";
import { mapValue, someValue } from "@popkorn/parser";

/** 1-based position among siblings and the total count. */
export interface SiblingContext {
  index: number;
  count: number;
}

const isSiblingFn = (e: CalcFunction): boolean =>
  e.name === "sibling-index" || e.name === "sibling-count";

export function valueHasSiblingFn(v: Value): boolean {
  return someValue(v, () => false, isSiblingFn);
}

export function foldSiblingFns(v: Value, ctx: SiblingContext): Value {
  return mapValue(
    v,
    () => undefined,
    (e) =>
      isSiblingFn(e)
        ? {
            type: "calc-operand",
            value: {
              type: "number",
              value: e.name === "sibling-index" ? ctx.index : ctx.count,
            },
          }
        : undefined,
  );
}
