/**
 * Hand-rolled parser for the Popkorn DSL.
 *
 * A tokenizing recursive-descent parser that turns CSS-like source directly
 * into the {@link StyleSheet} AST. Synchronous, zero-dependency — the DSL is a
 * small CSS subset, so a dedicated grammar/parser-generator would be far more
 * machinery than the language needs.
 */

import type {
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
  PseudoState,
  Rule,
  Selector,
  StateRule,
  StyleSheet,
  Value,
  VariableDefinition,
} from "./ast";

const IDENT = /[a-zA-Z_][a-zA-Z0-9_-]*/y;
const CUSTOM = /--[a-zA-Z_][a-zA-Z0-9_-]*/y;
// Accept a leading-dot fraction (`.5`) as well as `10` / `10.5` — CSS allows it
// and minifiers (esbuild) emit it by stripping the leading zero.
const NUMBER = /-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/y;
// The trailing boundary matters: without it `#Background` would greedily lex as
// the hex color `#Bac` (B,a,c are hex) with `kground…` left dangling, instead of
// a node-id reference (`mask: #Background-…`). A real hex color is never
// followed by another identifier char, so require a non-[\w-] boundary after it.
const COLOR = /#[0-9a-fA-F]{3,8}(?![\w-])/y;
// Longest-first so 'ms' beats 's' and 'rem' beats 'em'.
const UNITS = ["deg", "rem", "px", "em", "ms", "s"] as const;

class Cursor {
  pos = 0;
  constructor(readonly src: string) {}

  /** Skip whitespace and `/* *\/` comments. */
  ws(): void {
    for (;;) {
      const c = this.src[this.pos];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.pos++;
        continue;
      }
      if (c === "/" && this.src[this.pos + 1] === "*") {
        this.pos += 2;
        while (
          this.pos < this.src.length &&
          !(this.src[this.pos] === "*" && this.src[this.pos + 1] === "/")
        )
          this.pos++;
        this.pos += 2;
        continue;
      }
      break;
    }
  }

  eof(): boolean {
    this.ws();
    return this.pos >= this.src.length;
  }
  peek(): string {
    this.ws();
    return this.src[this.pos];
  }

  eat(str: string): boolean {
    this.ws();
    if (this.src.startsWith(str, this.pos)) {
      this.pos += str.length;
      return true;
    }
    return false;
  }

  expect(str: string): void {
    if (!this.eat(str)) throw new Error(this.errorAt(`expected '${str}'`));
  }

  /** Match a sticky regex anchored at the current position (after whitespace). */
  match(re: RegExp): string | null {
    this.ws();
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (m && m.index === this.pos) {
      this.pos += m[0].length;
      return m[0];
    }
    return null;
  }

  ident(): string {
    const m = this.match(IDENT);
    if (m === null) throw new Error(this.errorAt("expected identifier"));
    return m;
  }

  errorAt(what: string): string {
    return `${what} at offset ${this.pos}: ${JSON.stringify(this.src.slice(this.pos, this.pos + 24))}`;
  }
}

/** Parse Popkorn DSL source into a {@link StyleSheet} AST. */
export function parse(source: string): StyleSheet {
  const c = new Cursor(source);
  const sheet: StyleSheet = {
    type: "stylesheet",
    rules: [],
    keyframes: [],
    definitions: [],
    machines: [],
    variables: [],
  };

  while (!c.eof()) {
    if (c.eat("@keyframes")) {
      sheet.keyframes.push(parseKeyframes(c));
      continue;
    }
    if (c.eat("@define")) {
      sheet.definitions.push(parseDefine(c));
      continue;
    }
    if (c.eat("@machine")) {
      sheet.machines.push(parseMachine(c));
      continue;
    }
    const rule = parseRule(c);
    if (rule.selector.type === "root") {
      // `:root` holds both stage config (width/height/background) and custom
      // properties. `canvas` stays undefined when only variables are declared,
      // so the component keeps falling back to its width/height attributes.
      const cfg = extractCanvas(rule);
      if (cfg) sheet.canvas = cfg;
      sheet.variables = extractVariables(rule);
    } else sheet.rules.push(rule);
  }
  return sheet;
}

