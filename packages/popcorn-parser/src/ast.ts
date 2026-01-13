// AST Type Definitions for the CSS-like DSL

export interface StyleSheet {
  type: 'stylesheet';
  rules: Rule[];
  keyframes: KeyframeRule[];
  canvas?: CanvasConfig;
  variables: VariableDefinition[];
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

export interface Rule {
  type: 'rule';
  selector: Selector;
  declarations: Declaration[];
  children: Rule[]; // For nested rules (hierarchy)
}

export interface Selector {
  type: 'id' | 'class' | 'canvas' | 'root';
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
  easing?: string;  // Per-keyframe easing (animation-timing-function value)
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
