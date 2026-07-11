/**
 * Serialize a {@link StyleSheet} AST back to Popkorn DSL source.
 *
 * Two modes:
 *  - pretty  (default): 2-space indent, one declaration per line, blank line
 *    between top-level blocks — matches the style of `examples/popkorn/*.css`.
 *  - minify: no comments, no optional whitespace, no trailing `;` before `}`.
 *
 * Both are value-preserving: `parse(serialize(parse(src)))` deep-equals
 * `parse(src)`. Number forms are shortened only where that does not change the
 * parsed value (`1.50`→`1.5`, `2.0`→`2`); colors are emitted verbatim because
 * the AST stores the raw color string and collapsing it (`#ffcc00`→`#fc0`)
 * would make the re-parsed value differ.
 */

import type {
  CalcExpr,
  CanvasConfig,
  Declaration,
  DefinitionRule,
  KeyframeBlock,
  KeyframeRule,
  MachineGuard,
  MachineRule,
  MachineState,
  MachineTransition,
  MachineTrigger,
  Rule,
  Selector,
  Span,
  StateRule,
  StyleSheet,
  Value,
  VariableDefinition,
} from "./ast";
import { crush } from "./crush";

// Synthetic declarations exist only to be printed (fmtDecl reads property +
// value, never the span), so they carry a zero source span.
const NO_SPAN: Span = { start: 0, end: 0 };

export interface SerializeOptions {
  minify?: boolean;
  // Destructive: rename identifiers (ids, classes, @keyframes, @define,
  // custom properties) to short meaningless names. Implies `minify`. The output
  // renders identically but is no longer human-readable — see crush().
  crush?: boolean;
}

export function serialize(
  sheet: StyleSheet,
  opts: SerializeOptions = {},
): string {
  if (opts.crush) sheet = crush(sheet);
  const min = opts.minify ?? opts.crush ?? false;
  const blocks: string[] = [];

  if (sheet.canvas || sheet.variables.length)
    blocks.push(rootBlock(sheet.canvas, sheet.variables, min));
  for (const kf of sheet.keyframes) blocks.push(keyframesBlock(kf, min));
  for (const def of sheet.definitions) blocks.push(defineBlock(def, min));
  for (const m of sheet.machines) blocks.push(machineBlock(m, min));
  for (const rule of sheet.rules) blocks.push(ruleBlock(rule, min, 0));

  return min ? blocks.join("") : blocks.join("\n\n") + "\n";
}

// --- number / value formatting -------------------------------------------

