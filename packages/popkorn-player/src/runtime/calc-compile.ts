import type {
  CalcExpr,
  CalcFunction,
  CalcNumeric,
  Value,
} from "@popkorn/parser";
import {
  calcConstant,
  evalCalcBinary,
  evalCalcFunction,
  isCalcValue,
  isFunctionValue,
  isKeywordValue,
  isLengthValue,
  isNumberValue,
  isVariableRefValue,
} from "@popkorn/parser";
import type { CalcLane } from "./calc-batch";

/**
 * Compiles a reactive calc() AST into a flat postfix program run per frame with
 * no AST walking and no per-op allocation on its arithmetic.
 *
 * The interpreter (`evalCalc` + `calcLeaf` in variables.ts) recurses the tree,
 * dispatching on node kind and allocating a `{value, unit}` CalcNumeric at every
 * step, re-resolving each var()/input() leaf through the full resolver every
 * frame. For scene 22 (10000 circles × ~150-op expressions) that dominates the
 * frame. Here each expression compiles once into a postfix opcode stream:
 *
 *   - every var()/input()-free subtree is folded to a single constant push at
 *     compile time (only operators on the live path from a var()/input() leaf up
 *     to the root run per frame);
 *   - a program is plain data run by the single shared `runCalc`, and a run
 *     allocates nothing: leaf reads, math-function results and the returned
 *     numeric all land in the program's own scratch. Measured on scene 22 at
 *     10k copies (tools/bench-calc.ts), dropping those allocations is worth
 *     ~1.5x under JSC and ~1.15x under V8, which escape-analyses most of them
 *     away already;
 *   - each distinct var()/input() leaf resolves ONCE per run into a leaf pool
 *     before the loop, so a var mentioned at many leaves costs one resolve and
 *     the loop itself never calls into the resolver;
 *   - `+ - * /` are applied inline with zero allocation; math functions defer to
 *     the shared `evalCalcFunction` so unit rules never drift from the interpreter.
 *
 * Unit propagation and null-on-conflict semantics match `evalCalc` operator for
 * operator, so a compiled expression is bit-for-bit identical to the interpreter.
 */

/** The live leaf reads a compiled program needs — a thin slice of the resolver. */
export interface CalcEvalContext {
  /** Resolve a `var(--name)` to a Value (host override/trigger/input/static). */
  resolveCalcVar(name: string, fallback?: Value): Value;
  /** Resolve an `input(path)` to a unitless number. */
  resolveCalcInput(path: string): number;
}

/**
 * A compiled expression: plain data, executed by `runCalc`. `constant` holds the
 * whole result for an expression that folded at compile time (its `code` is
 * empty); every other field is the opcode stream and its pools.
 */
export interface CompiledCalc {
  constant: CalcNumeric | null | undefined;
  code: number[];
  constValue: number[];
  constUnit: number[];
  constValid: number[];
  /** Dynamic leaves, resolved once per run into the leaf pool below. */
  leafName: (string | null)[];
  leafFallback: (Value | undefined)[];
  leafPath: (string | null)[];
  leafValue: Float64Array;
  leafUnit: Uint8Array;
  leafValid: Uint8Array;
  func: CalcFunction[];
  funcArgBuf: CalcNumeric[][];
  depth: number;
  /** Scratch results: the program's own, so a run allocates nothing. */
  out: CalcNumeric;
  funcOut: CalcNumeric;
  /**
   * Set when this program joined a multi-lane batch (see calc-batch.ts): the
   * expression runs once per frame for every clone at once and this program's
   * result is read out of the batch's lane. Absent → the scalar path above.
   */
  lane: CalcLane | null;
}

// One set of operand stacks for every program: the loop never calls back into
// the resolver (leaves are all resolved in the prologue), so no run can be
// re-entered mid-loop and clobber them. Per-program stacks cost more in cache
// misses than the arithmetic they serve.
let SHARED_DEPTH = 64;
let SHARED_VS = new Float64Array(SHARED_DEPTH);
let SHARED_US = new Uint8Array(SHARED_DEPTH);
let SHARED_VALID = new Uint8Array(SHARED_DEPTH);
function growShared(depth: number): void {
  SHARED_DEPTH = depth;
  SHARED_VS = new Float64Array(depth);
  SHARED_US = new Uint8Array(depth);
  SHARED_VALID = new Uint8Array(depth);
}