function parseSelector(c: Cursor): Selector {
  const ch = c.peek();
  if (ch === "#") {
    c.expect("#");
    return { type: "id", name: c.ident() };
  }
  if (ch === ".") {
    c.expect(".");
    return { type: "class", name: c.ident() };
  }
  if (ch === ":") {
    c.expect(":");
    const kw = c.ident();
    if (kw === "root") return { type: "root", name: "root" };
    throw new Error(`unknown selector ':${kw}'`);
  }
  throw new Error(c.errorAt("expected a selector"));
}

function parseRule(c: Cursor): Rule {
  const selector = parseSelector(c);
  return { type: "rule", selector, ...parseRuleBody(c) };
}

// `@define <name> { <rule body> }` — same body grammar as a rule.
function parseDefine(c: Cursor): DefinitionRule {
  const name = c.ident();
  return { type: "definition", name, ...parseRuleBody(c) };
}

// `@machine <name> { initial: <s>; state <s> { ... } }`. Concurrent machines,
// one at-rule each. Body is `initial:` plus `state` blocks; a state block holds
// only `to:` transitions and `emit:` events.
function parseMachine(c: Cursor): MachineRule {
  const name = c.ident();
  c.expect("{");
  let initial = "";
  const states: MachineState[] = [];
  while (!c.eat("}")) {
    if (c.eat("state")) {
      states.push(parseMachineState(c));
    } else {
      // The only non-`state` line is `initial: <name>;`.
      const prop = c.ident();
      c.expect(":");
      const value = c.ident();
      c.eat(";");
      if (prop !== "initial")
        throw new Error(
          c.errorAt(
            `unexpected '${prop}' in @machine body (want 'initial' or 'state')`,
          ),
        );
      initial = value;
    }
  }
  return { type: "machine", name, initial, states };
}

// `state <name> { to: ...; emit: ...; }` — `state *` is the any-state block.
function parseMachineState(c: Cursor): MachineState {
  const name = c.eat("*") ? "*" : c.ident();
  c.expect("{");
  const transitions: MachineTransition[] = [];
  const emits: string[] = [];
  while (!c.eat("}")) {
    const prop = c.ident();
    c.expect(":");
    if (prop === "to") transitions.push(parseTransition(c));
    else if (prop === "emit") {
      emits.push(c.ident());
      c.eat(";");
    } else
      throw new Error(
        c.errorAt(`unexpected '${prop}' in state block (want 'to' or 'emit')`),
      );
  }
  return { name, transitions, emits };
}

// `<state> [on <trigger>] [when style(<g>) [and style(<g>)]*] [mix <dur> [<easing>]];`
// The leading `to:` has already been consumed. Clause order is fixed by the grammar.
function parseTransition(c: Cursor): MachineTransition {
  const to = c.ident();
  let trigger: MachineTrigger | null = null;
  const guards: MachineGuard[] = [];
  let mix: { duration: number; easing: string | null } | null = null;

  if (c.eat("on")) trigger = parseTrigger(c);
  if (c.eat("when")) {
    do {
      c.expect("style");
      c.expect("(");
      guards.push(parseGuard(c));
      c.expect(")");
    } while (c.eat("and"));
  }
  if (c.eat("mix")) {
    const duration = readTime(c);
    c.ws();
    // Optional easing: slurp verbatim to the terminator (handles `ease-in-out`,
    // `linear`, `cubic-bezier(...)`, `steps(...)`). `mix` is the last clause.
    const start = c.pos;
    while (c.pos < c.src.length && c.src[c.pos] !== ";" && c.src[c.pos] !== "}")
      c.pos++;
    const raw = c.src.slice(start, c.pos).trim();
    mix = { duration, easing: raw.length ? raw : null };
  }
  c.eat(";");
  return { to, trigger, guards, mix };
}

