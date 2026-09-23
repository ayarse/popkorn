import type {
  CalcExpr,
  CalcNumeric,
  CalcValue,
  Value,
  VariableDefinition,
} from "@popkorn/parser";
import {
  calcNumericToValue,
  isCalcValue,
  isColorValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isNumberValue,
  isStringValue,
  isVariableRefValue,
} from "@popkorn/parser";
import { planCalcBatches, runCalcLane } from "./calc-batch.js";
import { type CompiledCalc, compileCalc, runCalc } from "./calc-compile.js";
import type { InputState } from "./inputs.js";

// Keyed by AST identity; repeat copies carry distinct exprs, so only shared source dedups.
const compiledCalcCache = new WeakMap<CalcExpr, CompiledCalc>();

// Memoized "not defined", distinct from Map's undefined miss.
const VAR_UNDEFINED = Symbol("var-undefined");

/** Primitive a host reads/writes through the variable API. */
export type VariableValue = number | boolean | string;

export class VariableResolver {
  private staticVariables: Map<string, Value> = new Map();
  private dynamicVariables: Map<string, () => number> = new Map();
  private hostOverrides: Map<string, VariableValue> = new Map();
  private triggers: Set<string> = new Set();
  private firedTriggers: Set<string> = new Set();

  // var() memo, valid for one epoch; every state change bumps the epoch.
  private frameEpoch = 0;
  private varMemo: Map<string, Value | typeof VAR_UNDEFINED> = new Map();
  private varMemoEpoch = -1;

  // One stable object so compiled calc() runs allocate nothing to reach the resolver.
  private readonly calcCtx = {
    resolveCalcVar: (name: string, fallback?: Value): Value =>
      this.resolveVariable(name, fallback),
    resolveCalcInput: (path: string): number => this.resolveInputPath(path),
  };

  constructor() {
    this.setupBuiltinInputs();
  }

  /** Invalidate the var() memo; called at the top of every draw. */
  beginFrame(): void {
    this.frameEpoch++;
  }

  setVariables(variables: VariableDefinition[]): void {
    this.staticVariables.clear();
    this.dynamicVariables.clear();
    this.triggers.clear();

    for (const v of variables) {
      if (isFunctionValue(v.value) && v.value.name === "input") {
        const inputPath = this.getInputPath(v.value.args);
        if (inputPath) {
          this.dynamicVariables.set(v.name, () =>
            this.resolveInputPath(inputPath),
          );
        }
      } else if (isKeywordValue(v.value) && v.value.value === "trigger") {
        this.triggers.add(v.name);
      } else {
        this.staticVariables.set(v.name, v.value);
      }
    }
  }

  // Host API: author-declared `--variables` only; `input()` paths are read-only.

  /** Override the authored value; `--` prefix optional. */
  setVariable(name: string, value: VariableValue): void {
    this.hostOverrides.set(normalizeVarName(name), value);
    this.frameEpoch++;
  }

  /** Undefined for unknown names. */
  getVariable(name: string): VariableValue | undefined {
    const key = normalizeVarName(name);
    if (
      !this.hostOverrides.has(key) &&
      !this.triggers.has(key) &&
      !this.dynamicVariables.has(key) &&
      !this.staticVariables.has(key)
    ) {
      return undefined;
    }
    return valueToPrimitive(this.resolveVariable(key));
  }

  /** Reads `true` for exactly one frame, until `endFrame()`. */
  fire(name: string): void {
    this.firedTriggers.add(normalizeVarName(name));
    this.frameEpoch++;
  }

  /** Must run once per frame after the node walk, so triggers are momentary. */
  endFrame(): void {
    if (this.firedTriggers.size > 0) {
      this.firedTriggers.clear();
      this.frameEpoch++;
    }
  }

  private inputState: InputState = {
    cursor: { x: 0, y: 0, isDown: false, pressed: false },
    scroll: { x: 0, y: 0, progress: 0 },
    time: 0,
  };

  updateInputState(state: InputState): void {
    this.inputState = state;
    this.frameEpoch++;
  }

  resolveValue(value: Value): Value {
    if (isVariableRefValue(value)) {
      return this.resolveVariable(value.name, value.fallback);
    }
    if (isCalcValue(value)) {
      return this.resolveCalc(value);
    }
    return value;
  }

  /** Reactive calc() only; static calc is folded at build time. */
  private resolveCalc(value: CalcValue): Value {
    const n = this.runCalcValue(value);
    return n ? calcNumericToValue(n) : { type: "number", value: 0 };
  }

  /** Batched programs read their lane (calc-batch.ts); others run the scalar VM. */
  private runCalcValue(value: CalcValue): CalcNumeric | null {
    const p = this.compiledFor(value);
    if (p.lane) return runCalcLane(p.lane, this.calcCtx, this.frameEpoch);
    return runCalc(p, this.calcCtx);
  }

  /** Once per scene; a pure optimization. Returns how many values joined a batch. */
  planCalcBatches(values: Value[]): number {
    const programs: CompiledCalc[] = [];
    for (const v of values) {
      if (isCalcValue(v)) programs.push(this.compiledFor(v));
    }
    return planCalcBatches(programs);
  }

  private compiledFor(value: CalcValue): CompiledCalc {
    let compiled = compiledCalcCache.get(value.expr);
    if (!compiled) {
      compiled = compileCalc(value.expr);
      compiledCalcCache.set(value.expr, compiled);
    }
    return compiled;
  }