// Units are interned to small ints for the loop: a string stack costs more in
// write barriers than the arithmetic it annotates. 0 is always "" (unitless),
// so `us[sp]` is truthy exactly when the operand carries a unit.
const UNIT_NAMES: string[] = [""];
const UNIT_IDS = new Map<string, number>([["", 0]]);
/** The interned unit for an id (0 → unitless). Ids are stable process-wide. */
export function unitName(id: number): string {
  return UNIT_NAMES[id];
}
export function unitId(unit: string): number {
  const hit = UNIT_IDS.get(unit);
  if (hit !== undefined) return hit;
  const id = UNIT_NAMES.length;
  UNIT_NAMES.push(unit);
  UNIT_IDS.set(unit, id);
  return id;
}

export const OP_CONST = 0; // push const pool[arg]
export const OP_LEAF = 1; // push leaf pool[arg] (var()/input(), resolved in the prologue)
export const OP_BIN = 3; // pop 2, apply binop arg (0:+ 1:- 2:* 3:/)
export const OP_FUNC = 4; // pop argc, apply function pool[arg]

const BIN_CODE: Record<string, number> = { "+": 0, "-": 1, "*": 2, "/": 3 };

// A subtree that isn't statically constant. Distinct from `null` (a constant
// that resolved to "unresolvable", e.g. a unit conflict) and from a CalcNumeric.
const DYNAMIC = Symbol("dynamic");
type Folded = CalcNumeric | null | typeof DYNAMIC;

/** Compile a calc() expression tree to a program. Cache it by identity. */
export function compileCalc(expr: CalcExpr): CompiledCalc {
  const c = new Compiler();
  const folded = c.fold(expr);
  // Whole expression is a build-time constant: carry it (or a 0-sentinel null).
  if (folded !== DYNAMIC) return c.build(folded);
  c.emit(expr);
  return c.build(undefined);
}

/**
 * Run a compiled program against the live resolver. The single execution path
 * for every reactive calc() in a scene.
 */
export function runCalc(
  p: CompiledCalc,
  ctx: CalcEvalContext,
): CalcNumeric | null {
  if (p.constant !== undefined) return p.constant;
  resolveLeaves(p, ctx);
  const { leafValue, leafUnit, leafValid } = p;
  const { code, constValue, constUnit, constValid, func, funcArgBuf } = p;
  if (p.depth > SHARED_DEPTH) growShared(p.depth);
  const vs = SHARED_VS;
  const us = SHARED_US;
  const valid = SHARED_VALID;
  let sp = 0;
  for (let i = 0; i < code.length; i += 2) {
    const arg = code[i + 1];
    switch (code[i]) {
      case OP_CONST:
        vs[sp] = constValue[arg];
        us[sp] = constUnit[arg];
        valid[sp] = constValid[arg];
        sp++;
        break;
      case OP_LEAF:
        vs[sp] = leafValue[arg];
        us[sp] = leafUnit[arg];
        valid[sp] = leafValid[arg];
        sp++;
        break;
      case OP_BIN: {
        sp -= 2;
        if (!valid[sp] || !valid[sp + 1]) {
          valid[sp] = 0;
          sp++;
          break;
        }
        // Inline mirror of evalCalcBinary (kept in lockstep by the
        // compiled-vs-interpreter parity test).
        const lv = vs[sp];
        const lu = us[sp];
        const rv = vs[sp + 1];
        const ru = us[sp + 1];
        switch (arg) {
          case 0: // +
          case 1: // -
            if (lu && ru && lu !== ru) {
              valid[sp] = 0;
            } else {
              vs[sp] = arg === 0 ? lv + rv : lv - rv;
              us[sp] = lu || ru;
            }
            break;
          case 2: // *
            if (lu && ru) {
              valid[sp] = 0;
            } else {
              vs[sp] = lv * rv;
              us[sp] = lu || ru;
            }
            break;
          default: // /
            if (ru) {
              valid[sp] = 0;
            } else {
              vs[sp] = lv / rv;
              us[sp] = lu;
            }
            break;
        }
        sp++;
        break;
      }
      case OP_FUNC: {
        const buf = funcArgBuf[arg];
        const argc = buf.length;
        sp -= argc;
        let ok = true;
        for (let k = 0; k < argc; k++) {
          if (!valid[sp + k]) ok = false;
          buf[k].value = vs[sp + k];
          buf[k].unit = UNIT_NAMES[us[sp + k]];
        }
        if (!ok) {
          valid[sp] = 0;
          sp++;
          break;
        }
        const res = evalCalcFunction(func[arg], buf, p.funcOut);
        if (res) {
          vs[sp] = res.value;
          us[sp] = unitId(res.unit);
          valid[sp] = 1;
        } else {
          valid[sp] = 0;
        }
        sp++;
        break;
      }
    }
  }
  if (!valid[0]) return null;
  const out = p.out;
  out.value = vs[0];
  out.unit = UNIT_NAMES[us[0]];
  return out;
}

