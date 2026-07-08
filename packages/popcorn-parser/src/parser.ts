/**
 * Hand-rolled parser for the Popcorn DSL.
 *
 * A tokenizing recursive-descent parser that turns CSS-like source directly
 * into the {@link StyleSheet} AST. Synchronous, zero-dependency — the DSL is a
 * small CSS subset, so a dedicated grammar/parser-generator would be far more
 * machinery than the language needs.
 */

import type {
  StyleSheet, Rule, Selector, Declaration, Value, KeyframeRule, KeyframeBlock,
  CanvasConfig, VariableDefinition, PseudoState, DefinitionRule, StateRule,
} from './ast';

const IDENT = /[a-zA-Z_][a-zA-Z0-9_\-]*/y;
const CUSTOM = /--[a-zA-Z_][a-zA-Z0-9_\-]*/y;
// Accept a leading-dot fraction (`.5`) as well as `10` / `10.5` — CSS allows it
// and minifiers (esbuild) emit it by stripping the leading zero.
const NUMBER = /-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/y;
const COLOR = /#[0-9a-fA-F]{3,8}/y;
// Longest-first so 'ms' beats 's' and 'rem' beats 'em'.
const UNITS = ['deg', 'rem', 'px', 'em', 'ms', 's'] as const;

class Cursor {
  pos = 0;
  constructor(readonly src: string) {}

