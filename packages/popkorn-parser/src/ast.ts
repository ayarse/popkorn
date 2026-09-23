import type { Diagnostic } from "./diagnostics.js";

export interface StyleSheet {
  type: "stylesheet";
  rules: Rule[];
  keyframes: KeyframeRule[];
  definitions: DefinitionRule[]; // Reusable symbols (@define)
  machines: MachineRule[]; // Interactive state machines (@machine)
  canvas?: CanvasConfig;
  variables: VariableDefinition[];
  // Not part of the AST value: the serializer and round-trip equality ignore it.
  diagnostics: Diagnostic[];
}

// `@define <name> { <rule body> }`, instantiated wherever a rule declares `use: <name>`.
export interface DefinitionRule {
  type: "definition";
  name: string;
  declarations: Declaration[];
  children: Rule[];
  states: StateRule[];
}

export interface VariableDefinition {
  name: string; // e.g., '--cursor-x'
  value: Value;
}

export interface CanvasConfig {
  width: number;
  height: number;
  background?: string;
  // `hidden` (default) crops to the stage box like an AE comp; `visible` lets content spill.
  overflow?: "hidden" | "visible";
}

export type PseudoState = "hover" | "active";

// `children` style descendants in this state (`#p:hover > #c`); 'state' = machine `&:state(name)`.
export interface StateRule {
  state: PseudoState | "state";
  machineState?: { machine: string | null; name: string };
  declarations: Declaration[];
  children: Rule[];
}

export interface Rule {
  type: "rule";
  selector: Selector;
  declarations: Declaration[];
  children: Rule[]; // For nested rules (hierarchy)
  states: StateRule[]; // For pseudo-class rules (&:hover, &:active)
  span: Span; // whole rule: selector through closing brace
  preludeSpan: Span; // just the selector text (e.g. `#box`)
}

export interface Selector {
  type: "id" | "class" | "root";
  name: string;
}

// Half-open source offset range; like diagnostics, ignored by round-trip value equality.
export interface Span {
  start: number;
  end: number;
}

export interface Declaration {
  type: "declaration";
  property: string;
  value: Value;
  // Excludes the trailing `;`; alias expansions share their source spans, synthesized decls are zero.
  span: Span;
  valueSpan: Span;
}

export const ZERO_SPAN: Span = { start: 0, end: 0 };

export const decl = (
  property: string,
  value: Value,
  span: Span = ZERO_SPAN,
  valueSpan: Span = ZERO_SPAN,
): Declaration => ({ type: "declaration", property, value, span, valueSpan });

export type Value =
  | LengthValue
  | ColorValue
  | KeywordValue
  | NumberValue
  | StringValue
  | FunctionValue
  | ListValue
  | VariableRefValue
  | CalcValue
  | RandomValue;

export interface VariableRefValue {
  type: "variable";
  name: string; // e.g., '--cursor-x'
  fallback?: Value;
}

export interface LengthValue {
  type: "length";
  value: number;
  unit:
    | "px"
    | "deg"
    | "grad"
    | "rad"
    | "turn"
    | "%"
    | "em"
    | "rem"
    | "s"
    | "ms";
}

export interface ColorValue {
  type: "color";
  value: string;
}

export interface KeywordValue {
  type: "keyword";
  value: string;
}

export interface NumberValue {
  type: "number";
  value: number;
}

export interface StringValue {
  type: "string";
  value: string;
}

export interface FunctionValue {
  type: "function";
  name: string;
  args: Value[];
}

export interface ListValue {
  type: "list";
  values: Value[];
  // Absent = 'space'; 'comma' marks a CSS comma list (multi-value `animation`) of space-lists.
  separator?: "space" | "comma";
}

// Semantics-free; evalCalc evaluates it for both the build-time fold and the runtime path.
export interface CalcValue {
  type: "calc";
  expr: CalcExpr;
}

// CSS Values 5 random(): a constant rolled once at build time (seeding lives in player scene/random.ts).
export interface RandomValue {
  type: "random";
  // Roll per element (node id mixed into the seed) instead of once per declaration.
  perElement: boolean;
  // `--k`: calls sharing ident + range share one roll.
  ident?: string;
  min: Value;
  max: Value;
  step?: Value; // `by <step>` — quantize the result to min + n·step, clamped ≤ max
}