// `click(#id)` / `pointerup(:root)` / `complete` / `event(name)`.
function parseTrigger(c: Cursor): MachineTrigger {
  const name = c.ident();
  if (name === "complete") return { kind: "complete" };
  c.expect("(");
  if (name === "event") {
    const evName = c.ident();
    c.expect(")");
    return { kind: "event", name: evName };
  }
  let target: { type: "id" | "root"; name: string };
  if (c.eat("#")) target = { type: "id", name: c.ident() };
  else if (c.eat(":")) {
    const kw = c.ident();
    if (kw !== "root") throw new Error(`unknown pointer target ':${kw}'`);
    target = { type: "root", name: "root" };
  } else throw new Error(c.errorAt("expected #id or :root pointer target"));
  c.expect(")");
  return {
    kind: "pointer",
    event: name as (MachineTrigger & { kind: "pointer" })["event"],
    target,
  };
}

// A single flat comparison: `<operand> <op> <value>`. `:` reads as equality.
function parseGuard(c: Cursor): MachineGuard {
  const left = parseGuardOperand(c);
  const op = parseGuardOp(c);
  const right = parseGuardValue(c);
  return { left, op, right };
}

function parseGuardOperand(c: Cursor): MachineGuard["left"] {
  const custom = c.match(CUSTOM);
  if (custom) return { kind: "var", name: custom };
  const name = c.ident();
  if (name === "input") {
    c.expect("(");
    let path = c.ident();
    while (c.eat(".")) path += "." + c.ident();
    c.expect(")");
    return { kind: "input", path };
  }
  if (name === "state-time") return { kind: "state-time" };
  throw new Error(
    c.errorAt(`expected --var, input(...), or state-time, got '${name}'`),
  );
}

function parseGuardOp(c: Cursor): MachineGuard["op"] {
  if (c.eat("<=")) return "<=";
  if (c.eat(">=")) return ">=";
  if (c.eat("!=")) return "!=";
  if (c.eat("<")) return "<";
  if (c.eat(">")) return ">";
  if (c.eat("=")) return "=";
  if (c.eat(":")) return "="; // CSS style() equality form: `style(--mood: happy)`
  throw new Error(c.errorAt("expected a comparison operator"));
}

function parseGuardValue(c: Cursor): number | boolean | string {
  const ch = c.peek();
  if (isNumberStart(c, ch)) return readTime(c);
  const kw = c.ident();
  if (kw === "true") return true;
  if (kw === "false") return false;
  return kw;
}

// Read a number with an optional time unit, normalizing to milliseconds
// (`500ms` → 500, `2s` → 2000). Unitless is returned as-is.
function readTime(c: Cursor): number {
  const n = parseFloat(c.match(NUMBER)!);
  if (c.src.startsWith("ms", c.pos)) {
    c.pos += 2;
    return n;
  }
  if (c.src[c.pos] === "s") {
    c.pos++;
    return n * 1000;
  }
  return n;
}

/** Parse `{ decls, > children, &:state blocks }` shared by rules and @define. */
function parseRuleBody(c: Cursor): {
  declarations: Declaration[];
  children: Rule[];
  states: StateRule[];
} {
  c.expect("{");
  const declarations: Declaration[] = [];
  const children: Rule[] = [];
  const states: StateRule[] = [];

  while (!c.eat("}")) {
    if (c.eat(">")) {
      // Nested child rule: `> #child { ... }`
      children.push(parseRule(c));
    } else if (c.eat("&")) {
      // Pseudo-class state: `&:hover` / `&:active`, or a machine `&:state(name)`
      // / `&:state(machine.name)` block. The block may contain `> #child { ... }`
      // rules that style a direct descendant while the parent is in that state.
      c.expect(":");
      const kw = c.ident();
      if (kw === "state") {
        c.expect("(");
        const first = c.ident();
        // `:state(machine.name)` namespaces the state; `:state(name)` doesn't.
        const machineState = c.eat(".")
          ? { machine: first, name: c.ident() }
          : { machine: null, name: first };
        c.expect(")");
        states.push({ state: "state", machineState, ...parseStateBlock(c) });
      } else {
        states.push({ state: kw as PseudoState, ...parseStateBlock(c) });
      }
    } else {
      declarations.push(parseDeclaration(c));
    }
  }
  return { declarations, children, states };
}

