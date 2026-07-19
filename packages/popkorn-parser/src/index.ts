export type {
  CalcBinary,
  CalcExpr,
  CalcFunction,
  CalcFunctionName,
  CalcNumeric,
  CalcOperand,
  CalcValue,
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
  RandomValue,
  RoundStrategy,
  Rule,
  Selector,
  Span,
  StateRule,
  StringValue,
  StyleSheet,
  Value,
  VariableDefinition,
  VariableRefValue,
} from "./ast";
export {
  calcConstant,
  calcNumericToValue,
  evalCalc,
  evalCalcBinary,
  evalCalcFunction,
  evalCalcStatic,
  getNumericValue,
  getStringValue,
  isCalcValue,
  isColorValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
  isRandomValue,
  isStringValue,
  isVariableRefValue,
} from "./ast";
export { crush } from "./crush";
export type { Diagnostic, Severity } from "./diagnostics";
export { offsetToLineCol } from "./diagnostics";
export { parse, validate } from "./parser";
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

/**
 * Crush Popkorn DSL source: minify AND destructively rename identifiers to
 * short names. Render-preserving (the built scene is identical) but lossy —
 * human-readable ids/keyframes/vars are gone. See {@link crush}.
 */
export function crushSource(source: string): string {
  return serializeSheet(parseSource(source), { crush: true });
}
