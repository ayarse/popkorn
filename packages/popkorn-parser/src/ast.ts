// AST Type Definitions for the CSS-like DSL

import type { Diagnostic } from "./diagnostics";

export interface StyleSheet {
  type: "stylesheet";
  rules: Rule[];
  keyframes: KeyframeRule[];
  definitions: DefinitionRule[]; // Reusable symbols (@define)
  machines: MachineRule[]; // Interactive state machines (@machine)
  canvas?: CanvasConfig;
  variables: VariableDefinition[];
  // Position-tracked parse/lint diagnostics (unknown props, bad refs, …). Always
  // present (possibly empty); not part of the AST *value* — the serializer
  // ignores it and round-trip equality is checked over the rest of the tree.
  diagnostics: Diagnostic[];
}

// A reusable symbol: `@define <name> { <rule body> }`. The body is the same
// grammar as a rule body (declarations, > children, &:hover/&:active states);
// the builder instantiates it wherever a rule declares `use: <name>`.
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
  // Artboard clipping. `hidden` (the default when absent) crops scene content to
  // the width×height stage box, like an AE comp / Lottie player; `visible` lets
  // content spill past the edge. Only meaningful on `:root`.
  overflow?: "hidden" | "visible";
}

// Pseudo-class states for interactive elements. `'state'` is the discriminator
// for a machine `:state(name)` block; `machineState` then carries the details.
export type PseudoState = "hover" | "active";

// State-specific style rules. `children` holds `> #id { ... }` rules written
// inside the state block: they style a parent's direct descendant when the
// parent enters this interaction state (DSL spelling of `#p:hover > #c {…}`).
// When `state === 'state'` the block is a machine `&:state(name)` selector and
// `machineState` is set (machine null = un-namespaced `:state(idle)`).
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

// A half-open character-offset range into the original source, same convention
// as Diagnostic (start/end). Position metadata, not part of the AST *value* —
// serialize reformats text so offsets shift, so round-trip value-equality
// ignores spans exactly as it ignores diagnostics.
export interface Span {
  start: number;
  end: number;
}

export interface Declaration {
  type: "declaration";
  property: string;
  value: Value;
  // `span` covers the whole declaration (property through value, excluding the
  // trailing `;`); `valueSpan` covers just the value text. An aliased/expanded
  // declaration (e.g. border-radius → rx + ry) shares its source declaration's
  // spans. Serializer-synthesized declarations carry a zero span.
  span: Span;
  valueSpan: Span;
}

export type Value =
  | LengthValue
  | ColorValue
  | KeywordValue
  | NumberValue
  | StringValue
  | FunctionValue
  | ListValue
  | VariableRefValue
  | CalcValue;

// Reference to a CSS variable: var(--name)
export interface VariableRefValue {
  type: "variable";
  name: string; // e.g., '--cursor-x'
  fallback?: Value;
}

export interface LengthValue {
  type: "length";
  value: number;
  unit: "px" | "deg" | "%" | "em" | "rem" | "s" | "ms";
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
  // How the items were written. Absent/'space' is the default (e.g. a multi-part
  // `transform`); 'comma' marks a CSS comma-separated list (e.g. a multi-value
  // `animation` shorthand), whose items are themselves usually space-lists.
  separator?: "space" | "comma";
}

// CSS calc(): an arithmetic expression tree over numeric operands. The AST stays
// semantics-free — evaluation (unit propagation, var() resolution) lives in
// evalCalc, shared by the build-time static fold and the per-frame runtime path.
export interface CalcValue {
  type: "calc";
  expr: CalcExpr;
}

export type CalcExpr = CalcBinary | CalcOperand;

export interface CalcBinary {
  type: "calc-binary";
  op: "+" | "-" | "*" | "/";
  left: CalcExpr;
  right: CalcExpr;
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

// --- State machines (@machine) -------------------------------------------
//
// One `@machine <name> { initial: <s>; state <s> { ... } }` at-rule. Multiple
// machines run concurrently. The AST is a faithful mirror of the source and
// knows no runtime semantics — the player owns transition evaluation.

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

// A `to: <state> [on <trigger>] [when style(<guard>) [and style(<guard>)]*]
//  [mix <duration> [<easing>]];` transition.
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

// A single flat comparison inside `style(...)`. Time values on the right
// (`500ms`, `2s`) are normalized to milliseconds.
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

// --- calc() evaluation ----------------------------------------------------

// A numeric result carrying its unit; unit "" means a plain (unitless) number.
export interface CalcNumeric {
  value: number;
  unit: string;
}

/**
 * Evaluate a calc() expression tree. `resolveLeaf` maps each operand Value to a
 * {@link CalcNumeric} (or null when it can't be resolved to a number). Returns
 * null on any unresolvable operand or an unsupported unit combination
 * (unit·unit multiply, divide-by-unit, add/subtract of mismatched units) — the
 * caller keeps the original value in that case. Kept lean on purpose: no full
 * unit-algebra system.
 */
export function evalCalc(
  expr: CalcExpr,
  resolveLeaf: (v: Value) => CalcNumeric | null,
): CalcNumeric | null {
  if (expr.type === "calc-operand") return resolveLeaf(expr.value);
  const l = evalCalc(expr.left, resolveLeaf);
  const r = evalCalc(expr.right, resolveLeaf);
  if (!l || !r) return null;
  switch (expr.op) {
    case "+":
    case "-": {
      if (l.unit && r.unit && l.unit !== r.unit) return null;
      const value = expr.op === "+" ? l.value + r.value : l.value - r.value;
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

/** A {@link CalcNumeric} as a concrete AST Value (unitless → number). */
export function calcNumericToValue(n: CalcNumeric): Value {
  return n.unit
    ? { type: "length", value: n.value, unit: n.unit as LengthValue["unit"] }
    : { type: "number", value: n.value };
}

// Fold a calc() whose operands are all literal numbers/lengths (no var/input);
// returns null when anything can't be resolved statically.
function staticLeaf(v: Value): CalcNumeric | null {
  if (v.type === "number") return { value: v.value, unit: "" };
  if (v.type === "length") return { value: v.value, unit: v.unit };
  if (v.type === "calc") return evalCalc(v.expr, staticLeaf);
  return null;
}

/** Statically fold a calc() to a length/number Value, or null if it contains
 * unresolved var()/input() operands (which must resolve at runtime instead). */
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
