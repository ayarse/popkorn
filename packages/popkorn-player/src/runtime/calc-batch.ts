import type { CalcFunction, CalcNumeric } from "@popkorn/parser";
import { evalCalcFunction } from "@popkorn/parser";
import {
  binScalar,
  binUnit,
  type CalcEvalContext,
  type CompiledCalc,
  OP_BIN,
  OP_CONST,
  OP_FUNC,
  OP_LEAF,
  resolveLeaves,
  unitId,
  unitName,
} from "./calc-compile.js";

/** Runs structurally identical calc() programs (repeat clones) as one typed-array pass over N lanes per frame. */
// Units/validity depend only on operand units (a group-key component), so each slot carries one unit for all lanes.

/** Where a compiled program's result lives inside its batch. */
export interface CalcLane {
  batch: CalcBatch;
  index: number;
}

interface CalcBatch {
  p: CompiledCalc;
  n: number;
  /** Per-constant lane column, or EMPTY when the constant is lane-uniform. */
  constCol: Float64Array[];
  constScalar: Float64Array;
  sVal: Float64Array;
  sRef: Float64Array[];
  sOwn: Float64Array[];
  sIsVec: Uint8Array;
  sUnit: Uint8Array;
  sValid: Uint8Array;
  argVec: Float64Array[];
  outRef: Float64Array;
  outScalar: number;
  outIsVec: boolean;
  outValid: boolean;
  outUnit: string;
  out: CalcNumeric;
  /** Resolver + epoch the current results were computed at (-1 = never). */
  epoch: number;
  ctx: CalcEvalContext | null;
}

const EMPTY = new Float64Array(0);

// Smaller groups stay scalar: batch stacks cost more than running them one at a time.
const MIN_LANES = 8;

// NOTE: scratch cap; a chunked executor (L lanes at a time) would lift it.
const MAX_BATCH_BYTES = 64 << 20;

/** Batches programs by structure; peerless, folded or fallback programs stay scalar. Returns the batched count. */
export function planCalcBatches(programs: Iterable<CompiledCalc>): number {
  const groups = new Map<string, CompiledCalc[]>();
  for (const p of programs) {
    if (p.lane || !batchable(p)) continue;
    const key = shapeKey(p);
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  let batched = 0;
  for (const group of groups.values()) {
    if (group.length < MIN_LANES) continue;
    buildBatch(group);
    if (group[0].lane) batched += group.length;
  }
  return batched;
}

/** Runs the batch once per resolver epoch, so it re-runs exactly when a scalar re-resolve would. */
export function runCalcLane(
  lane: CalcLane,
  ctx: CalcEvalContext,
  epoch: number,
): CalcNumeric | null {
  const b = lane.batch;
  // Resolvers over one parsed sheet share a batch, with independent epochs.
  if (b.epoch !== epoch || b.ctx !== ctx) {
    runBatch(b, ctx);
    b.epoch = epoch;
    b.ctx = ctx;
  }
  if (!b.outValid) return null;
  const out = b.out;
  out.value = b.outIsVec ? b.outRef[lane.index] : b.outScalar;
  out.unit = b.outUnit;
  return out;
}

// NOTE: var() fallbacks stay scalar; interning fallback Values at parse time would allow batching.
function batchable(p: CompiledCalc): boolean {
  if (p.constant !== undefined || p.code.length === 0) return false;
  return p.leafFallback.every((f) => f === undefined);
}

/** Everything about a program except its per-lane numbers. */
function shapeKey(p: CompiledCalc): string {
  const parts: string[] = [p.code.join(",")];
  for (let i = 0; i < p.leafName.length; i++) {
    parts.push(`${p.leafName[i]}\0${p.leafPath[i]}`);
  }
  for (const f of p.func) {
    parts.push(`${f.name}/${f.strategy ?? ""}/${f.args.length}`);
  }
  parts.push(p.constUnit.join(","), p.constValid.join(","));
  return parts.join("|");
}

function buildBatch(members: CompiledCalc[]): void {
  const p = members[0];
  const n = members.length;
  const depth = p.depth;
  const nConst = p.constValue.length;

  let maxArgc = 0;
  for (const buf of p.funcArgBuf) maxArgc = Math.max(maxArgc, buf.length);

  let varying = 0;
  for (let c = 0; c < nConst; c++) {
    const v = p.constValue[c];
    if (members.some((m) => m.constValue[c] !== v)) varying++;
  }
  if ((depth + varying + maxArgc) * n * 8 > MAX_BATCH_BYTES) return;

  const constCol: Float64Array[] = [];
  const constScalar = new Float64Array(nConst);
  for (let c = 0; c < nConst; c++) {
    const v = p.constValue[c];
    if (members.every((m) => m.constValue[c] === v)) {
      constScalar[c] = v;
      constCol.push(EMPTY);
      continue;
    }
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) col[i] = members[i].constValue[c];
    constCol.push(col);
  }

  const sRef: Float64Array[] = [];
  const sOwn: Float64Array[] = [];
  for (let d = 0; d < depth; d++) {
    sRef.push(EMPTY);
    sOwn.push(new Float64Array(n));
  }
  const argVec: Float64Array[] = [];
  for (let k = 0; k < maxArgc; k++) argVec.push(new Float64Array(n));

  const batch: CalcBatch = {
    p,
    n,
    constCol,
    constScalar,
    sVal: new Float64Array(depth),
    sRef,
    sOwn,
    sIsVec: new Uint8Array(depth),
    sUnit: new Uint8Array(depth),
    sValid: new Uint8Array(depth),
    argVec,
    outRef: EMPTY,
    outScalar: 0,
    outIsVec: false,
    outValid: false,
    outUnit: "",
    out: { value: 0, unit: "" },
    epoch: -1,
    ctx: null,
  };
  for (let i = 0; i < n; i++) members[i].lane = { batch, index: i };
}

