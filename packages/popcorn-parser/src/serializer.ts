/**
 * Serialize a {@link StyleSheet} AST back to Popcorn DSL source.
 *
 * Two modes:
 *  - pretty  (default): 2-space indent, one declaration per line, blank line
 *    between top-level blocks — matches the style of `examples/*.css`.
 *  - minify: no comments, no optional whitespace, no trailing `;` before `}`.
 *
 * Both are value-preserving: `parse(serialize(parse(src)))` deep-equals
 * `parse(src)`. Number forms are shortened only where that does not change the
 * parsed value (`1.50`→`1.5`, `2.0`→`2`); colors are emitted verbatim because
 * the AST stores the raw color string and collapsing it (`#ffcc00`→`#fc0`)
 * would make the re-parsed value differ.
 */

import type {
  StyleSheet, Rule, Declaration, Value, KeyframeRule, KeyframeBlock,
  DefinitionRule, StateRule, Selector, VariableDefinition, CanvasConfig,
} from './ast';

export interface SerializeOptions {
  minify?: boolean;
}

export function serialize(sheet: StyleSheet, opts: SerializeOptions = {}): string {
  const min = opts.minify ?? false;
  const blocks: string[] = [];

  if (sheet.canvas || sheet.variables.length) blocks.push(rootBlock(sheet.canvas, sheet.variables, min));
  for (const kf of sheet.keyframes) blocks.push(keyframesBlock(kf, min));
  for (const def of sheet.definitions) blocks.push(defineBlock(def, min));
  for (const rule of sheet.rules) blocks.push(ruleBlock(rule, min, 0));

  return min ? blocks.join('') : blocks.join('\n\n') + '\n';
}

// --- number / value formatting -------------------------------------------

function num(n: number): string {
  if (Number.isInteger(n)) return String(n);
  let s = String(n);
  // Guard against exponential notation the parser can't read.
  if (s.includes('e') || s.includes('E')) s = n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function fmtValue(v: Value, min: boolean): string {
  switch (v.type) {
    case 'length': return num(v.value) + v.unit;
    case 'number': return num(v.value);
    case 'color': return v.value;
    case 'keyword': return v.value;
    case 'string': {
      const q = v.value.includes('"') ? "'" : '"';
      return q + v.value + q;
    }
    case 'variable': return `var(${v.name})`;
    case 'function': {
      const sep = min ? ',' : ', ';
      return `${v.name}(${v.args.map((a) => fmtValue(a, min)).join(sep)})`;
    }
    case 'list': {
      // Space-separated by default; a 'comma' list (e.g. multi-value `animation`)
      // rejoins with commas so it round-trips back to distinct groups.
      const sep = v.separator === 'comma' ? (min ? ',' : ', ') : ' ';
      return v.values.map((a) => fmtValue(a, min)).join(sep);
    }
  }
}

function fmtDecl(d: Declaration, min: boolean): string {
  return min ? `${d.property}:${fmtValue(d.value, min)}` : `${d.property}: ${fmtValue(d.value, min)}`;
}

// --- selectors ------------------------------------------------------------

function fmtSelector(sel: Selector): string {
  switch (sel.type) {
    case 'id': return '#' + sel.name;
    case 'class': return '.' + sel.name;
    case 'root': return ':root';
  }
}

// --- blocks ---------------------------------------------------------------

interface Body {
  declarations: Declaration[];
  children: Rule[];
  states: StateRule[];
}

/** Emit `<prelude> { <body> }` for a rule/definition-style block. */
function block(prelude: string, body: Body, min: boolean, depth: number): string {
  if (min) {
    const items: string[] = [];
    const { declarations, children, states } = body;
    const hasBlocks = children.length > 0 || states.length > 0;
    declarations.forEach((d, i) => {
      const last = i === declarations.length - 1 && !hasBlocks;
      items.push(fmtDecl(d, true) + (last ? '' : ';'));
    });
    for (const ch of children) items.push('>' + ruleBlock(ch, true, 0));
    for (const st of states) items.push(`&:${st.state}` + block('', { declarations: st.declarations, children: st.children, states: [] }, true, 0));
    return `${prelude}{${items.join('')}}`;
  }

  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  const lines: string[] = [];
  for (const d of body.declarations) lines.push(inner + fmtDecl(d, false) + ';');
  for (const ch of body.children) {
    lines.push('');
    lines.push(inner + '> ' + ruleBlock(ch, false, depth + 1).slice(inner.length));
  }
  for (const st of body.states) {
    lines.push('');
    lines.push(inner + block(`&:${st.state}`, { declarations: st.declarations, children: st.children, states: [] }, false, depth + 1).slice(inner.length));
  }
  return `${pad}${prelude} {\n${lines.join('\n')}\n${pad}}`;
}

function ruleBlock(rule: Rule, min: boolean, depth: number): string {
  return block(fmtSelector(rule.selector), rule, min, depth);
}

function defineBlock(def: DefinitionRule, min: boolean): string {
  return block(`@define ${def.name}`, def, min, 0);
}

// `:root` carries stage config (width/height/background) followed by custom
// properties, so it round-trips back to the same StyleSheet on re-parse.
function rootBlock(cfg: CanvasConfig | undefined, vars: VariableDefinition[], min: boolean): string {
  const decls: Declaration[] = [];
  if (cfg) {
    decls.push({ type: 'declaration', property: 'width', value: { type: 'length', value: cfg.width, unit: 'px' } });
    decls.push({ type: 'declaration', property: 'height', value: { type: 'length', value: cfg.height, unit: 'px' } });
    if (cfg.background !== undefined) {
      decls.push({ type: 'declaration', property: 'background', value: { type: 'color', value: cfg.background } });
    }
  }
  for (const v of vars) decls.push({ type: 'declaration', property: v.name, value: v.value });
  return block(':root', { declarations: decls, children: [], states: [] }, min, 0);
}

function keyframesBlock(kf: KeyframeRule, min: boolean): string {
  const blocks = kf.blocks.map((b) => keyframeBlock(b, min));
  if (min) return `@keyframes ${kf.name}{${blocks.join('')}}`;
  return `@keyframes ${kf.name} {\n${blocks.map((b) => '  ' + b).join('\n')}\n}`;
}

function keyframeBlock(b: KeyframeBlock, min: boolean): string {
  const sel = b.selectors.map((s) => num(s) + '%').join(min ? ',' : ', ');
  const decls = b.declarations.slice();
  if (b.easing) {
    decls.push({ type: 'declaration', property: 'animation-timing-function', value: b.easing });
  }
  if (min) {
    const body = decls.map((d) => fmtDecl(d, true)).join(';');
    return `${sel}{${body}}`;
  }
  const body = decls.map((d) => fmtDecl(d, false) + ';').join(' ');
  return `${sel} { ${body} }`;
}