  /** Host override > trigger > input > static, memoized per epoch; `fallback` applies fresh. */
  resolveVariable(name: string, fallback?: Value): Value {
    const defined = this.lookupDefinedVar(name);
    if (defined !== VAR_UNDEFINED) return defined;
    if (fallback) return this.resolveValue(fallback);
    return { type: "number", value: 0 };
  }

  private lookupDefinedVar(name: string): Value | typeof VAR_UNDEFINED {
    if (this.varMemoEpoch !== this.frameEpoch) {
      this.varMemo.clear();
      this.varMemoEpoch = this.frameEpoch;
    }
    const hit = this.varMemo.get(name);
    if (hit !== undefined) return hit;
    const v = this.computeDefinedVar(name);
    this.varMemo.set(name, v);
    return v;
  }

  private computeDefinedVar(name: string): Value | typeof VAR_UNDEFINED {
    if (this.hostOverrides.has(name)) {
      return primitiveToValue(this.hostOverrides.get(name)!);
    }
    if (this.triggers.has(name)) {
      return {
        type: "keyword",
        value: this.firedTriggers.has(name) ? "true" : "false",
      };
    }
    if (this.dynamicVariables.has(name)) {
      return { type: "number", value: this.dynamicVariables.get(name)!() };
    }
    if (this.staticVariables.has(name)) {
      return this.resolveValue(this.staticVariables.get(name)!);
    }
    return VAR_UNDEFINED;
  }

  resolveNumeric(value: Value): number {
    // Hot path: skip boxing the calc result into a Value.
    if (isCalcValue(value)) {
      const n = this.runCalcValue(value);
      return n ? n.value : 0;
    }
    const resolved = this.resolveValue(value);

    if (isNumberValue(resolved)) {
      return resolved.value;
    }
    if (isLengthValue(resolved)) {
      return resolved.value;
    }
    // Booleans (host/trigger vars) coerce to 1/0 in a numeric binding.
    if (isKeywordValue(resolved)) {
      if (resolved.value === "true") return 1;
      if (resolved.value === "false") return 0;
    }
    return 0;
  }

  hasVariables(value: Value): boolean {
    if (isVariableRefValue(value)) {
      return true;
    }
    if (isFunctionValue(value) && value.name === "input") {
      return true;
    }
    if (isCalcValue(value)) {
      return this.calcHasVariables(value.expr);
    }
    return false;
  }

  private calcHasVariables(expr: CalcExpr): boolean {
    if (expr.type === "calc-operand") return this.hasVariables(expr.value);
    if (expr.type === "calc-function")
      return expr.args.some((a) => this.calcHasVariables(a));
    return (
      this.calcHasVariables(expr.left) || this.calcHasVariables(expr.right)
    );
  }

  private setupBuiltinInputs(): void {
    // These are resolved directly without needing variable definitions
  }

  /** For machine guards and animation-timeline; unknown paths resolve to 0. */
  resolveInput(path: string): number {
    return this.resolveInputPath(path);
  }

  private getInputPath(args: Value[]): string | null {
    if (args.length === 0) return null;

    const arg = args[0];
    if (isKeywordValue(arg)) {
      return arg.value;
    }
    return null;
  }

  private resolveInputPath(path: string): number {
    // Switch, not split(): runs per binding per frame.
    switch (path) {
      case "cursor.x":
        return this.inputState.cursor.x;
      case "cursor.y":
        return this.inputState.cursor.y;
      case "cursor.isDown":
        return this.inputState.cursor.isDown ? 1 : 0;
      case "scroll.x":
        return this.inputState.scroll.x;
      case "scroll.y":
        return this.inputState.scroll.y;
      // NOTE: headless stays at the InputState default (0).
      case "scroll.progress":
        return this.inputState.scroll.progress;
      case "time":
        return this.inputState.time;
      default:
        if (path.startsWith("media.")) return resolveMedia(path);
        return 0;
    }
  }
}

/** Read per resolve, no subscription. NOTE: headless falls back to 0. */
function resolveMedia(path: string): number {
  const mm = typeof matchMedia !== "undefined" ? matchMedia : undefined;
  switch (path) {
    case "media.prefers-reduced-motion":
      return mm && mm("(prefers-reduced-motion: reduce)").matches ? 1 : 0;
    case "media.hover":
      return mm && mm("(hover: hover)").matches ? 1 : 0;
    case "media.width":
      return typeof window !== "undefined" ? window.innerWidth : 0;
    case "media.height":
      return typeof window !== "undefined" ? window.innerHeight : 0;
    default:
      return 0;
  }
}

function normalizeVarName(name: string): string {
  return name.startsWith("--") ? name : `--${name}`;
}

/** Booleans → keywords; strings stay untyped (text or color) and the binding slot decides. */
function primitiveToValue(v: VariableValue): Value {
  if (typeof v === "boolean")
    return { type: "keyword", value: v ? "true" : "false" };
  if (typeof v === "string") return { type: "string", value: v };
  return { type: "number", value: v };
}

/** A resolved Value as a host primitive (`true`/`false` keywords → booleans). */
function valueToPrimitive(v: Value): VariableValue {
  if (isNumberValue(v) || isLengthValue(v)) return v.value;
  if (isKeywordValue(v)) {
    if (v.value === "true") return true;
    if (v.value === "false") return false;
    return v.value;
  }
  if (isStringValue(v) || isColorValue(v)) return v.value;
  return 0;
}

export function createVariableResolver(): VariableResolver {
  return new VariableResolver();
}