/** Run every lane of a batch: one pass over the opcode stream for the frame. */
function runBatch(b: CalcBatch, ctx: CalcEvalContext): void {
  const p = b.p;
  resolveLeaves(p, ctx);

  const { code, constUnit, constValid, func, funcArgBuf } = p;
  const { leafValue, leafUnit, leafValid } = p;
  const { sVal, sRef, sOwn, sIsVec, sUnit, sValid, constCol, constScalar } = b;
  const n = b.n;
  let sp = 0;

  for (let i = 0; i < code.length; i += 2) {
    const arg = code[i + 1];
    switch (code[i]) {
      case OP_CONST: {
        sUnit[sp] = constUnit[arg];
        sValid[sp] = constValid[arg];
        const col = constCol[arg];
        if (col.length) {
          sIsVec[sp] = 1;
          sRef[sp] = col;
        } else {
          sIsVec[sp] = 0;
          sVal[sp] = constScalar[arg];
        }
        sp++;
        break;
      }
      case OP_LEAF:
        sIsVec[sp] = 0;
        sVal[sp] = leafValue[arg];
        sUnit[sp] = leafUnit[arg];
        sValid[sp] = leafValid[arg];
        sp++;
        break;
      case OP_BIN: {
        sp -= 2;
        const lu = sUnit[sp];
        const ru = sUnit[sp + 1];
        const ou = sValid[sp] && sValid[sp + 1] ? binUnit(arg, lu, ru) : -1;
        if (ou < 0) {
          sValid[sp] = 0;
          sIsVec[sp] = 0;
          sp++;
          break;
        }
        sValid[sp] = 1;
        sUnit[sp] = ou;
        const av = sIsVec[sp];
        const bv = sIsVec[sp + 1];
        if (!av && !bv) {
          sVal[sp] = binScalar(arg, sVal[sp], sVal[sp + 1]);
          sp++;
          break;
        }
        binVector(
          arg,
          sOwn[sp],
          sRef[sp],
          sVal[sp],
          av === 1,
          sRef[sp + 1],
          sVal[sp + 1],
          bv === 1,
          n,
        );
        sIsVec[sp] = 1;
        sRef[sp] = sOwn[sp];
        sp++;
        break;
      }
      case OP_FUNC: {
        const buf = funcArgBuf[arg];
        const argc = buf.length;
        sp -= argc;
        let ok = true;
        let anyVec = false;
        for (let k = 0; k < argc; k++) {
          const s = sp + k;
          if (!sValid[s]) ok = false;
          if (sIsVec[s]) anyVec = true;
          buf[k].value = sIsVec[s] ? sRef[s][0] : sVal[s];
          buf[k].unit = unitName(sUnit[s]);
        }
        // Lane 0 decides unit/validity for the slot, and is the result when no arg varies.
        const res = ok ? evalCalcFunction(func[arg], buf, p.funcOut) : null;
        if (!res) {
          sValid[sp] = 0;
          sIsVec[sp] = 0;
          sp++;
          break;
        }
        sValid[sp] = 1;
        // Set after the value pass: kernels read the argument units off these slots.
        const resUnit = unitId(res.unit);
        if (!anyVec) {
          sIsVec[sp] = 0;
          sVal[sp] = res.value;
          sUnit[sp] = resUnit;
          sp++;
          break;
        }
        const out = sOwn[sp];
        if (!funcVector(func[arg], b, sp, argc, out)) {
          for (let lane = 0; lane < n; lane++) {
            for (let k = 0; k < argc; k++) {
              const s = sp + k;
              buf[k].value = sIsVec[s] ? sRef[s][lane] : sVal[s];
            }
            const r = evalCalcFunction(func[arg], buf, p.funcOut);
            out[lane] = r ? r.value : 0;
          }
        }
        sUnit[sp] = resUnit;
        sIsVec[sp] = 1;
        sRef[sp] = out;
        sp++;
        break;
      }
    }
  }

  b.outValid = sValid[0] === 1;
  b.outUnit = unitName(sUnit[0]);
  b.outIsVec = sIsVec[0] === 1;
  b.outRef = sRef[0];
  b.outScalar = sVal[0];
}