export type CalcExpr = CalcBinary | CalcOperand | CalcFunction;

export interface CalcBinary {
  type: "calc-binary";
  op: "+" | "-" | "*" | "/";
  left: CalcExpr;
  right: CalcExpr;
}

// sibling-index()/sibling-count() take no args and never fold; the scene builder resolves them.
export type CalcFunctionName =
  | "min"
  | "max"
  | "clamp"
  | "round"
  | "mod"
  | "rem"
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "atan2"
  | "pow"
  | "sqrt"
  | "hypot"
  | "log"
  | "exp"
  | "abs"
  | "sign"
  | "sibling-index"
  | "sibling-count";

// round()'s optional leading rounding strategy; defaults to "nearest".
export type RoundStrategy = "nearest" | "up" | "down" | "to-zero";

export interface CalcFunction {
  type: "calc-function";
  name: CalcFunctionName;
  args: CalcExpr[];
  strategy?: RoundStrategy; // round() only
}

// A leaf: any numeric Value (length/number/var()/input()/nested calc()).
export interface CalcOperand {
  type: "calc-operand";
  value: Value;
}

export interface KeyframeRule {
  type: "keyframes";
  name: string;
  blocks: KeyframeBlock[];
  span: Span; // whole at-rule: `@keyframes` through closing brace
  preludeSpan: Span; // just the name text
}

export interface KeyframeBlock {
  type: "keyframe-block";
  selectors: number[]; // Percentages: [0, 100] or [50]
  declarations: Declaration[];
  easing?: Value; // Per-keyframe easing (animation-timing-function value, verbatim)
  selectorSpan: Span; // the `0%, 50%` selector-list text
  span: Span; // whole block: selectors through closing brace
}

// --- State machines (@machine): concurrent; the player owns transition semantics ---

export interface MachineRule {
  type: "machine";
  name: string;
  initial: string; // name of the entry state
  states: MachineState[]; // in document order
}

export interface MachineState {
  name: string; // '*' for the any-state block (checked before current)
  transitions: MachineTransition[]; // `to:` decls, in declaration = priority order
  emits: string[]; // `emit: <name>;` events fired on entry
}

// `to: <state> [on <trigger>] [when style(<g>) [and style(<g>)]*] [mix <dur> [<easing>]];`
export interface MachineTransition {
  to: string;
  trigger: MachineTrigger | null;
  guards: MachineGuard[]; // ANDed; empty = unconditional
  mix: { duration: number; easing: string | null } | null; // duration in ms
}

export type MachineTrigger =
  | {
      kind: "pointer";
      event: "click" | "pointerdown" | "pointerup" | "hoverstart" | "hoverend";
      target: { type: "id" | "root"; name: string };
    }
  | { kind: "complete" }
  | { kind: "event"; name: string };

// One comparison inside `style(...)`; time right-values are normalized to ms.
export interface MachineGuard {
  left:
    | { kind: "var"; name: string }
    | { kind: "input"; path: string }
    | { kind: "state-time" };
  op: "=" | "!=" | "<" | "<=" | ">" | ">=";
  right: number | boolean | string;
}

// Helper type guards
export function isLengthValue(value: Value): value is LengthValue {
  return value.type === "length";
}

export function isColorValue(value: Value): value is ColorValue {
  return value.type === "color";
}

export function isKeywordValue(value: Value): value is KeywordValue {
  return value.type === "keyword";
}

export function isNumberValue(value: Value): value is NumberValue {
  return value.type === "number";
}

export function isStringValue(value: Value): value is StringValue {
  return value.type === "string";
}

export function isFunctionValue(value: Value): value is FunctionValue {
  return value.type === "function";
}

export function isListValue(value: Value): value is ListValue {
  return value.type === "list";
}

export function isVariableRefValue(value: Value): value is VariableRefValue {
  return value.type === "variable";
}

export function isCalcValue(value: Value): value is CalcValue {
  return value.type === "calc";
}

