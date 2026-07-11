export type {
  CanvasConfig,
  ColorValue,
  Declaration,
  DefinitionRule,
  FunctionValue,
  KeyframeBlock,
  KeyframeRule,
  KeywordValue,
  LengthValue,
  ListValue,
  MachineGuard,
  MachineRule,
  MachineState,
  MachineTransition,
  MachineTrigger,
  NumberValue,
  PseudoState,
  Rule,
  Selector,
  StateRule,
  StringValue,
  StyleSheet,
  Value,
  VariableDefinition,
  VariableRefValue,
} from "./ast";
export {
  getNumericValue,
  getStringValue,
  isColorValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
  isStringValue,
  isVariableRefValue,
} from "./ast";
export { parse } from "./parser";
export type { SerializeOptions } from "./serializer";
export { serialize } from "./serializer";

import { parse as parseSource } from "./parser";
import { serialize as serializeSheet } from "./serializer";

/** Minify Popkorn DSL source. Value-preserving: output parses to the same AST. */
export function minify(source: string): string {
  return serializeSheet(parseSource(source), { minify: true });
}

/** Pretty-print Popkorn DSL source (2-space indent). Value-preserving. */
export function format(source: string): string {
  return serializeSheet(parseSource(source), { minify: false });
}
