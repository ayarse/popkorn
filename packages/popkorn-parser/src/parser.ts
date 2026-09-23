// Hand-rolled tokenizing recursive-descent parser: a small CSS subset doesn't earn a parser generator.

import type {
  CalcExpr,
  CalcFunction,
  CalcFunctionName,
  CalcValue,
  CanvasConfig,
  Declaration,
  DefinitionRule,
  KeyframeBlock,
  KeyframeRule,
  KeywordValue,
  MachineGuard,
  MachineRule,
  MachineState,
  MachineTransition,
  MachineTrigger,
  PseudoState,
  RandomValue,
  RoundStrategy,
  Rule,
  Selector,
  Span,
  StateRule,
  StyleSheet,
  Value,
  VariableDefinition,
} from "./ast.js";
import {
  decl,
  getNumericValue,
  isColorValue,
  isKeywordValue,
  isLengthValue,
  isListValue,
  isNumberValue,
  someValue,
} from "./ast.js";
import type { Diagnostic, Severity } from "./diagnostics.js";
import {
  COLOR_KEYWORDS,
  COLOR_PROPERTIES,
  isKeyframeNameToken,
  KNOWN_PROPERTIES,
  NAMED_COLORS,
  suggest,
} from "./diagnostics.js";

// A cross-sheet reference, resolved against the collected definitions after parsing.
interface Ref {
  name: string;
  start: number;
  end: number;
}

const IDENT = /[a-zA-Z_][a-zA-Z0-9_-]*/y;
const CUSTOM = /--[a-zA-Z_][a-zA-Z0-9_-]*/y;
// Leading-dot fractions (`.5`) are valid CSS and minifiers emit them.
const NUMBER = /-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/y;
// Trailing boundary stops `#Background` (an id ref) lexing as the color `#Bac`.
const COLOR = /#[0-9a-fA-F]{3,8}(?![\w-])/y;
// Longest-first so 'ms' beats 's' and 'rem' beats 'em'.
const UNITS = [
  "grad",
  "turn",
  "deg",
  "rad",
  "rem",
  "px",
  "em",
  "ms",
  "s",
] as const;