export function isRandomValue(value: Value): value is RandomValue {
  return value.type === "random";
}

// --- calc() evaluation ----------------------------------------------------

// A numeric result carrying its unit; unit "" means a plain (unitless) number.
export interface CalcNumeric {
  value: number;
  unit: string;
}

/** Evaluate a calc() tree; null on an unresolvable leaf or unit mismatch (caller keeps the original). */
export function evalCalc(
  expr: CalcExpr,
  resolveLeaf: (v: Value) => CalcNumeric | null,
): CalcNumeric | null {
  if (expr.type === "calc-operand") return resolveLeaf(expr.value);
  if (expr.type === "calc-function") {
    const args: CalcNumeric[] = [];
    for (const a of expr.args) {
      const n = evalCalc(a, resolveLeaf);
      if (!n) return null;
      args.push(n);
    }
    return evalCalcFunction(expr, args);
  }
  const l = evalCalc(expr.left, resolveLeaf);
  const r = evalCalc(expr.right, resolveLeaf);
  if (!l || !r) return null;
  return evalCalcBinary(expr.op, l, r);
}

// Shared with the runtime's compiled-calc path so both use the same unit rules.
export function evalCalcBinary(
  op: CalcBinary["op"],
  l: CalcNumeric,
  r: CalcNumeric,
): CalcNumeric | null {
  switch (op) {
    case "+":
    case "-": {
      if (l.unit && r.unit && l.unit !== r.unit) return null;
      const value = op === "+" ? l.value + r.value : l.value - r.value;
      return { value, unit: l.unit || r.unit };
    }
    case "*": {
      if (l.unit && r.unit) return null; // no unit·unit
      return { value: l.value * r.value, unit: l.unit || r.unit };
    }
    case "/": {
      if (r.unit) return null; // no divide-by-unit
      return { value: l.value / r.value, unit: l.unit };
    }
  }
}

// The `e`/`pi` calc constants; null for any other keyword.
export function calcConstant(name: string): CalcNumeric | null {
  if (name === "pi") return { value: Math.PI, unit: "" };
  if (name === "e") return { value: Math.E, unit: "" };
  return null;
}

// Common unit per +/-'s rule: "" if all unitless, null on a conflict.
function agreedUnit(args: CalcNumeric[]): string | null {
  let unit = "";
  for (const a of args) {
    if (a.unit) {
      if (unit && unit !== a.unit) return null;
      unit = a.unit;
    }
  }
  return unit;
}

// A trig operand as radians: bare numbers are radians (CSS), angle units convert.
function toRadians(n: CalcNumeric): number {
  switch (n.unit) {
    case "deg":
      return (n.value * Math.PI) / 180;
    case "grad":
      return (n.value * Math.PI) / 200;
    case "turn":
      return n.value * 2 * Math.PI;
    // NOTE: unknown units are treated as radians rather than rejected.
    default:
      return n.value;
  }
}

const radToDeg = (r: number): number => (r * 180) / Math.PI;

// Writes into `out` (the per-frame VM's scratch) when given, else allocates.
function setNumeric(
  out: CalcNumeric | undefined,
  value: number,
  unit: string,
): CalcNumeric {
  if (!out) return { value, unit };
  out.value = value;
  out.unit = unit;
  return out;
}

