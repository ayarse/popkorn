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

/**
 * Compiles a reactive calc() AST into a flat postfix program run per frame with
 * no AST walking and no per-op allocation on its arithmetic.
 *
 * The interpreter (`evalCalc` + `calcLeaf` in variables.ts) recurses the tree,
 * dispatching on node kind and allocating a `{value, unit}` CalcNumeric at every
 * step, re-resolving each var()/input() leaf through the full resolver every
 * frame. For scene 22 (5000 circles × ~150-op expressions) that dominates the
 * frame. Here each expression compiles once into a postfix opcode stream:
 *
 *   - every var()/input()-free subtree is folded to a single constant push at
 *     compile time (only operators on the live path from a var()/input() leaf up
 *     to the root run per frame);
 *   - execution is a single monomorphic switch over a flat `number[]` code
 *     stream against reused value/unit stacks — no closure-tree megamorphism;
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

export type CompiledCalc = (ctx: CalcEvalContext) => CalcNumeric | null;

const OP_CONST = 0; // push const pool[arg]
const OP_VAR = 1; // push resolved var pool[arg]
const OP_INPUT = 2; // push resolved input pool[arg]
const OP_BIN = 3; // pop 2, apply binop arg (0:+ 1:- 2:* 3:/)
const OP_FUNC = 4; // pop argc, apply function pool[arg]

const BIN_CODE: Record<string, number> = { "+": 0, "-": 1, "*": 2, "/": 3 };

// A subtree that isn't statically constant. Distinct from `null` (a constant
// that resolved to "unresolvable", e.g. a unit conflict) and from a CalcNumeric.
const DYNAMIC = Symbol("dynamic");
type Folded = CalcNumeric | null | typeof DYNAMIC;

/** Compile a calc() expression tree to a program closure. Cache it by identity. */
export function compileCalc(expr: CalcExpr): CompiledCalc {
  const c = new Compiler();
  const folded = c.fold(expr);
  // Whole expression is a build-time constant: return it (or 0-sentinel null).
  if (folded !== DYNAMIC) {
    const result = folded;
    return () => result;
  }
  c.emit(expr);
  return c.build();
}

class Compiler {
  private code: number[] = [];
  private constValue: number[] = [];
  private constUnit: string[] = [];
  private constValid: number[] = [];
  private varName: string[] = [];
  private varFallback: (Value | undefined)[] = [];
  private inputPath: (string | null)[] = [];
  private func: CalcFunction[] = [];
  private funcArgBuf: CalcNumeric[][] = [];
  private foldCache = new Map<CalcExpr, Folded>();
  private depth = 0;
  private maxDepth = 0;

  build(): CompiledCalc {
    const {
      code,
      constValue,
      constUnit,
      constValid,
      varName,
      varFallback,
      inputPath,
      func,
      funcArgBuf,
    } = this;
    // Reused across frames; safe because runs are synchronous and any reentrant
    // var()-triggered calc is a DIFFERENT program with its own stacks.
    const vs = new Float64Array(this.maxDepth);
    const us: string[] = new Array(this.maxDepth).fill("");
    const valid = new Uint8Array(this.maxDepth);

    return (ctx: CalcEvalContext): CalcNumeric | null => {
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
          case OP_VAR: {
            const r = mapResolved(
              ctx.resolveCalcVar(varName[arg], varFallback[arg]),
            );
            if (r) {
              vs[sp] = r.value;
              us[sp] = r.unit;
              valid[sp] = 1;
            } else {
              valid[sp] = 0;
            }
            sp++;
            break;
          }
          case OP_INPUT: {
            const p = inputPath[arg];
            vs[sp] = p ? ctx.resolveCalcInput(p) : 0;
            us[sp] = "";
            valid[sp] = 1;
            sp++;
            break;
          }
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
            const fn = func[arg];
            const buf = funcArgBuf[arg];
            const argc = buf.length;
            sp -= argc;
            let ok = true;
            for (let k = 0; k < argc; k++) {
              if (!valid[sp + k]) ok = false;
              buf[k].value = vs[sp + k];
              buf[k].unit = us[sp + k];
            }
            if (!ok) {
              valid[sp] = 0;
              sp++;
              break;
            }
            const res = evalCalcFunction(fn, buf);
            if (res) {
              vs[sp] = res.value;
              us[sp] = res.unit;
              valid[sp] = 1;
            } else {
              valid[sp] = 0;
            }
            sp++;
            break;
          }
        }
      }
      return valid[0] ? { value: vs[0], unit: us[0] } : null;
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
      const idx = this.inputPath.length;
      this.inputPath.push(inputPath(v.args));
      this.push(OP_INPUT, idx);
      this.grow();
      return;
    }
    // Only a var() reaches here (any other leaf folds to a constant).
    const idx = this.varName.length;
    this.varName.push((v as { name: string }).name);
    this.varFallback.push((v as { fallback?: Value }).fallback);
    this.push(OP_VAR, idx);
    this.grow();
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
    this.constUnit.push(n ? n.unit : "");
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

// The tail of `calcLeaf`: map a resolved var() Value to a CalcNumeric.
function mapResolved(resolved: Value): CalcNumeric | null {
  if (isNumberValue(resolved)) return { value: resolved.value, unit: "" };
  if (isLengthValue(resolved))
    return { value: resolved.value, unit: resolved.unit };
  if (isKeywordValue(resolved)) {
    if (resolved.value === "true") return { value: 1, unit: "" };
    if (resolved.value === "false") return { value: 0, unit: "" };
    return calcConstant(resolved.value);
  }
  return null;
}

// `input(cursor.x)` → "cursor.x". Mirrors VariableResolver.getInputPath.
function inputPath(args: Value[]): string | null {
  const arg = args[0];
  if (arg && isKeywordValue(arg)) return arg.value;
  return null;
}
