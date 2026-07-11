/**
 * Hand-rolled parser for the Popkorn DSL.
 *
 * A tokenizing recursive-descent parser that turns CSS-like source directly
 * into the {@link StyleSheet} AST. Synchronous, zero-dependency — the DSL is a
 * small CSS subset, so a dedicated grammar/parser-generator would be far more
 * machinery than the language needs.
 */

import type {
  CalcExpr,
  CalcFunction,
  CalcValue,
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
  Span,
  StateRule,
  StyleSheet,
  Value,
  VariableDefinition,
} from "./ast";
import {
  isColorValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
} from "./ast";
import type { Diagnostic, Severity } from "./diagnostics";
import {
  COLOR_KEYWORDS,
  COLOR_PROPERTIES,
  isReservedAnimationKeyword,
  KNOWN_PROPERTIES,
  NAMED_COLORS,
  suggest,
} from "./diagnostics";

// A cross-sheet reference captured with its source span during the single
// parse pass, resolved against the collected definitions after parsing (the AST
// carries no spans, so refs remember their own offsets).
interface Ref {
  name: string;
  start: number;
  end: number;
}

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
  // Diagnostics + the side tables the cross-check pass resolves against. All
  // live on the cursor so the recursive-descent helpers can push without an
  // extra threaded context argument.
  diagnostics: Diagnostic[] = [];
  declaredKeyframes = new Set<string>();
  declaredDefines = new Set<string>();
  declaredIds = new Set<string>();
  declaredVars = new Set<string>();
  keyframeRefs: Ref[] = [];
  defineRefs: Ref[] = [];
  idRefs: Ref[] = [];
  varRefs: Ref[] = [];
  constructor(readonly src: string) {}

  report(
    code: string,
    severity: Severity,
    message: string,
    start: number,
    end: number,
    hint?: string,
  ): void {
    this.diagnostics.push(
      hint === undefined
        ? { code, severity, message, start, end }
        : { code, severity, message, hint, start, end },
    );
  }

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
    diagnostics: c.diagnostics,
  };

  while (!c.eof()) {
    // eof() ran ws(), so pos sits at the token start — capture it for at-rule spans.
    const start = c.pos;
    if (c.eat("@keyframes")) {
      const kf = parseKeyframes(c, start);
      c.declaredKeyframes.add(kf.name);
      sheet.keyframes.push(kf);
      continue;
    }
    if (c.eat("@define")) {
      const def = parseDefine(c);
      c.declaredDefines.add(def.name);
      sheet.definitions.push(def);
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

  resolveRefs(c);
  return sheet;
}

/** Convenience wrapper returning just the diagnostics (for lint/host UIs). */
export function validate(source: string): Diagnostic[] {
  return parse(source).diagnostics;
}

// Cross-check pass: every reference captured during parsing is resolved against
// the fully-collected definition sets. Runs once, after the single parse pass.
function resolveRefs(c: Cursor): void {
  for (const r of c.keyframeRefs) {
    if (!c.declaredKeyframes.has(r.name)) {
      const hint = suggest(r.name, c.declaredKeyframes);
      c.report(
        "unknown-keyframes",
        "warning",
        `animation references unknown @keyframes '${r.name}'.`,
        r.start,
        r.end,
        hint && `Did you mean '${hint}'?`,
      );
    }
  }
  for (const r of c.defineRefs) {
    if (!c.declaredDefines.has(r.name)) {
      const hint = suggest(r.name, c.declaredDefines);
      c.report(
        "unknown-define",
        "warning",
        `use: references undefined @define '${r.name}'.`,
        r.start,
        r.end,
        hint && `Did you mean '${hint}'?`,
      );
    }
  }
  for (const r of c.idRefs) {
    if (!c.declaredIds.has(r.name)) {
      const hint = suggest(r.name, c.declaredIds);
      c.report(
        "unknown-id",
        "warning",
        `reference to unknown node id '#${r.name}'.`,
        r.start,
        r.end,
        hint && `Did you mean '#${hint}'?`,
      );
    }
  }
  for (const r of c.varRefs) {
    if (!c.declaredVars.has(r.name)) {
      c.report(
        "undefined-var",
        "info",
        `var(${r.name}) is never declared in this sheet.`,
        r.start,
        r.end,
        "It may be provided by the host at runtime; add a fallback (var(--x, …)) to silence this.",
      );
    }
  }
}

function parseSelector(c: Cursor): Selector {
  const ch = c.peek();
  if (ch === "#") {
    c.expect("#");
    const name = c.ident();
    c.declaredIds.add(name);
    return { type: "id", name };
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
  c.ws();
  const start = c.pos;
  const selector = parseSelector(c);
  const preludeSpan: Span = { start, end: c.pos };
  const body = parseRuleBody(c);
  return {
    type: "rule",
    selector,
    ...body,
    span: { start, end: c.pos },
    preludeSpan,
  };
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
  if (c.eat("#")) {
    const start = c.pos;
    const id = c.ident();
    c.idRefs.push({ name: id, start: start - 1, end: c.pos });
    target = { type: "id", name: id };
  } else if (c.eat(":")) {
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
      declarations.push(...parseDeclaration(c));
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
    else declarations.push(...parseDeclaration(c));
  }
  return { declarations, children };
}

function parseDeclaration(c: Cursor): Declaration[] {
  c.ws();
  const propStart = c.pos;
  const property = c.match(CUSTOM) ?? c.ident();
  const propEnd = c.pos;
  c.expect(":");
  // A value is one or more comma-separated groups, each a space-separated list
  // (CSS `animation: a 1s, b 2s`). Comma-free values keep the old shape exactly:
  // a lone value, or a plain space `list` with no separator.
  c.ws();
  const valStart = c.pos;
  const groups: Value[] = [];
  for (;;) {
    const values = parseValueList(c);
    groups.push(values.length === 1 ? values[0] : { type: "list", values });
    if (!c.eat(",")) break;
  }
  // Back up over trailing whitespace so valueSpan/span end at the last value
  // char (peek()'s ws-skip may have advanced pos to the `;`/`}` terminator).
  let valEnd = c.pos;
  while (valEnd > valStart && isWs(c.src[valEnd - 1])) valEnd--;
  c.eat(";"); // optional trailing semicolon
  const value: Value =
    groups.length === 1
      ? groups[0]
      : { type: "list", values: groups, separator: "comma" };
  lintDeclaration(c, property, value, propStart, propEnd, valStart, valEnd);
  const out = expandAliases(c, property, value, propStart, propEnd);
  // Every declaration this source line expands to shares its source spans
  // (`span`: property→value, `valueSpan`: just the value; both exclude `;`).
  const span: Span = { start: propStart, end: valEnd };
  const valueSpan: Span = { start: valStart, end: valEnd };
  for (const d of out) {
    d.span = span;
    d.valueSpan = valueSpan;
  }
  return out;
}

// Author-confusion checks that don't change the AST: unknown properties (with a
// "did you mean"), bad color keywords, and cross-sheet reference collection.
function lintDeclaration(
  c: Cursor,
  property: string,
  value: Value,
  propStart: number,
  propEnd: number,
  valStart: number,
  valEnd: number,
): void {
  if (property.startsWith("--")) {
    c.declaredVars.add(property);
  } else if (!KNOWN_PROPERTIES.has(property)) {
    const hint = suggest(property, KNOWN_PROPERTIES);
    c.report(
      "unknown-property",
      "warning",
      `unknown property '${property}'.`,
      propStart,
      propEnd,
      hint && `Did you mean '${hint}'?`,
    );
  }

  // A bare keyword in a color slot must name a color.
  if (COLOR_PROPERTIES.has(property) && value.type === "keyword") {
    const kw = value.value.toLowerCase();
    if (
      !kw.startsWith("#") &&
      !COLOR_KEYWORDS.has(kw) &&
      !NAMED_COLORS.has(kw)
    ) {
      const hint = suggest(kw, NAMED_COLORS);
      c.report(
        "unknown-color",
        "warning",
        `'${value.value}' is not a recognized color.`,
        valStart,
        valEnd,
        hint && `Did you mean '${hint}'?`,
      );
    }
  }

  // Cross-sheet references — resolved against the full sheet after parsing.
  if (property === "animation-name" || property === "animation") {
    const name = animationName(value, property);
    if (name) c.keyframeRefs.push({ name, start: valStart, end: valEnd });
  }
  if (property === "use" && value.type === "keyword") {
    c.defineRefs.push({ name: value.value, start: valStart, end: valEnd });
  }
  if (property === "mask" || property === "clip-path") {
    for (const id of keywordTokens(value)) {
      if (id.startsWith("#"))
        c.idRefs.push({ name: id.slice(1), start: valStart, end: valEnd });
    }
  }
}

// All bare-keyword tokens at any list nesting (functions' args are not
// descended into — a `url(#x)` inner ref is not a top-level keyword).
function keywordTokens(v: Value): string[] {
  if (v.type === "keyword") return [v.value];
  if (v.type === "list") return v.values.flatMap(keywordTokens);
  return [];
}

// The @keyframes name an `animation`/`animation-name` value references, or
// undefined when there isn't exactly one candidate (ambiguous shorthand, `none`,
// or a bare timing-only shorthand → skip rather than false-positive).
function animationName(value: Value, property: string): string | undefined {
  const kws = keywordTokens(value).filter(
    (k) => !k.startsWith("#") && !k.includes("."),
  );
  if (property === "animation-name") return kws.find((k) => k !== "none");
  const names = kws.filter((k) => !isReservedAnimationKeyword(k));
  return names.length === 1 ? names[0] : undefined;
}

// Zero-span placeholder for freshly-built declarations; parseDeclaration
// overwrites span/valueSpan with the real source offsets before returning.
const ZERO_SPAN: Span = { start: 0, end: 0 };

const decl = (property: string, value: Value): Declaration => ({
  type: "declaration",
  property,
  value,
  span: ZERO_SPAN,
  valueSpan: ZERO_SPAN,
});

// Recognized border-style keywords, so `border:`'s style keyword can be told
// apart from a named-color keyword (`red`) in the same value list.
const BORDER_STYLES = new Set([
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);

/**
 * Write-in-only CSS alias sugar for CSS artists. Aliases are rewritten to
 * canonical Popkorn properties here at the single parseDeclaration choke point,
 * so the rewrite covers rule bodies, `@keyframes`, `&:hover`/`&:active`, and
 * `@define` alike — and aliased animatable props (e.g. `border-radius` → rx/ry)
 * already speak canonical names before animation matching. The AST/scene/
 * serializer never see alias spellings. Rejected forms warn (Popkorn has no box
 * model / no containing box) rather than vanishing silently.
 */
function expandAliases(
  c: Cursor,
  property: string,
  value: Value,
  start: number,
  end: number,
): Declaration[] {
  switch (property) {
    // Positional sugar. right/bottom have no containing box to resolve against.
    case "left":
      return [decl("x", value)];
    case "top":
      return [decl("y", value)];
    case "right":
    case "bottom":
      c.report(
        "unsupported-property",
        "warning",
        `'${property}' has no containing box in Popkorn.`,
        start,
        end,
        "Position with x/y instead.",
      );
      return [];

    // Paint sugar. `background`/`color` both fold to `fill`; a `:root` stage
    // background is read back from the rewritten `fill` in extractCanvas, so its
    // stage-color meaning is preserved.
    case "background":
    case "color":
      return [decl("fill", value)];

    // border-radius: <r>  ->  rx + ry (single value only).
    case "border-radius":
      if (isListValue(value)) {
        c.report(
          "unsupported-value",
          "warning",
          "multi-value/elliptical border-radius isn't supported.",
          start,
          end,
          "Use type: path for a custom outline.",
        );
        return [];
      }
      return [decl("rx", value), decl("ry", value)];

    // border: <width> solid <color>  ->  stroke-width + stroke.
    case "border":
      return expandBorder(c, value, start, end);

    // Box-model properties Popkorn has no concept of.
    case "padding":
    case "margin":
    case "display":
    case "position":
      c.report(
        "unsupported-property",
        "warning",
        `'${property}' is not supported — Popkorn has no box model.`,
        start,
        end,
      );
      return [];

    default:
      return [decl(property, value)];
  }
}

/** `border: <width> solid <color>` → `stroke-width` + `stroke`. Only `solid`
 * (and `none`, which clears the stroke) map; other styles warn. */
function expandBorder(
  c: Cursor,
  value: Value,
  start: number,
  end: number,
): Declaration[] {
  const parts = isListValue(value) ? value.values : [value];
  const style = parts.find(
    (p) => isKeywordValue(p) && BORDER_STYLES.has(p.value),
  );
  if (style && isKeywordValue(style) && style.value === "none") {
    return [decl("stroke-width", { type: "number", value: 0 })];
  }
  if (style && isKeywordValue(style) && style.value !== "solid") {
    c.report(
      "unsupported-value",
      "warning",
      `border-style '${style.value}' isn't supported; only 'solid' maps to a stroke.`,
      start,
      end,
    );
    return [];
  }
  const out: Declaration[] = [];
  const width = parts.find((p) => isLengthValue(p) || isNumberValue(p));
  if (width) out.push(decl("stroke-width", width));
  const color = parts.find(
    (p) =>
      isColorValue(p) || (isKeywordValue(p) && !BORDER_STYLES.has(p.value)),
  );
  if (color) out.push(decl("stroke", color));
  return out;
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

  // Identifier-led: calc(), var(), function call, member expression, or bare keyword.
  c.ws();
  const identStart = c.pos;
  const name = c.ident();
  if (name === "calc" && c.peek() === "(") {
    return parseCalc(c);
  }
  if (
    (name === "min" || name === "max" || name === "clamp") &&
    c.peek() === "("
  ) {
    // A top-level math function wraps its node in a calc() Value so every
    // downstream calc path (static fold, reactive resolve) picks it up for free.
    return { type: "calc", expr: parseCalcFunction(c, name) };
  }
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
    // Only unfallback'd refs are worth flagging — a fallback means the author
    // already handled absence.
    if (fallback === undefined)
      c.varRefs.push({ name: varName, start: identStart, end: c.pos });
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

// calc() — a standard CSS arithmetic expression. `(` already peeked; grammar:
//   sum     := product ( <ws> ('+'|'-') <ws> product )*
//   product := unary   ( ('*'|'/') unary )*
//   unary   := '(' sum ')' | <numeric value via parseValue>
// Per CSS, `+`/`-` REQUIRE surrounding whitespace (so `-3px` reads as a signed
// operand, not a subtraction); `*`/`/` don't. Operand values (number/length/
// var()/input()/nested calc()) come straight from parseValue, so calc composes
// with the rest of the value grammar for free.
function parseCalc(c: Cursor): CalcValue {
  c.expect("(");
  const expr = parseCalcSum(c);
  c.expect(")");
  return { type: "calc", expr };
}

// min()/max()/clamp() — comma-separated calc sums. `(` already peeked. Each arg
// is a full sum, so calc composes inside them and (via parseValue) they compose
// inside calc. clamp needs exactly 3 args; min/max need at least 1.
function parseCalcFunction(
  c: Cursor,
  name: "min" | "max" | "clamp",
): CalcFunction {
  c.expect("(");
  const args: CalcExpr[] = [];
  if (c.peek() !== ")") {
    args.push(parseCalcSum(c));
    while (c.eat(",")) args.push(parseCalcSum(c));
  }
  c.expect(")");
  if (name === "clamp" && args.length !== 3)
    throw new Error(
      c.errorAt(`clamp() takes exactly 3 arguments, got ${args.length}`),
    );
  if (name !== "clamp" && args.length < 1)
    throw new Error(c.errorAt(`${name}() needs at least 1 argument`));
  return { type: "calc-function", name, args };
}

function parseCalcSum(c: Cursor): CalcExpr {
  let left = parseCalcProduct(c);
  for (;;) {
    const op = eatAdditiveOp(c);
    if (!op) break;
    const right = parseCalcProduct(c);
    left = { type: "calc-binary", op, left, right };
  }
  return left;
}

function parseCalcProduct(c: Cursor): CalcExpr {
  let left = parseCalcUnary(c);
  for (;;) {
    const op = eatMulOp(c);
    if (!op) break;
    const right = parseCalcUnary(c);
    left = { type: "calc-binary", op, left, right };
  }
  return left;
}

function parseCalcUnary(c: Cursor): CalcExpr {
  if (c.peek() === "(") {
    c.expect("(");
    const inner = parseCalcSum(c);
    c.expect(")");
    return inner;
  }
  return { type: "calc-operand", value: parseValue(c) };
}

// Consume a whitespace-delimited `+`/`-`, enforcing CSS's rule that both sides
// carry whitespace. Returns null (without advancing) when the next token isn't a
// valid additive operator here — e.g. `)` or a `-3px` that belongs to the next
// operand. Operates on raw source so the whitespace requirement is real; must be
// tried BEFORE any ws-skipping consume so the leading whitespace is still there.
function eatAdditiveOp(c: Cursor): "+" | "-" | null {
  let i = c.pos;
  // Require at least one whitespace char before the operator.
  if (!isWs(c.src[i])) return null;
  while (isWs(c.src[i])) i++;
  const op = c.src[i];
  if (op !== "+" && op !== "-") return null;
  // And whitespace after it.
  if (!isWs(c.src[i + 1])) return null;
  c.pos = i + 1;
  return op;
}

// Consume a `*`/`/` (whitespace around it is optional per CSS). Non-destructive
// when it doesn't match: c.pos is left untouched so a following eatAdditiveOp
// still sees the whitespace it needs (c.eat would swallow it).
function eatMulOp(c: Cursor): "*" | "/" | null {
  let i = c.pos;
  while (isWs(c.src[i])) i++;
  const op = c.src[i];
  if (op !== "*" && op !== "/") return null;
  c.pos = i + 1;
  return op;
}

function isWs(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function readString(c: Cursor, quote: string): Value {
  const start = c.pos;
  c.expect(quote);
  let out = "";
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos];
    if (ch === quote) {
      c.pos++; // closing quote
      return { type: "string", value: out };
    }
    // Per CSS, a raw newline terminates an unclosed string as a parse error;
    // stopping here (rather than swallowing to EOF) lets the rest of the sheet
    // still parse, so the diagnostic is delivered instead of throwing later.
    if (ch === "\n") break;
    out += ch;
    c.pos++;
  }
  c.report(
    "unterminated-string",
    "error",
    "unterminated string literal.",
    start,
    c.pos,
    `Add a closing ${quote} quote.`,
  );
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

function parseKeyframes(c: Cursor, start: number): KeyframeRule {
  c.ws();
  const nameStart = c.pos;
  const name = c.ident();
  const preludeSpan: Span = { start: nameStart, end: c.pos };
  c.expect("{");
  const blocks: KeyframeBlock[] = [];
  while (!c.eat("}")) blocks.push(parseKeyframe(c));
  return {
    type: "keyframes",
    name,
    blocks,
    span: { start, end: c.pos },
    preludeSpan,
  };
}

function parseKeyframe(c: Cursor): KeyframeBlock {
  // Selector list, e.g. `from`, `to`, `0%`, or `0%, 100%`.
  c.ws();
  const selStart = c.pos;
  const selectors: number[] = [];
  let selEnd = c.pos;
  for (;;) {
    if (c.eat("from")) selectors.push(0);
    else if (c.eat("to")) selectors.push(100);
    else {
      selectors.push(parseFloat(c.match(NUMBER)!));
      c.eat("%");
    }
    selEnd = c.pos; // after the token, before any trailing `,`/whitespace
    if (!c.eat(",")) break;
  }
  const selectorSpan: Span = { start: selStart, end: selEnd };

  const { declarations, easing } = parseDeclBlock(c);
  const block: KeyframeBlock = {
    type: "keyframe-block",
    selectors,
    declarations,
    selectorSpan,
    span: { start: selStart, end: c.pos },
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
    for (const d of parseDeclaration(c)) {
      if (d.property === "animation-timing-function") easing = d.value;
      else declarations.push(d);
    }
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
    // `background` is rewritten to `fill` by the alias pass before it reaches
    // here, so read the stage color back from `fill` — its meaning is preserved.
    // Colors parse as `color` (hex), `keyword` (named colors) or `function`
    // (rgb()/rgba()); accept all three — stringifyColorValue keeps the raw
    // text so serializer round-tripping (which just prints `color.value`
    // verbatim) still works, and the player's parseColor already resolves
    // named colors and rgb()/rgba() at render time.
    else if (decl.property === "fill") {
      const bg = stringifyColorValue(decl.value);
      if (bg !== undefined) cfg().background = bg;
    }
    // Artboard clipping toggle (default `hidden` — applied by the player when
    // the flag is absent). Only `hidden`/`visible` keywords are captured.
    else if (decl.property === "overflow" && decl.value.type === "keyword") {
      if (decl.value.value === "hidden" || decl.value.value === "visible")
        cfg().overflow = decl.value.value;
    }
  }
  return config;
}

/** Render a color-ish {@link Value} back to CSS text — hex `color`, named
 * `keyword`, or a `function` call (`rgb()`/`rgba()`/`hsl()`/...) with
 * numeric/length args. Returns undefined for anything else (e.g. `var()`),
 * which callers should ignore rather than store a bogus background. */
function stringifyColorValue(v: Value): string | undefined {
  if (v.type === "color" || v.type === "keyword") return v.value;
  if (v.type === "number") return String(v.value);
  if (v.type === "length") return `${v.value}${v.unit}`;
  if (v.type === "function") {
    const args = v.args.map(stringifyColorValue);
    if (args.some((a) => a === undefined)) return undefined;
    return `${v.name}(${args.join(", ")})`;
  }
  return undefined;
}

/** Collect `--custom-property` declarations from a `:root { ... }` rule. */
function extractVariables(rule: Rule): VariableDefinition[] {
  return rule.declarations
    .filter((d) => d.property.startsWith("--"))
    .map((d) => ({ name: d.property, value: d.value }));
}
