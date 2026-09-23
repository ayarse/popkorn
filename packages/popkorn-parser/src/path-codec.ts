// SVG path data codec: strict absolute decode (mirrors the player's parsePath) and compact re-encode.

/** One command with absolute coordinates; arc flags are 0/1, M's implicit repeats are L. */
export interface PathSeg {
  cmd: string;
  args: number[];
}

// Arg slots per command: x/y shift by the current point when relative, f is an arc flag, n is plain.
const SLOTS: Record<string, string> = {
  M: "xy",
  L: "xy",
  H: "x",
  V: "y",
  C: "xyxyxy",
  S: "xyxy",
  Q: "xyxy",
  T: "xy",
  A: "nnnffxy",
  Z: "",
};

const TOKEN =
  /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;

// Tokens, or null when anything but whitespace/commas sits between them.
function tokenize(d: string): string[] | null {
  const out: string[] = [];
  let last = 0;
  for (const m of d.matchAll(TOKEN)) {
    if (!/^[\s,]*$/.test(d.slice(last, m.index))) return null;
    out.push(m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  return /^[\s,]*$/.test(d.slice(last)) ? out : null;
}

/** Absolute segments, or null unless the whole string is well-formed path data. */
export function decodePath(d: string): PathSeg[] | null {
  const tokens = tokenize(d);
  if (!tokens || tokens.length === 0) return null;
  const segs: PathSeg[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const isNum = (t: string | undefined) =>
    t !== undefined && !(t.toUpperCase() in SLOTS);

  while (i < tokens.length) {
    const letter = tokens[i++];
    const cmd = letter.toUpperCase();
    const slots = SLOTS[cmd];
    if (slots === undefined) return null;
    if (cmd === "Z") {
      segs.push({ cmd, args: [] });
      cx = sx;
      cy = sy;
      continue;
    }
    const rel = letter !== cmd;
    let type = cmd;
    let first = true;
    while (first || isNum(tokens[i])) {
      const args: number[] = [];
      for (const slot of slots) {
        const tok = tokens[i];
        if (!isNum(tok)) return null;
        if (slot === "f") {
          // Compact notation glues flags onto the next number (`011.5` = 0,1,1.5).
          if (tok[0] !== "0" && tok[0] !== "1") return null;
          args.push(tok[0] === "1" ? 1 : 0);
          if (tok.length > 1) tokens[i] = tok.slice(1);
          else i++;
          continue;
        }
        const v = parseFloat(tok);
        i++;
        args.push(!rel || slot === "n" ? v : slot === "x" ? cx + v : cy + v);
      }
      segs.push({ cmd: type, args });
      const xi = slots.lastIndexOf("x");
      const yi = slots.lastIndexOf("y");
      if (xi >= 0) cx = args[xi];
      if (yi >= 0) cy = args[yi];
      if (type === "M") {
        sx = cx;
        sy = cy;
      }
      if (first && cmd === "M") type = "L";
      first = false;
    }
  }
  return segs;
}

// Fewest decimals that keep ~4 significant digits of the path's larger axis extent, never below `min`.
function pickDecimals(segs: PathSeg[], min: number): number {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const s of segs) {
    const slots = SLOTS[s.cmd];
    for (let k = 0; k < slots.length; k++) {
      const axis = slots[k] === "x" ? 0 : slots[k] === "y" ? 1 : -1;
      if (axis < 0) continue;
      lo[axis] = Math.min(lo[axis], s.args[k]);
      hi[axis] = Math.max(hi[axis], s.args[k]);
    }
  }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  if (!(extent > 0) || !Number.isFinite(extent)) return min;
  return Math.min(8, Math.max(min, 3 - Math.floor(Math.log10(extent))));
}

// `-0.50` → `-.5`, `0.00` → `0`.
function fmt(v: number, dec: number): string {
  let s = v.toFixed(dec);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") return "0";
  return s.replace(/^(-?)0\./, "$1.");
}

// Appends number tokens with the fewest separators the player's tokenizer still splits correctly.
class Writer {
  out = "";
  private run = ""; // the tokenizer token the next glued char would extend
  private prevFlag = false;
  letter(c: string): void {
    this.out += c;
    this.run = "";
    this.prevFlag = false;
  }
  num(t: string, flag = false): void {
    if (this.run === "") this.run = t;
    else if (this.prevFlag) this.run += t;
    else if (!flag && t[0] === "-") this.run = t;
    else if (!flag && t[0] === "." && this.run.includes(".")) this.run = t;
    else {
      this.out += " ";
      this.run = t;
    }
    this.out += t;
    this.prevFlag = flag;
  }
  clone(): Writer {
    const w = new Writer();
    w.out = this.out;
    w.run = this.run;
    w.prevFlag = this.prevFlag;
    return w;
  }
}

/**
 * Re-encode `d` compactly: per command the shorter of absolute/relative, minimal separators,
 * coordinates rounded (≥ `decimals`, more for tiny paths). Command types and count are kept.
 * Relative deltas are taken from the rounded previous point, so rounding never accumulates.
 * Returns `d` unchanged if it doesn't parse fully.
 */
export function compactPath(d: string, decimals = 2): string {
  const segs = decodePath(d);
  if (!segs) return d;
  const dec = pickDecimals(segs, decimals);
  const round = (v: number) => parseFloat(v.toFixed(dec));

  let w = new Writer();
  let implicit = ""; // letter an omitted command letter would repeat as
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const s of segs) {
    if (s.cmd === "Z") {
      w.letter("z");
      implicit = "";
      cx = sx;
      cy = sy;
      continue;
    }
    const slots = SLOTS[s.cmd];
    const abs = s.args.map((v, k) => (slots[k] === "f" ? v : round(v)));
    const emit = (rel: boolean): Writer => {
      const letter = rel ? s.cmd.toLowerCase() : s.cmd;
      const cw = w.clone();
      if (letter !== implicit) cw.letter(letter);
      for (let k = 0; k < slots.length; k++) {
        const slot = slots[k];
        if (slot === "f") cw.num(String(abs[k]), true);
        else {
          const base = !rel || slot === "n" ? 0 : slot === "x" ? cx : cy;
          cw.num(fmt(abs[k] - base, dec));
        }
      }
      return cw;
    };
    const a = emit(false);
    const r = emit(true);
    const rel = r.out.length <= a.out.length;
    w = rel ? r : a;
    const letter = rel ? s.cmd.toLowerCase() : s.cmd;
    implicit = letter === "M" ? "L" : letter === "m" ? "l" : letter;
    const xi = slots.lastIndexOf("x");
    const yi = slots.lastIndexOf("y");
    if (xi >= 0) cx = abs[xi];
    if (yi >= 0) cy = abs[yi];
    if (s.cmd === "M") {
      sx = cx;
      sy = cy;
    }
  }
  return verify(segs, w.out, dec) && w.out.length <= d.length ? w.out : d;
}

// Encoder self-check: same commands, every value within half a unit in the last kept decimal.
function verify(orig: PathSeg[], out: string, dec: number): boolean {
  const back = decodePath(out);
  if (!back || back.length !== orig.length) return false;
  const tol = 0.5 * 10 ** -dec + 1e-9;
  return orig.every(
    (s, i) =>
      back[i].cmd === s.cmd &&
      back[i].args.length === s.args.length &&
      s.args.every((v, k) => Math.abs(back[i].args[k] - v) <= tol),
  );
}
