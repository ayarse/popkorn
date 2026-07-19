import type {
  CalcExpr,
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
import { type CompiledCalc, compileCalc } from "./calc-compile";
import type { InputState } from "./inputs";

// Reactive calc() expressions compile to a closure once and are cached by AST
// identity; the 5000 repeat copies each carry a distinct expr (sibling-index()
// is folded per node), so this dedups only genuinely shared source — cheap.
const compiledCalcCache = new WeakMap<CalcExpr, CompiledCalc>();

// Sentinel: a variable name resolved to "not defined" this frame (distinct from
// a legitimately-cached Value, and from Map's undefined miss).
const VAR_UNDEFINED = Symbol("var-undefined");

/** Primitive a host reads/writes through the variable API. */
export type VariableValue = number | boolean | string;

/**
 * Variable resolution system
 * Handles CSS variables and input bindings
 */
export class VariableResolver {
  private staticVariables: Map<string, Value> = new Map();
  private dynamicVariables: Map<string, () => number> = new Map();
  // Host-set overrides (setVariable), authored triggers (`--x: trigger`), and
  // the triggers fired this frame (fire → read `true` once → endFrame resets).
  private hostOverrides: Map<string, VariableValue> = new Map();
  private triggers: Set<string> = new Set();
  private firedTriggers: Set<string> = new Set();

  // Per-frame variable resolution memo: a reactive calc() may mention the same
  // var() (e.g. `--t`) at many leaves, and the same var() recurs across the whole
  // node walk. Resolution is a pure function of (frameEpoch); bumping the epoch
  // on any state change (frame boundary, setVariable, fire, input update)
  // invalidates the memo, so `seek(t)` stays a pure function of time.
  private frameEpoch = 0;
  private varMemo: Map<string, Value | typeof VAR_UNDEFINED> = new Map();
  private varMemoEpoch = -1;

  // Reused per-call so compiled calc() closures allocate nothing to reach the
  // resolver. (Bound methods, not arrows over `this`, to keep it a stable object.)
  private readonly calcCtx = {
    resolveCalcVar: (name: string, fallback?: Value): Value =>
      this.resolveVariable(name, fallback),
    resolveCalcInput: (path: string): number => this.resolveInputPath(path),
  };

  constructor() {
    // Set up built-in input bindings
    this.setupBuiltinInputs();
  }

  /**
   * Open a new resolution frame: invalidates the per-frame var() memo. The render
   * loop calls this once at the top of every draw (live tick, seek, or redraw),
   * before machines evaluate or nodes resolve, so each frame recomputes fresh.
   */
  beginFrame(): void {
    this.frameEpoch++;
  }

  /**
   * Initialize with variable definitions from :root
   */
  setVariables(variables: VariableDefinition[]): void {
    this.staticVariables.clear();
    this.dynamicVariables.clear();
    this.triggers.clear();

    for (const v of variables) {
      // Check if the value is an input() function
      if (isFunctionValue(v.value) && v.value.name === "input") {
        // Register as a dynamic variable that will be resolved at runtime
        const inputPath = this.getInputPath(v.value.args);
        if (inputPath) {
          this.dynamicVariables.set(v.name, () =>
            this.resolveInputPath(inputPath),
          );
        }
      } else if (isKeywordValue(v.value) && v.value.value === "trigger") {
        // `--x: trigger` — a momentary event var, false until fired.
        this.triggers.add(v.name);
      } else {
        // Static variable
        this.staticVariables.set(v.name, v.value);
      }
    }
  }

  // --- Host-writable variable API --------------------------------------------
  // `setVariable`/`getVariable`/`fire` operate only on author-declared
  // `--variables`; `input()` paths are read-only and never routed here.

  /**
   * Set a variable's value from the host, overriding the authored value.
   * Accepts the name with or without the leading `--`.
   */
  setVariable(name: string, value: VariableValue): void {
    this.hostOverrides.set(normalizeVarName(name), value);
    this.frameEpoch++; // invalidate the memo so a mid-frame host write is seen
  }

  /**
   * Read a variable's current resolved value (host override, trigger, input
   * binding, or authored default). Returns undefined for unknown names.
   */
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

  /**
   * Fire a trigger variable: it reads as `true` for exactly one frame, then
   * `endFrame()` resets it. Accepts the name with or without the leading `--`.
   */
  fire(name: string): void {
    this.firedTriggers.add(normalizeVarName(name));
    this.frameEpoch++; // a trigger fired mid-frame must invalidate the memo
  }

  /**
   * Reset triggers fired this frame. The render loop MUST call this once per
   * frame, after resolving the node walk, so triggers are momentary.
   */
  endFrame(): void {
    if (this.firedTriggers.size > 0) {
      this.firedTriggers.clear();
      this.frameEpoch++; // fired triggers read `false` again → invalidate the memo
    }
  }

  /**
   * Update input state for dynamic variables
   */
  private inputState: InputState = {
    cursor: { x: 0, y: 0, isDown: false, pressed: false },
    scroll: { x: 0, y: 0, progress: 0 },
    time: 0,
  };

  updateInputState(state: InputState): void {
    this.inputState = state;
    this.frameEpoch++; // input-bound vars (`input(time)`, cursor.*) changed
  }

  /**
   * Resolve a value, substituting any variable references
   */
  resolveValue(value: Value): Value {
    if (isVariableRefValue(value)) {
      return this.resolveVariable(value.name, value.fallback);
    }
    if (isCalcValue(value)) {
      return this.resolveCalc(value);
    }
    return value;
  }

  /**
   * Evaluate a calc() against the live variable/input state. Runs per frame for
   * reactive calc (var()/input() operands) via the numeric binding path, so a
   * calc that reads input(cursor.x) re-evaluates like any other binding. Purely
   * static calc is already folded to a literal at build time, so this only fires
   * for the reactive case.
   */
  private resolveCalc(value: CalcValue): Value {
    let compiled = compiledCalcCache.get(value.expr);
    if (!compiled) {
      compiled = compileCalc(value.expr);
      compiledCalcCache.set(value.expr, compiled);
    }
    const n = compiled(this.calcCtx);
    return n ? calcNumericToValue(n) : { type: "number", value: 0 };
  }

  /**
   * Resolve a variable by name. The defined-variable lookup (host override >
   * trigger > input binding > static) is memoized per frame — a reactive calc()
   * may reference the same var() dozens of times across the node walk — while the
   * per-call `fallback` (used only when the name is undefined) is applied fresh.
   */
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
    // Host override wins over the authored value (setVariable).
    if (this.hostOverrides.has(name)) {
      return primitiveToValue(this.hostOverrides.get(name)!);
    }
    // Trigger vars read `true` only on the frame they were fired.
    if (this.triggers.has(name)) {
      return {
        type: "keyword",
        value: this.firedTriggers.has(name) ? "true" : "false",
      };
    }
    // Dynamic variables (input bindings) resolve to a live number.
    if (this.dynamicVariables.has(name)) {
      return { type: "number", value: this.dynamicVariables.get(name)!() };
    }
    // Static variables — recursively resolve if the value is itself a var()/calc().
    if (this.staticVariables.has(name)) {
      return this.resolveValue(this.staticVariables.get(name)!);
    }
    return VAR_UNDEFINED;
  }

  /**
   * Resolve a numeric value (for properties like cx, cy, r, etc.)
   */
  resolveNumeric(value: Value): number {
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

  /**
   * Check if a value contains any variable references
   */
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

  /**
   * Resolve a single `input(path)` to a number against the current input state.
   * Same path set the `--var: input(...)` bindings use — cursor.*, scroll.*
   * (incl. scroll.progress), time, and media.* with headless fallbacks. Unknown
   * paths resolve to 0. Public entry for machine guards and animation-timeline.
   */
  resolveInput(path: string): number {
    return this.resolveInputPath(path);
  }

  private getInputPath(args: Value[]): string | null {
    if (args.length === 0) return null;

    const arg = args[0];
    // Handle dot notation like cursor.x
    if (isKeywordValue(arg)) {
      return arg.value;
    }
    return null;
  }

  private resolveInputPath(path: string): number {
    // Runs per binding per frame; the path set is small and fixed, so direct
    // comparison avoids a per-call split() allocation.
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
      // NOTE: headless fallback is the InputState default (0); the tracker
      // only computes real progress from DOM scroll events in a browser.
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

/**
 * Read a `media.*` built-in input straight from the environment. Static reads
 * per resolve (no subscription) — the values change rarely and lazily.
 * NOTE: headless (no matchMedia/window) falls back to 0 / sensible defaults.
 */
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

/** Normalize a host-supplied variable name to the authored `--name` form. */
function normalizeVarName(name: string): string {
  return name.startsWith("--") ? name : `--${name}`;
}

/**
 * A host primitive as an AST Value: booleans become `true`/`false` keywords,
 * numbers stay numbers, strings become string values. A string is untyped at
 * the host boundary (it could be text OR a color like "#f00"); the slot decides
 * — a paint binding runs it through colorStringFromValue, a text/keyword slot
 * reads it verbatim. NOTE: input() stays numeric; when string inputs land, this
 * same StringValue plumbing carries them (dynamicVariables would return a Value
 * instead of a number).
 */
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