function num(n: number): string {
  if (Number.isInteger(n)) return String(n);
  let s = String(n);
  // Guard against exponential notation the parser can't read.
  if (s.includes("e") || s.includes("E"))
    s = n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

function fmtValue(v: Value, min: boolean): string {
  switch (v.type) {
    case "length":
      return num(v.value) + v.unit;
    case "number":
      return num(v.value);
    case "color":
      return v.value;
    case "keyword":
      return v.value;
    case "string": {
      const q = v.value.includes('"') ? "'" : '"';
      return q + v.value + q;
    }
    case "variable":
      return `var(${v.name})`;
    case "calc":
      // A bare min()/max()/clamp() serializes as itself, not `calc(min(...))`.
      return v.expr.type === "calc-function"
        ? fmtCalc(v.expr, min)
        : `calc(${fmtCalc(v.expr, min)})`;
    case "function": {
      const sep = min ? "," : ", ";
      return `${v.name}(${v.args.map((a) => fmtValue(a, min)).join(sep)})`;
    }
    case "list": {
      // Space-separated by default; a 'comma' list (e.g. multi-value `animation`)
      // rejoins with commas so it round-trips back to distinct groups.
      const sep = v.separator === "comma" ? (min ? "," : ", ") : " ";
      return v.values.map((a) => fmtValue(a, min)).join(sep);
    }
  }
}

// A calc() expression. `+`/`-` always keep surrounding spaces (CSS requires
// them, even minified); `*`/`/` drop them when minifying. Every binary node is
// parenthesized so precedence round-trips exactly.
function fmtCalc(expr: CalcExpr, min: boolean): string {
  if (expr.type === "calc-operand") return fmtValue(expr.value, min);
  if (expr.type === "calc-function") {
    const args = expr.args.map((a) => fmtCalc(a, min)).join(min ? "," : ", ");
    return `${expr.name}(${args})`;
  }
  const l = fmtCalc(expr.left, min);
  const r = fmtCalc(expr.right, min);
  const sp = expr.op === "+" || expr.op === "-" ? " " : min ? "" : " ";
  return `(${l}${sp}${expr.op}${sp}${r})`;
}

function fmtDecl(d: Declaration, min: boolean): string {
  return min
    ? `${d.property}:${fmtValue(d.value, min)}`
    : `${d.property}: ${fmtValue(d.value, min)}`;
}

// --- selectors ------------------------------------------------------------

function fmtSelector(sel: Selector): string {
  switch (sel.type) {
    case "id":
      return "#" + sel.name;
    case "class":
      return "." + sel.name;
    case "root":
      return ":root";
  }
}

// `&:hover` / `&:active`, or a machine `&:state(name)` / `&:state(machine.name)`.
function stateSelector(st: StateRule): string {
  if (st.state === "state" && st.machineState) {
    const { machine, name } = st.machineState;
    return `&:state(${machine ? `${machine}.${name}` : name})`;
  }
  return `&:${st.state}`;
}

// --- blocks ---------------------------------------------------------------

interface Body {
  declarations: Declaration[];
  children: Rule[];
  states: StateRule[];
}

/** Emit `<prelude> { <body> }` for a rule/definition-style block. */
function block(
  prelude: string,
  body: Body,
  min: boolean,
  depth: number,
): string {
  if (min) {
    const items: string[] = [];
    const { declarations, children, states } = body;
    const hasBlocks = children.length > 0 || states.length > 0;
    declarations.forEach((d, i) => {
      const last = i === declarations.length - 1 && !hasBlocks;
      items.push(fmtDecl(d, true) + (last ? "" : ";"));
    });
    for (const ch of children) items.push(">" + ruleBlock(ch, true, 0));
    for (const st of states)
      items.push(
        stateSelector(st) +
          block(
            "",
            {
              declarations: st.declarations,
              children: st.children,
              states: [],
            },
            true,
            0,
          ),
      );
    return `${prelude}{${items.join("")}}`;
  }

  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  const lines: string[] = [];
  for (const d of body.declarations)
    lines.push(inner + fmtDecl(d, false) + ";");
  for (const ch of body.children) {
    lines.push("");
    lines.push(
      inner + "> " + ruleBlock(ch, false, depth + 1).slice(inner.length),
    );
  }
  for (const st of body.states) {
    lines.push("");
    lines.push(
      inner +
        block(
          stateSelector(st),
          { declarations: st.declarations, children: st.children, states: [] },
          false,
          depth + 1,
        ).slice(inner.length),
    );
  }
  return `${pad}${prelude} {\n${lines.join("\n")}\n${pad}}`;
}

function ruleBlock(rule: Rule, min: boolean, depth: number): string {
  return block(fmtSelector(rule.selector), rule, min, depth);
}

function defineBlock(def: DefinitionRule, min: boolean): string {
  return block(`@define ${def.name}`, def, min, 0);
}

// `:root` carries stage config (width/height/background) followed by custom
// properties, so it round-trips back to the same StyleSheet on re-parse.
function rootBlock(
  cfg: CanvasConfig | undefined,
  vars: VariableDefinition[],
  min: boolean,
): string {
  const decls: Declaration[] = [];
  if (cfg) {
    decls.push({
      type: "declaration",
      property: "width",
      value: { type: "length", value: cfg.width, unit: "px" },
      span: NO_SPAN,
      valueSpan: NO_SPAN,
    });
    decls.push({
      type: "declaration",
      property: "height",
      value: { type: "length", value: cfg.height, unit: "px" },
      span: NO_SPAN,
      valueSpan: NO_SPAN,
    });
    if (cfg.background !== undefined) {
      decls.push({
        type: "declaration",
        property: "background",
        value: { type: "color", value: cfg.background },
        span: NO_SPAN,
        valueSpan: NO_SPAN,
      });
    }
    if (cfg.overflow !== undefined) {
      decls.push({
        type: "declaration",
        property: "overflow",
        value: { type: "keyword", value: cfg.overflow },
        span: NO_SPAN,
        valueSpan: NO_SPAN,
      });
    }
  }
  for (const v of vars)
    decls.push({
      type: "declaration",
      property: v.name,
      value: v.value,
      span: NO_SPAN,
      valueSpan: NO_SPAN,
    });
  return block(
    ":root",
    { declarations: decls, children: [], states: [] },
    min,
    0,
  );
}

function keyframesBlock(kf: KeyframeRule, min: boolean): string {
  const blocks = kf.blocks.map((b) => keyframeBlock(b, min));
  if (min) return `@keyframes ${kf.name}{${blocks.join("")}}`;
  return `@keyframes ${kf.name} {\n${blocks.map((b) => "  " + b).join("\n")}\n}`;
}

function keyframeBlock(b: KeyframeBlock, min: boolean): string {
  const sel = b.selectors.map((s) => num(s) + "%").join(min ? "," : ", ");
  const decls = b.declarations.slice();
  if (b.easing) {
    decls.push({
      type: "declaration",
      property: "animation-timing-function",
      value: b.easing,
      span: NO_SPAN,
      valueSpan: NO_SPAN,
    });
  }
  if (min) {
    const body = decls.map((d) => fmtDecl(d, true)).join(";");
    return `${sel}{${body}}`;
  }
  const body = decls.map((d) => fmtDecl(d, false) + ";").join(" ");
  return `${sel} { ${body} }`;
}

// --- state machines (@machine) --------------------------------------------

function machineBlock(m: MachineRule, min: boolean): string {
  const states = m.states.map((s) => machineState(s, min));
  if (min) return `@machine ${m.name}{initial:${m.initial};${states.join("")}}`;
  const body = [
    `  initial: ${m.initial};`,
    ...states.map((s) => "\n" + indent(s)),
  ].join("\n");
  return `@machine ${m.name} {\n${body}\n}`;
}

function machineState(s: MachineState, min: boolean): string {
  const header = s.name === "*" ? "*" : s.name;
  const items: string[] = [];
  for (const t of s.transitions) items.push("to: " + transition(t));
  for (const e of s.emits) items.push("emit: " + e);
  if (min) return `state ${header}{${items.join(";")}}`;
  const inner = items.map((i) => "  " + i + ";").join("\n");
  return `state ${header} {\n${inner}\n}`;
}

// `<state> [on <trigger>] [when style(<g>) [and style(<g>)]*] [mix <dur> [<easing>]]`.
// Clauses are space-joined in both modes: keyword boundaries need the whitespace
// (`to:Xon` would tokenize as one ident), and the round-trip is value-, not
// byte-preserving.
function transition(t: MachineTransition): string {
  let s = t.to;
  if (t.trigger) s += " on " + trigger(t.trigger);
  if (t.guards.length)
    s += " when " + t.guards.map((g) => `style(${guard(g)})`).join(" and ");
  if (t.mix)
    s +=
      ` mix ${num(t.mix.duration)}ms` +
      (t.mix.easing ? " " + t.mix.easing : "");
  return s;
}

function trigger(tr: MachineTrigger): string {
  if (tr.kind === "complete") return "complete";
  if (tr.kind === "event") return `event(${tr.name})`;
  const target = tr.target.type === "root" ? ":root" : "#" + tr.target.name;
  return `${tr.event}(${target})`;
}

function guard(g: MachineGuard): string {
  return `${guardOperand(g.left)} ${g.op} ${guardValue(g.right, g.left.kind === "state-time")}`;
}

function guardOperand(l: MachineGuard["left"]): string {
  if (l.kind === "var") return l.name; // `--name`, dashes included
  if (l.kind === "input") return `input(${l.path})`;
  return "state-time";
}

// `state-time` right-values are milliseconds; re-suffix so they read naturally
// (bare numbers also re-parse identically, so this is cosmetic).
function guardValue(v: number | boolean | string, isTime: boolean): string {
  if (typeof v === "number") return isTime ? num(v) + "ms" : num(v);
  if (typeof v === "boolean") return String(v);
  return v;
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");
}