/**
 * Resolve each distinct live leaf of a program exactly once into its pool. The
 * whole live-resolver surface a run touches, hoisted ahead of the op loop — both
 * `runCalc` and the batched executor (calc-batch.ts) rely on that: no op may
 * call back into the resolver mid-loop, which is what makes the operand stacks
 * shareable across programs.
 */
export function resolveLeaves(p: CompiledCalc, ctx: CalcEvalContext): void {
  const { leafName, leafPath, leafValue, leafUnit, leafValid } = p;
  for (let i = 0; i < leafName.length; i++) {
    const name = leafName[i];
    if (name === null) {
      const path = leafPath[i];
      leafValue[i] = path ? ctx.resolveCalcInput(path) : 0;
      leafUnit[i] = 0;
      leafValid[i] = 1;
      continue;
    }
    // Inline of mapResolved, writing straight into the pool: allocating a
    // CalcNumeric here costs more than the whole arithmetic loop.
    const v = ctx.resolveCalcVar(name, p.leafFallback[i]);
    leafValid[i] = 1;
    if (isNumberValue(v)) {
      leafValue[i] = v.value;
      leafUnit[i] = 0;
    } else if (isLengthValue(v)) {
      leafValue[i] = v.value;
      leafUnit[i] = unitId(v.unit);
    } else if (isKeywordValue(v)) {
      if (v.value === "true" || v.value === "false") {
        leafValue[i] = v.value === "true" ? 1 : 0;
        leafUnit[i] = 0;
      } else {
        const k = calcConstant(v.value);
        if (k) {
          leafValue[i] = k.value;
          leafUnit[i] = unitId(k.unit);
        } else {
          leafValid[i] = 0;
        }
      }
    } else {
      leafValid[i] = 0;
    }
  }
}

class Compiler {
  private code: number[] = [];
  private constValue: number[] = [];
  private constUnit: number[] = [];
  private constValid: number[] = [];
  private leafName: (string | null)[] = [];
  private leafFallback: (Value | undefined)[] = [];
  private leafPath: (string | null)[] = [];
  private func: CalcFunction[] = [];
  private funcArgBuf: CalcNumeric[][] = [];
  private foldCache = new Map<CalcExpr, Folded>();
  private depth = 0;
  private maxDepth = 0;

  build(constant: Folded | undefined): CompiledCalc {
    const depth = Math.max(this.maxDepth, 1);
    return {
      constant:
        constant === DYNAMIC || constant === undefined ? undefined : constant,
      code: this.code,
      constValue: this.constValue,
      constUnit: this.constUnit,
      constValid: this.constValid,
      leafName: this.leafName,
      leafFallback: this.leafFallback,
      leafPath: this.leafPath,
      leafValue: new Float64Array(this.leafName.length),
      leafUnit: new Uint8Array(this.leafName.length),
      leafValid: new Uint8Array(this.leafName.length),
      func: this.func,
      funcArgBuf: this.funcArgBuf,
      depth,
      out: { value: 0, unit: "" },
      funcOut: { value: 0, unit: "" },
      lane: null,
    };
  }

  // --- compile-time constant folding (pure; emits nothing) ------------------

  fold(expr: CalcExpr): Folded {
    const cached = this.foldCache.get(expr);
    if (cached !== undefined) return cached;
    const res = this.foldUncached(expr);
    this.foldCache.set(expr, res);
    return res;
  }

  private foldUncached(expr: CalcExpr): Folded {
    if (expr.type === "calc-operand") return foldLeaf(expr.value);
    if (expr.type === "calc-function") {
      const args: CalcNumeric[] = [];
      for (const a of expr.args) {
        const f = this.fold(a);
        if (f === DYNAMIC) return DYNAMIC;
        if (f === null) return null;
        args.push(f);
      }
      return evalCalcFunction(expr, args);
    }
    const l = this.fold(expr.left);
    const r = this.fold(expr.right);
    if (l === DYNAMIC || r === DYNAMIC) return DYNAMIC;
    if (l === null || r === null) return null;
    return evalCalcBinary(expr.op, l, r);
  }