  /** Skip whitespace and `/* *\/` comments. */
  ws(): void {
    for (;;) {
      const c = this.src[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { this.pos++; continue; }
      if (c === '/' && this.src[this.pos + 1] === '*') {
        this.pos += 2;
        while (this.pos < this.src.length && !(this.src[this.pos] === '*' && this.src[this.pos + 1] === '/')) this.pos++;
        this.pos += 2;
        continue;
      }
      break;
    }
  }

  eof(): boolean { this.ws(); return this.pos >= this.src.length; }
  peek(): string { this.ws(); return this.src[this.pos]; }

  eat(str: string): boolean {
    this.ws();
    if (this.src.startsWith(str, this.pos)) { this.pos += str.length; return true; }
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
    if (m && m.index === this.pos) { this.pos += m[0].length; return m[0]; }
    return null;
  }

  ident(): string {
    const m = this.match(IDENT);
    if (m === null) throw new Error(this.errorAt('expected identifier'));
    return m;
  }

  errorAt(what: string): string {
    return `${what} at offset ${this.pos}: ${JSON.stringify(this.src.slice(this.pos, this.pos + 24))}`;
  }
}

/** Parse Popcorn DSL source into a {@link StyleSheet} AST. */
export function parse(source: string): StyleSheet {
  const c = new Cursor(source);
  const sheet: StyleSheet = { type: 'stylesheet', rules: [], keyframes: [], definitions: [], variables: [] };

  while (!c.eof()) {
    if (c.eat('@keyframes')) {
      sheet.keyframes.push(parseKeyframes(c));
      continue;
    }
    if (c.eat('@define')) {
      sheet.definitions.push(parseDefine(c));
      continue;
    }
    const rule = parseRule(c);
    if (rule.selector.type === 'root') {
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
  if (ch === '#') { c.expect('#'); return { type: 'id', name: c.ident() }; }
  if (ch === '.') { c.expect('.'); return { type: 'class', name: c.ident() }; }
  if (ch === ':') {
    c.expect(':');
    const kw = c.ident();
    if (kw === 'root') return { type: 'root', name: 'root' };
    throw new Error(`unknown selector ':${kw}'`);
  }
  throw new Error(c.errorAt('expected a selector'));
}

function parseRule(c: Cursor): Rule {
  const selector = parseSelector(c);
  return { type: 'rule', selector, ...parseRuleBody(c) };
}

// `@define <name> { <rule body> }` — same body grammar as a rule.
function parseDefine(c: Cursor): DefinitionRule {
  const name = c.ident();
  return { type: 'definition', name, ...parseRuleBody(c) };
}

/** Parse `{ decls, > children, &:state blocks }` shared by rules and @define. */
function parseRuleBody(c: Cursor): { declarations: Declaration[]; children: Rule[]; states: StateRule[] } {
  c.expect('{');
  const declarations: Declaration[] = [];
  const children: Rule[] = [];
  const states: StateRule[] = [];

  while (!c.eat('}')) {
    if (c.eat('>')) {
      // Nested child rule: `> #child { ... }`
      children.push(parseRule(c));
    } else if (c.eat('&')) {
      // Pseudo-class state: `&:hover { ... }` / `&:active { ... }`
      c.expect(':');
      const state = c.ident() as PseudoState;
      states.push({ state, declarations: parseDeclBlock(c).declarations });
    } else {
      declarations.push(parseDeclaration(c));
    }
  }
  return { declarations, children, states };
}

function parseDeclaration(c: Cursor): Declaration {
  const property = c.match(CUSTOM) ?? c.ident();
  c.expect(':');
  // A value is one or more comma-separated groups, each a space-separated list
  // (CSS `animation: a 1s, b 2s`). Comma-free values keep the old shape exactly:
  // a lone value, or a plain space `list` with no separator.
  const groups: Value[] = [];
  for (;;) {
    const values = parseValueList(c);
    groups.push(values.length === 1 ? values[0] : { type: 'list', values });
    if (!c.eat(',')) break;
  }
  c.eat(';'); // optional trailing semicolon
  return {
    type: 'declaration',
    property,
    value: groups.length === 1 ? groups[0] : { type: 'list', values: groups, separator: 'comma' },
  };
}

function parseValueList(c: Cursor): Value[] {
  const values: Value[] = [];
  for (;;) {
    const ch = c.peek();
    if (ch === undefined || ch === ';' || ch === '}' || ch === ')' || ch === ',') break;
    values.push(parseValue(c));
  }
  return values;
}

function parseValue(c: Cursor): Value {
  const ch = c.peek();

  if (ch === '#') {
    // A hex color, or — when the hash isn't hex (e.g. `#myLayer`) — a reference
    // to a node id (used by `mask: #id ...`). Kept as a keyword so no new AST
    // node kind is needed; the builder strips the leading '#'.
    const col = c.match(COLOR);
    if (col) return { type: 'color', value: col };
    c.expect('#');
    return { type: 'keyword', value: '#' + c.ident() };
  }
  if (ch === '"' || ch === "'") return readString(c, ch);
  if (isNumberStart(c, ch)) return readNumber(c);

  // Identifier-led: var(), function call, member expression, or bare keyword.
  const name = c.ident();
  if (name === 'var' && c.peek() === '(') {
    c.expect('(');
    const varName = c.match(CUSTOM)!;
    c.expect(')');
    return { type: 'variable', name: varName };
  }
  if (c.peek() === '(') {
    c.expect('(');
    const args: Value[] = [];
    while (!c.eat(')')) {
      if (c.eat(',')) continue;
      args.push(parseValue(c));
    }
    return { type: 'function', name, args };
  }
  if (c.peek() === '.') {
    // Member expression, e.g. `cursor.x`.
    c.expect('.');
    return { type: 'keyword', value: `${name}.${c.ident()}` };
  }
  return { type: 'keyword', value: name };
}

function readString(c: Cursor, quote: string): Value {
  c.expect(quote);
  let out = '';
  while (c.pos < c.src.length && c.src[c.pos] !== quote) out += c.src[c.pos++];
  c.pos++; // closing quote
  return { type: 'string', value: out };
}

function isNumberStart(c: Cursor, ch: string): boolean {
  if (ch >= '0' && ch <= '9') return true;
  // A leading-dot (`.5`) or signed number (`-5`, `-.5`); look one char ahead.
  if (ch === '-' || ch === '.') {
    let n = c.src[c.pos + 1];
    if (ch === '-' && n === '.') n = c.src[c.pos + 2];
    return n >= '0' && n <= '9';
  }
  return false;
}

function readNumber(c: Cursor): Value {
  const value = parseFloat(c.match(NUMBER)!);
  if (c.src[c.pos] === '%') { c.pos++; return { type: 'length', value, unit: '%' }; }
  for (const u of UNITS) {
    if (c.src.startsWith(u, c.pos)) { c.pos += u.length; return { type: 'length', value, unit: u }; }
  }
  return { type: 'number', value };
}

function parseKeyframes(c: Cursor): KeyframeRule {
  const name = c.ident();
  c.expect('{');
  const blocks: KeyframeBlock[] = [];
  while (!c.eat('}')) blocks.push(parseKeyframe(c));
  return { type: 'keyframes', name, blocks };
}

function parseKeyframe(c: Cursor): KeyframeBlock {
  // Selector list, e.g. `from`, `to`, `0%`, or `0%, 100%`.
  const selectors: number[] = [];
  for (;;) {
    if (c.eat('from')) selectors.push(0);
    else if (c.eat('to')) selectors.push(100);
    else { selectors.push(parseFloat(c.match(NUMBER)!)); c.eat('%'); }
    if (!c.eat(',')) break;
  }

  const { declarations, easing } = parseDeclBlock(c);
  const block: KeyframeBlock = { type: 'keyframe-block', selectors, declarations };
  if (easing) block.easing = easing;
  return block;
}

/** Parse `{ decl; decl; }`, hoisting `animation-timing-function` out as `easing`.
 * The easing keeps its parsed {@link Value} verbatim (keyword, cubic-bezier(),
 * steps(), linear()) so the scene builder can resolve it through the one shared
 * timing-function path — the AST stays a faithful mirror and knows no easing
 * semantics. */
function parseDeclBlock(c: Cursor): { declarations: Declaration[]; easing?: Value } {
  c.expect('{');
  const declarations: Declaration[] = [];
  let easing: Value | undefined;
  while (!c.eat('}')) {
    const d = parseDeclaration(c);
    if (d.property === 'animation-timing-function') easing = d.value;
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
    if (decl.property === 'width' && decl.value.type === 'length') cfg().width = decl.value.value;
    else if (decl.property === 'height' && decl.value.type === 'length') cfg().height = decl.value.value;
    else if (decl.property === 'background' && decl.value.type === 'color') cfg().background = decl.value.value;
  }
  return config;
}

/** Collect `--custom-property` declarations from a `:root { ... }` rule. */
function extractVariables(rule: Rule): VariableDefinition[] {
  return rule.declarations
    .filter((d) => d.property.startsWith('--'))
    .map((d) => ({ name: d.property, value: d.value }));
}