// Loop-invariant `av`/`bv` broadcast a scalar operand without materializing it.
function binVector(
  op: number,
  out: Float64Array,
  A: Float64Array,
  as: number,
  av: boolean,
  B: Float64Array,
  bs: number,
  bv: boolean,
  n: number,
): void {
  switch (op) {
    case 0:
      for (let i = 0; i < n; i++) out[i] = (av ? A[i] : as) + (bv ? B[i] : bs);
      return;
    case 1:
      for (let i = 0; i < n; i++) out[i] = (av ? A[i] : as) - (bv ? B[i] : bs);
      return;
    case 2:
      for (let i = 0; i < n; i++) out[i] = (av ? A[i] : as) * (bv ? B[i] : bs);
      return;
    default:
      for (let i = 0; i < n; i++) out[i] = (av ? A[i] : as) / (bv ? B[i] : bs);
  }
}

/** Argument k of the function at `sp` as a lane array (scalars broadcast). */
function laneArg(b: CalcBatch, sp: number, k: number): Float64Array {
  const s = sp + k;
  if (b.sIsVec[s]) return b.sRef[s];
  const buf = b.argVec[k];
  buf.fill(b.sVal[s]);
  return buf;
}

/** Vector kernels mirroring `evalCalcFunction` values; false means loop the shared evaluator per lane. */
// NOTE: no `round()` kernel; exporting `roundTo` from the parser would allow one.
function funcVector(
  expr: CalcFunction,
  b: CalcBatch,
  sp: number,
  argc: number,
  out: Float64Array,
): boolean {
  const n = b.n;
  const a0 = laneArg(b, sp, 0);
  switch (expr.name) {
    case "sin": {
      const rad = toRadiansVec(a0, out, n, unitName(b.sUnit[sp]));
      for (let i = 0; i < n; i++) out[i] = Math.sin(rad[i]);
      return true;
    }
    case "cos": {
      const rad = toRadiansVec(a0, out, n, unitName(b.sUnit[sp]));
      for (let i = 0; i < n; i++) out[i] = Math.cos(rad[i]);
      return true;
    }
    case "tan": {
      const rad = toRadiansVec(a0, out, n, unitName(b.sUnit[sp]));
      for (let i = 0; i < n; i++) out[i] = Math.tan(rad[i]);
      return true;
    }
    case "asin":
      for (let i = 0; i < n; i++) out[i] = (Math.asin(a0[i]) * 180) / Math.PI;
      return true;
    case "acos":
      for (let i = 0; i < n; i++) out[i] = (Math.acos(a0[i]) * 180) / Math.PI;
      return true;
    case "atan":
      for (let i = 0; i < n; i++) out[i] = (Math.atan(a0[i]) * 180) / Math.PI;
      return true;
    case "atan2": {
      const a1 = laneArg(b, sp, 1);
      for (let i = 0; i < n; i++)
        out[i] = (Math.atan2(a0[i], a1[i]) * 180) / Math.PI;
      return true;
    }
    case "sqrt":
      for (let i = 0; i < n; i++) out[i] = Math.sqrt(a0[i]);
      return true;
    case "exp":
      for (let i = 0; i < n; i++) out[i] = Math.exp(a0[i]);
      return true;
    case "abs":
      for (let i = 0; i < n; i++) out[i] = Math.abs(a0[i]);
      return true;
    case "sign":
      for (let i = 0; i < n; i++) out[i] = Math.sign(a0[i]);
      return true;
    case "pow": {
      const a1 = laneArg(b, sp, 1);
      for (let i = 0; i < n; i++) out[i] = a0[i] ** a1[i];
      return true;
    }
    case "log": {
      if (argc < 2) {
        for (let i = 0; i < n; i++) out[i] = Math.log(a0[i]);
        return true;
      }
      const a1 = laneArg(b, sp, 1);
      for (let i = 0; i < n; i++) out[i] = Math.log(a0[i]) / Math.log(a1[i]);
      return true;
    }
    case "mod": {
      const a1 = laneArg(b, sp, 1);
      for (let i = 0; i < n; i++)
        out[i] = a0[i] - a1[i] * Math.floor(a0[i] / a1[i]);
      return true;
    }
    case "rem": {
      const a1 = laneArg(b, sp, 1);
      for (let i = 0; i < n; i++) out[i] = a0[i] % a1[i];
      return true;
    }
    case "clamp": {
      const a1 = laneArg(b, sp, 1);
      const a2 = laneArg(b, sp, 2);
      for (let i = 0; i < n; i++)
        out[i] = Math.max(a0[i], Math.min(a1[i], a2[i]));
      return true;
    }
    case "min":
    case "max": {
      const args: Float64Array[] = [a0];
      for (let k = 1; k < argc; k++) args.push(laneArg(b, sp, k));
      const reduce = expr.name === "min" ? Math.min : Math.max;
      for (let i = 0; i < n; i++) {
        let acc = a0[i];
        for (let k = 1; k < argc; k++) acc = reduce(acc, args[k][i]);
        out[i] = acc;
      }
      return true;
    }
    // Math.hypot to match the evaluator's rounding; fixed arities only to avoid per-lane spreads.
    case "hypot": {
      if (argc === 1) {
        for (let i = 0; i < n; i++) out[i] = Math.hypot(a0[i]);
        return true;
      }
      if (argc === 2) {
        const a1 = laneArg(b, sp, 1);
        for (let i = 0; i < n; i++) out[i] = Math.hypot(a0[i], a1[i]);
        return true;
      }
      if (argc === 3) {
        const a1 = laneArg(b, sp, 1);
        const a2 = laneArg(b, sp, 2);
        for (let i = 0; i < n; i++) out[i] = Math.hypot(a0[i], a1[i], a2[i]);
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/** Radians, written exactly as `toRadians` (association matters to the last ulp); unitless/rad pass through. */
function toRadiansVec(
  a: Float64Array,
  scratch: Float64Array,
  n: number,
  unit: string,
): Float64Array {
  switch (unit) {
    case "deg":
      for (let i = 0; i < n; i++) scratch[i] = (a[i] * Math.PI) / 180;
      return scratch;
    case "grad":
      for (let i = 0; i < n; i++) scratch[i] = (a[i] * Math.PI) / 200;
      return scratch;
    case "turn":
      for (let i = 0; i < n; i++) scratch[i] = a[i] * 2 * Math.PI;
      return scratch;
    default:
      return a;
  }
}