  // --- emit (only reached for non-constant subtrees) ------------------------

  emit(expr: CalcExpr): void {
    const f = this.fold(expr);
    if (f !== DYNAMIC) {
      this.pushConst(f);
      return;
    }
    if (expr.type === "calc-operand") {
      this.emitLeaf(expr.value);
      return;
    }
    if (expr.type === "calc-function") {
      for (const a of expr.args) this.emit(a);
      this.emitFunc(expr);
      return;
    }
    this.emit(expr.left);
    this.emit(expr.right);
    this.push(OP_BIN, BIN_CODE[expr.op]);
    this.depth -= 1; // two operands off, one result on
  }

  private emitLeaf(v: Value): void {
    if (isCalcValue(v)) {
      this.emit(v.expr);
      return;
    }
    if (isFunctionValue(v) && v.name === "input") {
      this.push(OP_LEAF, this.leaf(null, undefined, inputPath(v.args)));
      this.grow();
      return;
    }
    // Only a var() reaches here (any other leaf folds to a constant).
    this.push(
      OP_LEAF,
      this.leaf(
        (v as { name: string }).name,
        (v as { fallback?: Value }).fallback,
        null,
      ),
    );
    this.grow();
  }

  /**
   * Intern a live leaf. Repeat mentions of one var()/input() share a pool slot,
   * so the run resolves it once however many times the expression reads it.
   * A fallback makes the leaf distinct — it is applied only when the name is
   * undefined, and two fallbacks can differ.
   */
  private leaf(
    name: string | null,
    fallback: Value | undefined,
    path: string | null,
  ): number {
    if (fallback === undefined) {
      for (let i = 0; i < this.leafName.length; i++) {
        if (
          this.leafName[i] === name &&
          this.leafPath[i] === path &&
          this.leafFallback[i] === undefined
        )
          return i;
      }
    }
    const idx = this.leafName.length;
    this.leafName.push(name);
    this.leafFallback.push(fallback);
    this.leafPath.push(path);
    return idx;
  }

  private emitFunc(expr: CalcFunction): void {
    const idx = this.func.length;
    this.func.push(expr);
    const buf: CalcNumeric[] = [];
    for (let k = 0; k < expr.args.length; k++) buf.push({ value: 0, unit: "" });
    this.funcArgBuf.push(buf);
    this.push(OP_FUNC, idx);
    this.depth -= expr.args.length - 1; // argc operands off, one result on
  }

  private pushConst(n: CalcNumeric | null): void {
    const idx = this.constValue.length;
    this.constValue.push(n ? n.value : 0);
    this.constUnit.push(n ? unitId(n.unit) : 0);
    this.constValid.push(n ? 1 : 0);
    this.push(OP_CONST, idx);
    this.grow();
  }

  private push(op: number, arg: number): void {
    this.code.push(op, arg);
  }

  private grow(): void {
    this.depth += 1;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
  }
}

// Constant fold of a leaf Value (mirrors variables.ts `calcLeaf` for non-live
// operands); DYNAMIC for var()/input() (and nested calc reaching either).
function foldLeaf(v: Value): Folded {
  if (isCalcValue(v)) {
    // A nested calc: fold recursively via a throwaway compiler pass.
    return new Compiler().fold(v.expr);
  }
  if (isFunctionValue(v) && v.name === "input") return DYNAMIC;
  if (isVariableRefValue(v)) return DYNAMIC;
  if (isNumberValue(v)) return { value: v.value, unit: "" };
  if (isLengthValue(v)) return { value: v.value, unit: v.unit };
  if (isKeywordValue(v)) {
    if (v.value === "true") return { value: 1, unit: "" };
    if (v.value === "false") return { value: 0, unit: "" };
    return calcConstant(v.value);
  }
  return null; // string/color/list → interpreter's leaf resolver returns null
}

// `input(cursor.x)` → "cursor.x". Mirrors VariableResolver.getInputPath.
function inputPath(args: Value[]): string | null {
  const arg = args[0];
  if (arg && isKeywordValue(arg)) return arg.value;
  return null;
}