/** Parse a `&:state { decls, > children }` block. Same shape as a rule body but
 * without nested `&:state` — a state block styles the node and, via `>` rules,
 * its direct descendants; it does not carry states of its own. */
function parseStateBlock(c: Cursor): {
  declarations: Declaration[];
  children: Rule[];
} {
  c.expect("{");
  const declarations: Declaration[] = [];
  const children: Rule[] = [];
  while (!c.eat("}")) {
    if (c.eat(">")) children.push(parseRule(c));
    else declarations.push(parseDeclaration(c));
  }
  return { declarations, children };
}

function parseDeclaration(c: Cursor): Declaration {
  const property = c.match(CUSTOM) ?? c.ident();
  c.expect(":");
  // A value is one or more comma-separated groups, each a space-separated list
  // (CSS `animation: a 1s, b 2s`). Comma-free values keep the old shape exactly:
  // a lone value, or a plain space `list` with no separator.
  const groups: Value[] = [];
  for (;;) {
    const values = parseValueList(c);
    groups.push(values.length === 1 ? values[0] : { type: "list", values });
    if (!c.eat(",")) break;
  }
  c.eat(";"); // optional trailing semicolon
  return {
    type: "declaration",
    property,
    value:
      groups.length === 1
        ? groups[0]
        : { type: "list", values: groups, separator: "comma" },
  };
}

function parseValueList(c: Cursor): Value[] {
  const values: Value[] = [];
  for (;;) {
    const ch = c.peek();
    if (
      ch === undefined ||
      ch === ";" ||
      ch === "}" ||
      ch === ")" ||
      ch === ","
    )
      break;
    values.push(parseValue(c));
  }
  return values;
}

function parseValue(c: Cursor): Value {
  const ch = c.peek();

  if (ch === "#") {
    // A hex color, or — when the hash isn't hex (e.g. `#myLayer`) — a reference
    // to a node id (used by `mask: #id ...`). Kept as a keyword so no new AST
    // node kind is needed; the builder strips the leading '#'.
    const col = c.match(COLOR);
    if (col) return { type: "color", value: col };
    c.expect("#");
    return { type: "keyword", value: "#" + c.ident() };
  }
  if (ch === '"' || ch === "'") return readString(c, ch);
  if (isNumberStart(c, ch)) return readNumber(c);

  // Identifier-led: var(), function call, member expression, or bare keyword.
  const name = c.ident();
  if (name === "var" && c.peek() === "(") {
    c.expect("(");
    const varName = c.match(CUSTOM)!;
    let fallback: Value | undefined;
    if (c.eat(",")) {
      // Fallback is a single value; nested var()/input() are allowed since
      // parseValue already handles those, but a fallback-of-a-fallback list
      // (`var(--x, 1px, 2px)`) is NOT supported — CSS's comma-list fallback
      // form is out of scope here (fine-grained property parsing doesn't
      // need it). Tolerate a trailing comma with no fallback value.
      if (c.peek() !== ")") fallback = parseValue(c);
    }
    c.expect(")");
    return { type: "variable", name: varName, fallback };
  }
  if (c.peek() === "(") {
    c.expect("(");
    const args: Value[] = [];
    while (!c.eat(")")) {
      if (c.eat(",")) continue;
      args.push(parseValue(c));
    }
    return { type: "function", name, args };
  }
  if (c.peek() === ".") {
    // Member expression, e.g. `cursor.x`.
    c.expect(".");
    return { type: "keyword", value: `${name}.${c.ident()}` };
  }
  return { type: "keyword", value: name };
}