class Cursor {
  pos = 0;
  // Diagnostics + cross-check side tables live here so helpers needn't thread a context.
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
      if (isWs(c)) {
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
  peek(): string | undefined {
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
      // `canvas` stays undefined for a vars-only `:root`, so the component uses its attributes.
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

// Resolves every captured reference against the fully-collected definition sets.
function resolveRefs(c: Cursor): void {
  // [refs, declared names, code, message lead, name sigil]
  const tables: [Ref[], Set<string>, string, string, string][] = [
    [
      c.keyframeRefs,
      c.declaredKeyframes,
      "unknown-keyframes",
      "animation references unknown @keyframes",
      "",
    ],
    [
      c.defineRefs,
      c.declaredDefines,
      "unknown-define",
      "use: references undefined @define",
      "",
    ],
    [
      c.idRefs,
      c.declaredIds,
      "unknown-id",
      "reference to unknown node id",
      "#",
    ],
  ];
  for (const [refs, declared, code, lead, sigil] of tables)
    for (const r of refs) {
      if (declared.has(r.name)) continue;
      const hint = suggest(r.name, declared);
      c.report(
        code,
        "warning",
        `${lead} '${sigil}${r.name}'.`,
        r.start,
        r.end,
        hint && `Did you mean '${sigil}${hint}'?`,
      );
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
  if (c.eat("#")) {
    const name = c.ident();
    c.declaredIds.add(name);
    return { type: "id", name };
  }
  if (c.eat(".")) return { type: "class", name: c.ident() };
  if (c.eat(":")) {
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

// `@machine <name> { initial: <s>; state <s> { to: ...; emit: ...; } }`.
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

// `<state> [on <trigger>] [when style(<g>) [and style(<g>)]*] [mix <dur> [<easing>]];` after `to:`.
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
    // Easing is slurped verbatim to the terminator; `mix` is the last clause.
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

// A number with optional time unit, in ms; unitless is returned as-is.
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

/** Parse `{ decls, > children, &:state blocks }` shared by rules, @define and (state-free) state blocks. */
function parseRuleBody(
  c: Cursor,
  allowStates = true,
): {
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
      children.push(parseRule(c));
    } else if (allowStates && c.eat("&")) {
      // `&:hover` / `&:active` / `&:state(name)` / `&:state(machine.name)`.
      c.expect(":");
      const kw = c.ident();
      let head: Pick<StateRule, "state" | "machineState"> = {
        state: kw as PseudoState,
      };
      if (kw === "state") {
        c.expect("(");
        const first = c.ident();
        // `:state(machine.name)` namespaces the state; `:state(name)` doesn't.
        const machineState = c.eat(".")
          ? { machine: first, name: c.ident() }
          : { machine: null, name: first };
        c.expect(")");
        head = { state: "state", machineState };
      }
      const { declarations, children } = parseRuleBody(c, false);
      states.push({ ...head, declarations, children });
    } else {
      declarations.push(...parseDeclaration(c));
    }
  }
  return { declarations, children, states };
}

function parseDeclaration(c: Cursor): Declaration[] {
  c.ws();
  const propStart = c.pos;
  const property = c.match(CUSTOM) ?? c.ident();
  const propEnd = c.pos;
  c.expect(":");
  // Comma groups of space lists (`animation: a 1s, b 2s`); comma-free values stay a lone value or space list.
  c.ws();
  const valStart = c.pos;
  const groups: Value[] = [];
  for (;;) {
    const values = parseValueList(c);
    groups.push(values.length === 1 ? values[0] : { type: "list", values });
    if (!c.eat(",")) break;
  }
  // peek()'s ws-skip may have reached the terminator; spans end at the last value char.
  let valEnd = c.pos;
  while (valEnd > valStart && isWs(c.src[valEnd - 1])) valEnd--;
  c.eat(";"); // optional trailing semicolon
  const value: Value =
    groups.length === 1
      ? groups[0]
      : { type: "list", values: groups, separator: "comma" };
  const propSpan: Span = { start: propStart, end: propEnd };
  const valueSpan: Span = { start: valStart, end: valEnd };
  lintDeclaration(c, property, value, propSpan, valueSpan);
  // Alias expansions share the source declaration's spans.
  const span: Span = { start: propStart, end: valEnd };
  return expandAliases(c, property, value, propSpan, (p, v) =>
    decl(p, v, span, valueSpan),
  );
}

// Non-AST checks: unknown properties, bad color keywords, em/rem, reference collection.
function lintDeclaration(
  c: Cursor,
  property: string,
  value: Value,
  propSpan: Span,
  valueSpan: Span,
): void {
  if (property.startsWith("--")) {
    c.declaredVars.add(property);
  } else if (!KNOWN_PROPERTIES.has(property)) {
    const hint = suggest(property, KNOWN_PROPERTIES);
    c.report(
      "unknown-property",
      "warning",
      `unknown property '${property}'.`,
      propSpan.start,
      propSpan.end,
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
        valueSpan.start,
        valueSpan.end,
        hint && `Did you mean '${hint}'?`,
      );
    }
  }

  // em/rem round-trip but do nothing (lengths are scene units); warn once per declaration.
  const fontRelativeUnit = findFontRelativeUnit(value);
  if (fontRelativeUnit) {
    c.report(
      "unit-has-no-effect",
      "warning",
      `unit '${fontRelativeUnit}' has no effect — lengths are scene units.`,
      valueSpan.start,
      valueSpan.end,
    );
  }

  // Cross-sheet references — resolved against the full sheet after parsing.
  if (property === "animation-name" || property === "animation") {
    const name = animationName(value, property);
    if (name) c.keyframeRefs.push({ name, ...valueSpan });
  }
  if (property === "use" && value.type === "keyword") {
    c.defineRefs.push({ name: value.value, ...valueSpan });
  }
  if (property === "mask" || property === "clip-path") {
    for (const id of keywordTokens(value)) {
      if (id.startsWith("#"))
        c.idRefs.push({ name: id.slice(1), ...valueSpan });
    }
  }
}

// First `em`/`rem` anywhere in a value (lists, function args, var() fallback, random(), calc()).
function findFontRelativeUnit(v: Value): "em" | "rem" | undefined {
  let found: "em" | "rem" | undefined;
  someValue(v, (x) => {
    if (x.type === "length" && (x.unit === "em" || x.unit === "rem"))
      found = x.unit;
    return found !== undefined;
  });
  return found;
}

// Bare keywords at any list depth; function args are not descended into.
function keywordTokens(v: Value): string[] {
  if (v.type === "keyword") return [v.value];
  if (v.type === "list") return v.values.flatMap(keywordTokens);
  return [];
}

// The referenced @keyframes name, or undefined unless exactly one candidate (avoids false positives).
function animationName(value: Value, property: string): string | undefined {
  const kws = keywordTokens(value);
  if (property === "animation-name")
    return kws.find(
      (k) => k !== "none" && !k.startsWith("#") && !k.includes("."),
    );
  const names = kws.filter(isKeyframeNameToken);
  return names.length === 1 ? names[0] : undefined;
}

// Builds an expanded declaration carrying the source declaration's spans.
type DeclFactory = (property: string, value: Value) => Declaration;

// Distinguishes `border:`'s style keyword from a named-color keyword.
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

/** Rewrites write-in CSS aliases to canonical props at the one declaration choke point; box-model forms warn. */
function expandAliases(
  c: Cursor,
  property: string,
  value: Value,
  at: Span,
  d: DeclFactory,
): Declaration[] {
  switch (property) {
    // Positional sugar. right/bottom have no containing box to resolve against.
    case "left":
      return [d("x", value)];
    case "top":
      return [d("y", value)];
    case "right":
    case "bottom":
      c.report(
        "unsupported-property",
        "warning",
        `'${property}' has no containing box in Popkorn.`,
        at.start,
        at.end,
        "Position with x/y instead.",
      );
      return [];

    // `background`/`color` fold to `fill`; extractCanvas reads the stage color back from it.
    case "background":
    case "color":
      return [d("fill", value)];

    // One value → uniform rx/ry (animatable); 2–4 values → per-corner longhands.
    // NOTE: elliptical `a / b` corners unsupported; the `/` trips the guard below.
    case "border-radius": {
      const parts = isListValue(value) ? value.values : [value];
      const radii = parts.filter((p) => isLengthValue(p) || isNumberValue(p));
      if (radii.length !== parts.length || radii.length > 4) {
        c.report(
          "unsupported-value",
          "warning",
          "elliptical border-radius (with `/`) isn't supported.",
          at.start,
          at.end,
          "Use type: path for a custom outline.",
        );
        return [];
      }
      if (radii.length <= 1) {
        return [d("rx", value), d("ry", value)];
      }
      // CSS shorthand fill: [tl, tr, br, bl] from 2–4 values.
      const tl = radii[0];
      const tr = radii[1];
      const br = radii[2] ?? radii[0];
      const bl = radii[3] ?? radii[1];
      return [
        d("border-top-left-radius", tl),
        d("border-top-right-radius", tr),
        d("border-bottom-right-radius", br),
        d("border-bottom-left-radius", bl),
      ];
    }

    case "border":
      return expandBorder(c, value, at, d);

    // No box model. `display` is absent on purpose: `none` hides a subtree.
    case "padding":
    case "margin":
    case "position":
      c.report(
        "unsupported-property",
        "warning",
        `'${property}' is not supported — Popkorn has no box model.`,
        at.start,
        at.end,
      );
      return [];

    default:
      return [d(property, value)];
  }
}

/** `border: <width> solid <color>` → `stroke-width` + `stroke`; only `solid`/`none` map. */
function expandBorder(
  c: Cursor,
  value: Value,
  at: Span,
  d: DeclFactory,
): Declaration[] {
  const parts = isListValue(value) ? value.values : [value];
  const style = parts.find(
    (p): p is KeywordValue => isKeywordValue(p) && BORDER_STYLES.has(p.value),
  )?.value;
  if (style === "none")
    return [d("stroke-width", { type: "number", value: 0 })];
  if (style && style !== "solid") {
    c.report(
      "unsupported-value",
      "warning",
      `border-style '${style}' isn't supported; only 'solid' maps to a stroke.`,
      at.start,
      at.end,
    );
    return [];
  }
  const out: Declaration[] = [];
  const width = parts.find((p) => isLengthValue(p) || isNumberValue(p));
  if (width) out.push(d("stroke-width", width));
  const color = parts.find(
    (p) =>
      isColorValue(p) || (isKeywordValue(p) && !BORDER_STYLES.has(p.value)),
  );
  if (color) out.push(d("stroke", color));
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
    // Non-hex `#myLayer` is a node-id ref kept as a keyword; the builder strips the '#'.
    const col = c.match(COLOR);
    if (col) return { type: "color", value: col };
    c.expect("#");
    return { type: "keyword", value: "#" + c.ident() };
  }
  if (ch === '"' || ch === "'") return readString(c, ch);
  if (isNumberStart(c, ch)) return readNumber(c);

  // Identifier-led: calc(), var(), function call, member expression, or bare keyword.
  const identStart = c.pos;
  const name = c.ident();
  if (name === "calc" && c.peek() === "(") {
    return parseCalc(c);
  }
  if (isCalcFunctionName(name) && c.peek() === "(") {
    // Wrapped in a calc() Value so every downstream calc path handles it.
    return { type: "calc", expr: parseCalcFunction(c, name) };
  }
  if (name === "var" && c.peek() === "(") {
    c.expect("(");
    const varName = c.match(CUSTOM)!;
    let fallback: Value | undefined;
    if (c.eat(",")) {
      // NOTE: single-value fallback only (no `var(--x, 1px, 2px)`); a trailing comma is tolerated.
      if (c.peek() !== ")") fallback = parseValue(c);
    }
    c.expect(")");
    // A fallback means the author already handled absence.
    if (fallback === undefined)
      c.varRefs.push({ name: varName, start: identStart, end: c.pos });
    return { type: "variable", name: varName, fallback };
  }
  if (name === "random" && c.peek() === "(") {
    return parseRandom(c, identStart);
  }
  if (c.eat("(")) {
    const args: Value[] = [];
    while (!c.eat(")")) {
      // `/` separates alpha in modern color functions; both flatten to positional args.
      if (c.eat(",") || c.eat("/")) continue;
      args.push(parseValue(c));
    }
    return { type: "function", name, args };
  }
  // Member expression, e.g. `cursor.x`.
  if (c.eat(".")) return { type: "keyword", value: `${name}.${c.ident()}` };
  return { type: "keyword", value: name };
}

// random( [ per-element || <dashed-ident> ]? , <min> , <max> [ , by <step> ]? ); `(` already peeked.
function parseRandom(c: Cursor, start: number): RandomValue {
  c.expect("(");
  let perElement = false;
  let ident: string | undefined;
  // Prelude: `per-element` and/or `--ident` in either order; an unknown keyword is flagged.
  for (let i = 0; i < 2; i++) {
    const cu = c.match(CUSTOM);
    if (cu !== null) {
      ident = cu;
      continue;
    }
    const save = c.pos;
    const kw = c.match(IDENT);
    if (kw === "per-element") {
      perElement = true;
      continue;
    }
    if (kw !== null) {
      c.report(
        "invalid-random",
        "warning",
        `random(): unexpected keyword '${kw}'; expected 'per-element' or a --dashed-ident.`,
        save,
        c.pos,
      );
      c.pos = save;
    }
    break;
  }
  if (perElement || ident !== undefined) c.expect(",");

  const min = parseValue(c);
  c.expect(",");
  const max = parseValue(c);

  let step: Value | undefined;
  if (c.eat(",")) {
    const kw = c.match(IDENT);
    if (kw !== "by") {
      c.report(
        "invalid-random",
        "warning",
        `random(): a fourth argument must be 'by <step>'.`,
        start,
        c.pos,
      );
    }
    step = parseValue(c);
  }
  c.expect(")");

  checkRandomUnits(c, min, max, step, start, c.pos);
  return { type: "random", perElement, ident, min, max, step };
}

// A literal operand's unit ("" for numbers), or null for var()/calc() (checks skipped).
function randomUnit(v: Value): string | null {
  if (isLengthValue(v)) return v.unit;
  if (isNumberValue(v)) return "";
  return null;
}

// Flag incompatible units (min/max/step must agree) and an inverted range.
function checkRandomUnits(
  c: Cursor,
  min: Value,
  max: Value,
  step: Value | undefined,
  start: number,
  end: number,
): void {
  const um = randomUnit(min);
  const ux = randomUnit(max);
  if (um !== null && ux !== null && um !== ux) {
    c.report(
      "invalid-random",
      "warning",
      `random(): min and max units disagree ('${um || "<number>"}' vs '${ux || "<number>"}').`,
      start,
      end,
    );
    return;
  }
  if (step !== undefined) {
    const us = randomUnit(step);
    if (us !== null && um !== null && us !== um) {
      c.report(
        "invalid-random",
        "warning",
        `random(): step unit '${us || "<number>"}' must match the range unit '${um || "<number>"}'.`,
        start,
        end,
      );
    }
  }
  if (
    um !== null &&
    ux !== null &&
    getNumericValue(min) > getNumericValue(max)
  ) {
    c.report(
      "invalid-random",
      "warning",
      `random(): min is greater than max — the range is empty.`,
      start,
      end,
    );
  }
}

// sum := product (<ws> [+-] <ws> product)*; product := unary ([*/] unary)*; unary := '(' sum ')' | value.
function parseCalc(c: Cursor): CalcValue {
  c.expect("(");
  const expr = parseCalcSum(c);
  c.expect(")");
  return { type: "calc", expr };
}

// Fixed count or [min, max]; round()'s strategy is consumed separately.
const CALC_ARITY: Record<CalcFunctionName, number | [number, number]> = {
  min: [1, Infinity],
  max: [1, Infinity],
  hypot: [1, Infinity],
  clamp: 3,
  round: [1, 2], // step defaults to 1 when omitted
  mod: 2,
  rem: 2,
  atan2: 2,
  pow: 2,
  log: [1, 2],
  sin: 1,
  cos: 1,
  tan: 1,
  asin: 1,
  acos: 1,
  atan: 1,
  sqrt: 1,
  exp: 1,
  abs: 1,
  sign: 1,
  // Zero-arg; the scene builder substitutes 1-based position / sibling count.
  "sibling-index": 0,
  "sibling-count": 0,
};

const ROUND_STRATEGIES = new Set<RoundStrategy>([
  "nearest",
  "up",
  "down",
  "to-zero",
]);

const CALC_NAMES = new Set(Object.keys(CALC_ARITY));

function isCalcFunctionName(name: string): name is CalcFunctionName {
  return CALC_NAMES.has(name);
}

// Comma-separated calc sums validated against CALC_ARITY; `(` already peeked.
function parseCalcFunction(c: Cursor, name: CalcFunctionName): CalcFunction {
  c.expect("(");
  const strategy = name === "round" ? eatRoundStrategy(c) : undefined;
  const args: CalcExpr[] = [];
  if (c.peek() !== ")") {
    args.push(parseCalcSum(c));
    while (c.eat(",")) args.push(parseCalcSum(c));
  }
  c.expect(")");
  const arity = CALC_ARITY[name];
  const [lo, hi] = typeof arity === "number" ? [arity, arity] : arity;
  if (args.length < lo || args.length > hi) {
    const want =
      lo === hi
        ? `exactly ${lo}`
        : hi === Infinity
          ? `at least ${lo}`
          : `${lo}–${hi}`;
    throw new Error(
      c.errorAt(`${name}() takes ${want} argument(s), got ${args.length}`),
    );
  }
  return { type: "calc-function", name, args, strategy };
}

// Consume round()'s leading `<strategy> ,`, restoring the cursor if absent.
function eatRoundStrategy(c: Cursor): RoundStrategy | undefined {
  const save = c.pos;
  const id = c.match(IDENT);
  if (id && ROUND_STRATEGIES.has(id as RoundStrategy) && c.eat(",")) {
    return id as RoundStrategy;
  }
  c.pos = save;
  return undefined;
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
  if (c.eat("(")) {
    const inner = parseCalcSum(c);
    c.expect(")");
    return inner;
  }
  return { type: "calc-operand", value: parseValue(c) };
}

// `+`/`-` need whitespace on both sides (so `-3px` is an operand); try before any ws-skipping consume.
function eatAdditiveOp(c: Cursor): "+" | "-" | null {
  let i = c.pos;
  if (!isWs(c.src[i])) return null;
  while (isWs(c.src[i])) i++;
  const op = c.src[i];
  if (op !== "+" && op !== "-") return null;
  if (!isWs(c.src[i + 1])) return null;
  c.pos = i + 1;
  return op;
}

// Leaves c.pos untouched on no match so eatAdditiveOp still sees its whitespace.
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
    // \n \r \t → control chars, escaped newline = continuation. NOTE: \<hex> escapes not unwound.
    if (ch === "\\" && c.pos + 1 < c.src.length) {
      const next = c.src[c.pos + 1];
      out +=
        next === "n"
          ? "\n"
          : next === "r"
            ? "\r"
            : next === "t"
              ? "\t"
              : next === "\n"
                ? ""
                : next;
      c.pos += 2;
      continue;
    }
    // Per CSS a raw newline ends an unclosed string, so the rest of the sheet still parses.
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

function isNumberStart(c: Cursor, ch: string | undefined): boolean {
  if (ch !== undefined && ch >= "0" && ch <= "9") return true;
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

/** Parse `{ decl; decl; }`, hoisting `animation-timing-function` verbatim as `easing`. */
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

/** Stage config from `:root`, or undefined when it declares none. */
function extractCanvas(rule: Rule): CanvasConfig | undefined {
  let config: CanvasConfig | undefined;
  const cfg = () => (config ??= { width: 800, height: 600 });
  for (const decl of rule.declarations) {
    if (decl.property === "width" && decl.value.type === "length")
      cfg().width = decl.value.value;
    else if (decl.property === "height" && decl.value.type === "length")
      cfg().height = decl.value.value;
    // The alias pass already rewrote `background` to `fill`.
    else if (decl.property === "fill") {
      const bg = stringifyColorValue(decl.value);
      if (bg !== undefined) cfg().background = bg;
    } else if (decl.property === "overflow" && decl.value.type === "keyword") {
      if (decl.value.value === "hidden" || decl.value.value === "visible")
        cfg().overflow = decl.value.value;
    }
  }
  return config;
}

/** A color/keyword/color-function Value as raw CSS text; undefined otherwise (e.g. `var()`). */
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