// Null on an unresolvable unit combination, matching +/-'s conservatism.
export function evalCalcFunction(
  expr: CalcFunction,
  args: CalcNumeric[],
  out?: CalcNumeric,
): CalcNumeric | null {
  // Hot path (per compiled-calc OP_FUNC): positional args keep 1-2 arg cases allocation-free.
  const n = args.length;
  const v0 = n > 0 ? args[0].value : 0;
  const v1 = n > 1 ? args[1].value : 0;
  switch (expr.name) {
    // Resolved by the scene builder (scene/sibling.ts), never here.
    case "sibling-index":
    case "sibling-count":
      return null;
    // Unit-agreeing functions: all args share one unit, which the result keeps.
    case "min":
    case "max":
    case "clamp":
    case "hypot":
    case "mod":
    case "rem":
    case "round": {
      const unit = agreedUnit(args);
      if (unit === null) return null;
      switch (expr.name) {
        case "min":
          return setNumeric(out, Math.min(...args.map((a) => a.value)), unit);
        case "max":
          return setNumeric(out, Math.max(...args.map((a) => a.value)), unit);
        // clamp(MIN, VAL, MAX) = max(MIN, min(VAL, MAX)); MIN wins when MIN > MAX.
        case "clamp":
          return setNumeric(
            out,
            Math.max(v0, Math.min(v1, args[2].value)),
            unit,
          );
        case "hypot":
          return setNumeric(out, Math.hypot(...args.map((a) => a.value)), unit);
        // mod() follows the sign of the divisor; rem() follows the dividend (CSS).
        case "mod":
          return setNumeric(out, v0 - v1 * Math.floor(v0 / v1), unit);
        case "rem":
          return setNumeric(out, v0 % v1, unit);
        // Step defaults to 1 (in the value's own unit) when omitted.
        default:
          return setNumeric(
            out,
            roundTo(expr.strategy ?? "nearest", v0, n > 1 ? v1 : 1),
            unit,
          );
      }
    }
    case "abs":
      return setNumeric(out, Math.abs(v0), args[0].unit);
    case "sign":
      return setNumeric(out, Math.sign(v0), "");
    case "sin":
      return setNumeric(out, Math.sin(toRadians(args[0])), "");
    case "cos":
      return setNumeric(out, Math.cos(toRadians(args[0])), "");
    case "tan":
      return setNumeric(out, Math.tan(toRadians(args[0])), "");
    case "asin":
      return setNumeric(out, radToDeg(Math.asin(v0)), "deg");
    case "acos":
      return setNumeric(out, radToDeg(Math.acos(v0)), "deg");
    case "atan":
      return setNumeric(out, radToDeg(Math.atan(v0)), "deg");
    case "atan2":
      return setNumeric(out, radToDeg(Math.atan2(v0, v1)), "deg");
    case "sqrt":
      return setNumeric(out, Math.sqrt(v0), "");
    case "exp":
      return setNumeric(out, Math.exp(v0), "");
    case "pow":
      return setNumeric(out, v0 ** v1, "");
    case "log":
      return setNumeric(
        out,
        n > 1 ? Math.log(v0) / Math.log(v1) : Math.log(v0),
        "",
      );
  }
}

// Zero step yields NaN (CSS); "nearest" ties toward +∞ like Math.round.
function roundTo(strategy: RoundStrategy, value: number, step: number): number {
  if (step === 0) return NaN;
  const q = value / step;
  switch (strategy) {
    case "up":
      return Math.ceil(q) * step;
    case "down":
      return Math.floor(q) * step;
    case "to-zero":
      return Math.trunc(q) * step;
    default:
      return Math.round(q) * step;
  }
}

/** A {@link CalcNumeric} as a concrete AST Value (unitless → number). */
export function calcNumericToValue(n: CalcNumeric): Value {
  return n.unit
    ? { type: "length", value: n.value, unit: n.unit as LengthValue["unit"] }
    : { type: "number", value: n.value };
}

function staticLeaf(v: Value): CalcNumeric | null {
  if (v.type === "number") return { value: v.value, unit: "" };
  if (v.type === "length") return { value: v.value, unit: v.unit };
  if (v.type === "calc") return evalCalc(v.expr, staticLeaf);
  if (v.type === "keyword") return calcConstant(v.value);
  return null;
}

/** Fold a calc() to a Value, or null if var()/input() operands need runtime resolution. */
export function evalCalcStatic(value: CalcValue): Value | null {
  const n = evalCalc(value.expr, staticLeaf);
  return n ? calcNumericToValue(n) : null;
}

// Value extractors
export function getNumericValue(value: Value): number {
  if (value.type === "number") return value.value;
  if (value.type === "length") return value.value;
  if (value.type === "calc") {
    const folded = evalCalcStatic(value);
    return folded ? getNumericValue(folded) : 0;
  }
  return 0;
}

export function getStringValue(value: Value): string {
  if (value.type === "string") return value.value;
  if (value.type === "keyword") return value.value;
  if (value.type === "color") return value.value;
  return "";
}