function readString(c: Cursor, quote: string): Value {
  c.expect(quote);
  let out = "";
  while (c.pos < c.src.length && c.src[c.pos] !== quote) out += c.src[c.pos++];
  c.pos++; // closing quote
  return { type: "string", value: out };
}

function isNumberStart(c: Cursor, ch: string): boolean {
  if (ch >= "0" && ch <= "9") return true;
  // A leading-dot (`.5`) or signed number (`-5`, `-.5`); look one char ahead.
  if (ch === "-" || ch === ".") {
    let n = c.src[c.pos + 1];
    if (ch === "-" && n === ".") n = c.src[c.pos + 2];
    return n >= "0" && n <= "9";
  }
  return false;
}

function readNumber(c: Cursor): Value {
  const value = parseFloat(c.match(NUMBER)!);
  if (c.src[c.pos] === "%") {
    c.pos++;
    return { type: "length", value, unit: "%" };
  }
  for (const u of UNITS) {
    if (c.src.startsWith(u, c.pos)) {
      c.pos += u.length;
      return { type: "length", value, unit: u };
    }
  }
  return { type: "number", value };
}

function parseKeyframes(c: Cursor): KeyframeRule {
  const name = c.ident();
  c.expect("{");
  const blocks: KeyframeBlock[] = [];
  while (!c.eat("}")) blocks.push(parseKeyframe(c));
  return { type: "keyframes", name, blocks };
}

function parseKeyframe(c: Cursor): KeyframeBlock {
  // Selector list, e.g. `from`, `to`, `0%`, or `0%, 100%`.
  const selectors: number[] = [];
  for (;;) {
    if (c.eat("from")) selectors.push(0);
    else if (c.eat("to")) selectors.push(100);
    else {
      selectors.push(parseFloat(c.match(NUMBER)!));
      c.eat("%");
    }
    if (!c.eat(",")) break;
  }

  const { declarations, easing } = parseDeclBlock(c);
  const block: KeyframeBlock = {
    type: "keyframe-block",
    selectors,
    declarations,
  };
  if (easing) block.easing = easing;
  return block;
}

/** Parse `{ decl; decl; }`, hoisting `animation-timing-function` out as `easing`.
 * The easing keeps its parsed {@link Value} verbatim (keyword, cubic-bezier(),
 * steps(), linear()) so the scene builder can resolve it through the one shared
 * timing-function path — the AST stays a faithful mirror and knows no easing
 * semantics. */
function parseDeclBlock(c: Cursor): {
  declarations: Declaration[];
  easing?: Value;
} {
  c.expect("{");
  const declarations: Declaration[] = [];
  let easing: Value | undefined;
  while (!c.eat("}")) {
    const d = parseDeclaration(c);
    if (d.property === "animation-timing-function") easing = d.value;
    else declarations.push(d);
  }
  return { declarations, easing };
}

/**
 * Extract stage config (width/height/background) from a `:root { ... }` rule.
 * Returns undefined when the rule declares none, so a `:root` that carries only
 * custom properties leaves `sheet.canvas` unset (component sizes from attrs).
 */
function extractCanvas(rule: Rule): CanvasConfig | undefined {
  let config: CanvasConfig | undefined;
  const cfg = () => (config ??= { width: 800, height: 600 });
  for (const decl of rule.declarations) {
    if (decl.property === "width" && decl.value.type === "length")
      cfg().width = decl.value.value;
    else if (decl.property === "height" && decl.value.type === "length")
      cfg().height = decl.value.value;
    else if (decl.property === "background" && decl.value.type === "color")
      cfg().background = decl.value.value;
  }
  return config;
}

/** Collect `--custom-property` declarations from a `:root { ... }` rule. */
function extractVariables(rule: Rule): VariableDefinition[] {
  return rule.declarations
    .filter((d) => d.property.startsWith("--"))
    .map((d) => ({ name: d.property, value: d.value }));
}
