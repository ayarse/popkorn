// AST Type Definitions for the CSS-like DSL

export interface StyleSheet {
  type: 'stylesheet';
  rules: Rule[];
  keyframes: KeyframeRule[];
  definitions: DefinitionRule[];  // Reusable symbols (@define)
  machines: MachineRule[];        // Interactive state machines (@machine)
  canvas?: CanvasConfig;
  variables: VariableDefinition[];
}

// A reusable symbol: `@define <name> { <rule body> }`. The body is the same
// grammar as a rule body (declarations, > children, &:hover/&:active states);
// the builder instantiates it wherever a rule declares `use: <name>`.
export interface DefinitionRule {
  type: 'definition';
  name: string;
  declarations: Declaration[];
  children: Rule[];
  states: StateRule[];
}

export interface VariableDefinition {
  name: string;  // e.g., '--cursor-x'
  value: Value;
}

export interface CanvasConfig {
  width: number;
  height: number;
  background?: string;
}

// Pseudo-class states for interactive elements. `'state'` is the discriminator
// for a machine `:state(name)` block; `machineState` then carries the details.
export type PseudoState = 'hover' | 'active';

// State-specific style rules. `children` holds `> #id { ... }` rules written
// inside the state block: they style a parent's direct descendant when the
// parent enters this interaction state (DSL spelling of `#p:hover > #c {…}`).
// When `state === 'state'` the block is a machine `&:state(name)` selector and
// `machineState` is set (machine null = un-namespaced `:state(idle)`).
export interface StateRule {
  state: PseudoState | 'state';
  machineState?: { machine: string | null; name: string };
  declarations: Declaration[];
  children: Rule[];
}

export interface Rule {
  type: 'rule';
  selector: Selector;
  declarations: Declaration[];
  children: Rule[]; // For nested rules (hierarchy)
  states: StateRule[]; // For pseudo-class rules (&:hover, &:active)
}

export interface Selector {
  type: 'id' | 'class' | 'root';
  name: string;
}

export interface Declaration {
  type: 'declaration';
  property: string;
  value: Value;
}

export type Value =
  | LengthValue
  | ColorValue
  | KeywordValue
  | NumberValue
  | StringValue
  | FunctionValue
  | ListValue
  | VariableRefValue;

// Reference to a CSS variable: var(--name)
export interface VariableRefValue {
  type: 'variable';
  name: string;  // e.g., '--cursor-x'
  fallback?: Value;
}

export interface LengthValue {
  type: 'length';
  value: number;
  unit: 'px' | 'deg' | '%' | 'em' | 'rem' | 's' | 'ms';
}

export interface ColorValue {
  type: 'color';
  value: string;
}

export interface KeywordValue {
  type: 'keyword';
  value: string;
}

export interface NumberValue {
  type: 'number';
  value: number;
}

export interface StringValue {
  type: 'string';
  value: string;
}

export interface FunctionValue {
  type: 'function';
  name: string;
  args: Value[];
}

export interface ListValue {
  type: 'list';
  values: Value[];
  // How the items were written. Absent/'space' is the default (e.g. a multi-part
  // `transform`); 'comma' marks a CSS comma-separated list (e.g. a multi-value
  // `animation` shorthand), whose items are themselves usually space-lists.
  separator?: 'space' | 'comma';
}

export interface KeyframeRule {
  type: 'keyframes';
  name: string;
  blocks: KeyframeBlock[];
}

export interface KeyframeBlock {
  type: 'keyframe-block';
  selectors: number[]; // Percentages: [0, 100] or [50]
  declarations: Declaration[];
  easing?: Value;  // Per-keyframe easing (animation-timing-function value, verbatim)
}

// --- State machines (@machine) -------------------------------------------
//
// One `@machine <name> { initial: <s>; state <s> { ... } }` at-rule. Multiple
// machines run concurrently. The AST is a faithful mirror of the source and
// knows no runtime semantics — the player owns transition evaluation.

export interface MachineRule {
  type: 'machine';
  name: string;
  initial: string;        // name of the entry state
  states: MachineState[]; // in document order
}

export interface MachineState {
  name: string;           // '*' for the any-state block (checked before current)
  transitions: MachineTransition[]; // `to:` decls, in declaration = priority order
  emits: string[];        // `emit: <name>;` events fired on entry
}

// A `to: <state> [on <trigger>] [when style(<guard>) [and style(<guard>)]*]
//  [mix <duration> [<easing>]];` transition.
export interface MachineTransition {
  to: string;
  trigger: MachineTrigger | null;
  guards: MachineGuard[];                 // ANDed; empty = unconditional
  mix: { duration: number; easing: string | null } | null; // duration in ms
}

export type MachineTrigger =
  | { kind: 'pointer'; event: 'click' | 'pointerdown' | 'pointerup' | 'hoverstart' | 'hoverend'; target: { type: 'id' | 'root'; name: string } }
  | { kind: 'complete' }
  | { kind: 'event'; name: string };

// A single flat comparison inside `style(...)`. Time values on the right
// (`500ms`, `2s`) are normalized to milliseconds.
export interface MachineGuard {
  left: { kind: 'var'; name: string } | { kind: 'input'; path: string } | { kind: 'state-time' };
  op: '=' | '!=' | '<' | '<=' | '>' | '>=';
  right: number | boolean | string;
}

// Helper type guards
export function isLengthValue(value: Value): value is LengthValue {
  return value.type === 'length';
}

export function isColorValue(value: Value): value is ColorValue {
  return value.type === 'color';
}

export function isKeywordValue(value: Value): value is KeywordValue {
  return value.type === 'keyword';
}

export function isNumberValue(value: Value): value is NumberValue {
  return value.type === 'number';
}

export function isStringValue(value: Value): value is StringValue {
  return value.type === 'string';
}

export function isFunctionValue(value: Value): value is FunctionValue {
  return value.type === 'function';
}

export function isListValue(value: Value): value is ListValue {
  return value.type === 'list';
}

export function isVariableRefValue(value: Value): value is VariableRefValue {
  return value.type === 'variable';
}

// Value extractors
export function getNumericValue(value: Value): number {
  if (value.type === 'number') return value.value;
  if (value.type === 'length') return value.value;
  return 0;
}

export function getStringValue(value: Value): string {
  if (value.type === 'string') return value.value;
  if (value.type === 'keyword') return value.value;
  if (value.type === 'color') return value.value;
  return '';
}
