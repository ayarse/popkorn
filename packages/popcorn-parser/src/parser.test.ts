import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from './parser';

// One assertion per Value / node kind — together these pin down the whole AST contract.

test('id rule: dimension + color', () => {
  expect(parse('#box { width: 100px; fill: #ff0000; }')).toEqual({
    type: 'stylesheet', keyframes: [], definitions: [], machines: [], variables: [],
    rules: [{
      type: 'rule', selector: { type: 'id', name: 'box' }, children: [], states: [],
      declarations: [
        { type: 'declaration', property: 'width', value: { type: 'length', value: 100, unit: 'px' } },
        { type: 'declaration', property: 'fill', value: { type: 'color', value: '#ff0000' } },
      ],
    }],
  });
});

test('class selector', () => {
  expect(parse('.circle { r: 50px; }').rules[0].selector).toEqual({ type: 'class', name: 'circle' });
});

test('number / negative / percentage values', () => {
  const decls = parse('#s { opacity: 0.5; y: -10; a: 50%; }').rules[0].declarations;
  expect(decls.map((d) => d.value)).toEqual([
    { type: 'number', value: 0.5 },
    { type: 'number', value: -10 },
    { type: 'length', value: 50, unit: '%' },
  ]);
});

test('leading-dot number (.5 / -.5) parses like 0.5 (minifier output)', () => {
  const decls = parse('#s { opacity: .5; y: -.25; d: .167s; }').rules[0].declarations;
  expect(decls.map((d) => d.value)).toEqual([
    { type: 'number', value: 0.5 },
    { type: 'number', value: -0.25 },
    { type: 'length', value: 0.167, unit: 's' },
  ]);
});

test('stage config hoisted from :root', () => {
  const ast = parse(':root { width: 800px; height: 600px; background: #1a1a2e; }');
  expect(ast.canvas).toEqual({ width: 800, height: 600, background: '#1a1a2e' });
  expect(ast.rules).toHaveLength(0);
});

test(':root with only custom properties leaves canvas unset', () => {
  const ast = parse(':root { --x: 5; }');
  expect(ast.canvas).toBeUndefined();
  expect(ast.variables).toHaveLength(1);
});

test(':root merges stage config and custom properties', () => {
  const ast = parse(':root { width: 400px; height: 300px; --accent: #f00; }');
  expect(ast.canvas).toEqual({ width: 400, height: 300 });
  expect(ast.variables).toEqual([{ name: '--accent', value: { type: 'color', value: '#f00' } }]);
});

test('root variables + input() member expression', () => {
  expect(parse(':root { --cursor-x: input(cursor.x); }').variables).toEqual([{
    name: '--cursor-x',
    value: { type: 'function', name: 'input', args: [{ type: 'keyword', value: 'cursor.x' }] },
  }]);
});

test('var() reference', () => {
  expect(parse('#f { cx: var(--cursor-x); }').rules[0].declarations[0].value)
    .toEqual({ type: 'variable', name: '--cursor-x' });
});

test('function call with dimension args', () => {
  expect(parse('#s { transform: translate(100px, 200px); }').rules[0].declarations[0].value).toEqual({
    type: 'function', name: 'translate',
    args: [{ type: 'length', value: 100, unit: 'px' }, { type: 'length', value: 200, unit: 'px' }],
  });
});

test('animation shorthand → list', () => {
  expect(parse('#box { animation: pulse 1.5s ease-in-out infinite; }').rules[0].declarations[0].value).toEqual({
    type: 'list', values: [
      { type: 'keyword', value: 'pulse' },
      { type: 'length', value: 1.5, unit: 's' },
      { type: 'keyword', value: 'ease-in-out' },
      { type: 'keyword', value: 'infinite' },
    ],
  });
});

test('comma-separated animation shorthand → comma list of space lists', () => {
  expect(parse('#box { animation: slide 1s linear 1, spin 2s ease-in-out 1 0.5s; }').rules[0].declarations[0].value).toEqual({
    type: 'list', separator: 'comma', values: [
      { type: 'list', values: [
        { type: 'keyword', value: 'slide' },
        { type: 'length', value: 1, unit: 's' },
        { type: 'keyword', value: 'linear' },
        { type: 'number', value: 1 },
      ] },
      { type: 'list', values: [
        { type: 'keyword', value: 'spin' },
        { type: 'length', value: 2, unit: 's' },
        { type: 'keyword', value: 'ease-in-out' },
        { type: 'number', value: 1 },
        { type: 'length', value: 0.5, unit: 's' },
      ] },
    ],
  });
});

test('stroke-dasharray → list of lengths', () => {
  expect(parse('#p { stroke-dasharray: 5px 3px 2px; }').rules[0].declarations[0].value).toEqual({
    type: 'list', values: [
      { type: 'length', value: 5, unit: 'px' },
      { type: 'length', value: 3, unit: 'px' },
      { type: 'length', value: 2, unit: 'px' },
    ],
  });
});

test('keyframes from/to', () => {
  const kf = parse('@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }').keyframes[0];
  expect(kf.name).toBe('spin');
  expect(kf.blocks.map((b) => b.selectors)).toEqual([[0], [100]]);
});

test('keyframes multi-selector 0%, 100%', () => {
  const kf = parse('@keyframes pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.3) } }').keyframes[0];
  expect(kf.blocks.map((b) => b.selectors)).toEqual([[0, 100], [50]]);
});

test('per-keyframe easing hoisted off declarations', () => {
  const block = parse('@keyframes k { 0% { opacity: 0; animation-timing-function: ease-in; } }').keyframes[0].blocks[0];
  expect(block.easing).toEqual({ type: 'keyword', value: 'ease-in' });
  expect(block.declarations.map((d) => d.property)).toEqual(['opacity']);
});

test('per-keyframe easing keeps steps()/linear() verbatim', () => {
  const s = parse('@keyframes k { 0% { opacity: 0; animation-timing-function: steps(3, jump-end); } 50% { opacity: 1; animation-timing-function: linear(0, 0.5 50%, 1); } }').keyframes[0];
  expect(s.blocks[0].easing).toEqual({
    type: 'function',
    name: 'steps',
    args: [{ type: 'number', value: 3 }, { type: 'keyword', value: 'jump-end' }],
  });
  const lin = s.blocks[1].easing;
  expect(lin && lin.type === 'function' && lin.name).toBe('linear');
});

test('nested child rule', () => {
  const child = parse('#p { type: group; > #c { type: circle; r: 20px; } }').rules[0].children[0];
  expect(child.selector).toEqual({ type: 'id', name: 'c' });
  expect(child.declarations).toHaveLength(2);
});

test('pseudo hover + active with transform', () => {
  const states = parse('#b { fill: #3498db; &:hover { fill: #2980b9; transform: scale(1.05); } &:active { fill: #1a5276; } }').rules[0].states;
  expect(states.map((s) => s.state)).toEqual(['hover', 'active']);
  expect(states[0].declarations).toHaveLength(2);
});

test('state block with child rule (&:hover > #c)', () => {
  const state = parse(
    '#card { fill: #111; &:hover { fill: #2a2a4a; > #icon { transform: rotate(15deg); } } }'
  ).rules[0].states[0];
  expect(state.state).toBe('hover');
  expect(state.declarations.map((d) => d.property)).toEqual(['fill']);
  expect(state.children).toHaveLength(1);
  expect(state.children[0].selector).toEqual({ type: 'id', name: 'icon' });
  expect(state.children[0].declarations[0].property).toBe('transform');
});

test('@define: declarations + nested child + state', () => {
  const ast = parse(`@define spark {
    type: circle; r: 5px; fill: #fbbf24;
    &:hover { fill: #f00; }
    > #tail { type: rect; width: 2px; }
  }`);
  expect(ast.rules).toHaveLength(0);
  expect(ast.definitions).toHaveLength(1);
  const def = ast.definitions[0];
  expect(def.type).toBe('definition');
  expect(def.name).toBe('spark');
  expect(def.declarations.map((d) => d.property)).toEqual(['type', 'r', 'fill']);
  expect(def.states.map((s) => s.state)).toEqual(['hover']);
  expect(def.children[0].selector).toEqual({ type: 'id', name: 'tail' });
});

test('@define: multiple definitions collected in order', () => {
  const ast = parse('@define a { r: 1px; } @define b { r: 2px; }');
  expect(ast.definitions.map((d) => d.name)).toEqual(['a', 'b']);
});

test('use: is a normal keyword declaration', () => {
  const decl = parse('#spark1 { use: spark; cx: 100px; }').rules[0].declarations[0];
  expect(decl).toEqual({ type: 'declaration', property: 'use', value: { type: 'keyword', value: 'spark' } });
});

test('hex value is a color; non-hex #ident is a node-id keyword (mask reference)', () => {
  const decls = parse('#n { fill: #abc; mask: #myLayer alpha; }').rules[0].declarations;
  expect(decls[0].value).toEqual({ type: 'color', value: '#abc' });
  // `mask: #myLayer alpha` -> list of a #-prefixed id keyword + a mode keyword.
  expect(decls[1].value).toEqual({
    type: 'list',
    values: [{ type: 'keyword', value: '#myLayer' }, { type: 'keyword', value: 'alpha' }],
  });
});

test('#ident starting with hex-like chars is a node-id keyword, not a truncated color', () => {
  // `#Background…` must not lex as the hex color `#Bac` (B,a,c are hex) with the
  // rest dangling — it is a full node-id mask reference.
  const decls = parse('#n { mask: #Background-Big-Wave alpha; }').rules[0].declarations;
  expect(decls[0].value).toEqual({
    type: 'list',
    values: [{ type: 'keyword', value: '#Background-Big-Wave' }, { type: 'keyword', value: 'alpha' }],
  });
  // A genuine hex color still parses as a color.
  expect(parse('#n { fill: #abc; }').rules[0].declarations[0].value).toEqual({ type: 'color', value: '#abc' });
});

test('comment ignored', () => {
  const ast = parse('/* hi */ #box { fill: #fff; }');
  expect(ast.rules).toHaveLength(1);
  expect(ast.rules[0].declarations[0].value).toEqual({ type: 'color', value: '#fff' });
});

test('string value (path d)', () => {
  expect(parse('#p { type: path; d: "M 10 10 L 50 50 Z"; }').rules[0].declarations[1].value)
    .toEqual({ type: 'string', value: 'M 10 10 L 50 50 Z' });
});

// --- @machine state machines ---------------------------------------------

test('@machine: full cat example — structure, initial, states, any-state', () => {
  const ast = parse(`@machine cat {
    initial: idle;
    state idle {
      to: excited on click(#hitbox);
      to: hyper when style(--energy > 80) mix 300ms ease-in-out;
    }
    state excited { to: idle on complete; }
    state hyper {
      to: idle when style(--energy <= 80) mix 300ms;
      emit: overheat;
    }
    state * { to: idle on event(reset); }
  }`);
  expect(ast.rules).toHaveLength(0);
  expect(ast.machines).toHaveLength(1);
  const m = ast.machines[0];
  expect(m.type).toBe('machine');
  expect(m.name).toBe('cat');
  expect(m.initial).toBe('idle');
  expect(m.states.map((s) => s.name)).toEqual(['idle', 'excited', 'hyper', '*']);
  // Declaration order == transition priority order.
  expect(m.states[0].transitions.map((t) => t.to)).toEqual(['excited', 'hyper']);
  expect(m.states[2].emits).toEqual(['overheat']);
});

test('@machine: pointer trigger on #id', () => {
  const t = parse('@machine m { initial: a; state a { to: b on click(#hitbox); } }')
    .machines[0].states[0].transitions[0];
  expect(t).toEqual({
    to: 'b',
    trigger: { kind: 'pointer', event: 'click', target: { type: 'id', name: 'hitbox' } },
    guards: [],
    mix: null,
  });
});

test('@machine: pointer trigger on :root (tap anywhere)', () => {
  const t = parse('@machine m { initial: a; state a { to: b on pointerdown(:root); } }')
    .machines[0].states[0].transitions[0];
  expect(t.trigger).toEqual({ kind: 'pointer', event: 'pointerdown', target: { type: 'root', name: 'root' } });
});

test('@machine: all pointer event kinds parse', () => {
  const events = ['click', 'pointerdown', 'pointerup', 'hoverstart', 'hoverend'];
  for (const ev of events) {
    const t = parse(`@machine m { initial: a; state a { to: b on ${ev}(#x); } }`)
      .machines[0].states[0].transitions[0];
    expect(t.trigger).toEqual({ kind: 'pointer', event: ev, target: { type: 'id', name: 'x' } });
  }
});

test('@machine: complete and event(name) triggers', () => {
  const done = parse('@machine m { initial: a; state a { to: b on complete; } }')
    .machines[0].states[0].transitions[0];
  expect(done.trigger).toEqual({ kind: 'complete' });
  const ev = parse('@machine m { initial: a; state a { to: b on event(reset); } }')
    .machines[0].states[0].transitions[0];
  expect(ev.trigger).toEqual({ kind: 'event', name: 'reset' });
});

test('@machine: numeric guard on --var', () => {
  const t = parse('@machine m { initial: a; state a { to: b when style(--energy > 80); } }')
    .machines[0].states[0].transitions[0];
  expect(t.guards).toEqual([{ left: { kind: 'var', name: '--energy' }, op: '>', right: 80 }]);
});

test('@machine: colon guard reads as equality; keyword right side', () => {
  const t = parse('@machine m { initial: a; state a { to: b when style(--mood: happy); } }')
    .machines[0].states[0].transitions[0];
  expect(t.guards).toEqual([{ left: { kind: 'var', name: '--mood' }, op: '=', right: 'happy' }]);
});

test('@machine: input() path guard', () => {
  const t = parse('@machine m { initial: a; state a { to: b when style(input(cursor.x) < 400); } }')
    .machines[0].states[0].transitions[0];
  expect(t.guards).toEqual([{ left: { kind: 'input', path: 'cursor.x' }, op: '<', right: 400 }]);
});

test('@machine: state-time guard normalizes time to ms (2s -> 2000, 500ms -> 500)', () => {
  const s = parse('@machine m { initial: a; state a { to: b when style(state-time > 2s); } }')
    .machines[0].states[0].transitions[0];
  expect(s.guards).toEqual([{ left: { kind: 'state-time' }, op: '>', right: 2000 }]);
  const ms = parse('@machine m { initial: a; state a { to: b when style(state-time > 500ms); } }')
    .machines[0].states[0].transitions[0];
  expect(ms.guards[0].right).toBe(500);
});

test('@machine: all comparison operators', () => {
  const cases: Array<[string, string]> = [
    ['=', '='], ['!=', '!='], ['<', '<'], ['<=', '<='], ['>', '>'], ['>=', '>='],
  ];
  for (const [src, op] of cases) {
    const t = parse(`@machine m { initial: a; state a { to: b when style(--e ${src} 5); } }`)
      .machines[0].states[0].transitions[0];
    expect(t.guards[0].op).toBe(op);
  }
});

test('@machine: boolean guard right side', () => {
  const t = parse('@machine m { initial: a; state a { to: b when style(--pressed = true); } }')
    .machines[0].states[0].transitions[0];
  expect(t.guards[0].right).toBe(true);
});

test('@machine: on + when combined, and chained guards preserve order', () => {
  const t = parse(`@machine m { initial: a; state a {
    to: b on click(#x) when style(--energy > 80) and style(input(cursor.x) < 400);
  } }`).machines[0].states[0].transitions[0];
  expect(t.trigger).toEqual({ kind: 'pointer', event: 'click', target: { type: 'id', name: 'x' } });
  expect(t.guards).toEqual([
    { left: { kind: 'var', name: '--energy' }, op: '>', right: 80 },
    { left: { kind: 'input', path: 'cursor.x' }, op: '<', right: 400 },
  ]);
});

test('@machine: mix with easing and without', () => {
  const withEasing = parse('@machine m { initial: a; state a { to: b when style(--e > 1) mix 300ms ease-in-out; } }')
    .machines[0].states[0].transitions[0];
  expect(withEasing.mix).toEqual({ duration: 300, easing: 'ease-in-out' });
  const bare = parse('@machine m { initial: a; state a { to: b when style(--e > 1) mix 300ms; } }')
    .machines[0].states[0].transitions[0];
  expect(bare.mix).toEqual({ duration: 300, easing: null });
  const secs = parse('@machine m { initial: a; state a { to: b mix 2s; } }')
    .machines[0].states[0].transitions[0];
  expect(secs.mix).toEqual({ duration: 2000, easing: null });
});

test('@machine: bare unconditional transition (no trigger/guards/mix)', () => {
  const t = parse('@machine m { initial: a; state a { to: b; } }')
    .machines[0].states[0].transitions[0];
  expect(t).toEqual({ to: 'b', trigger: null, guards: [], mix: null });
});

test('@machine: multiple machines collected in order, run concurrently', () => {
  const ast = parse('@machine blink { initial: on; state on { to: off; } } @machine btn { initial: up; state up { } }');
  expect(ast.machines.map((m) => m.name)).toEqual(['blink', 'btn']);
});

test('@machine: minified (whitespace-stripped) parses identically', () => {
  const src = `@machine cat {
    initial: idle;
    state idle { to: excited on click(#hitbox); to: hyper when style(--energy > 80) mix 300ms ease-in-out; }
    state * { to: idle on event(reset); }
  }`;
  expect(parse(stripWs(src))).toEqual(parse(src));
});

// --- :state() pseudo blocks ----------------------------------------------

test(':state(name) block — un-namespaced', () => {
  const st = parse('#cat { fill: #111; &:state(idle) { fill: #f44; } }').rules[0].states[0];
  expect(st.state).toBe('state');
  expect(st.machineState).toEqual({ machine: null, name: 'idle' });
  expect(st.declarations.map((d) => d.property)).toEqual(['fill']);
});

test(':state(machine.name) namespaced block with nested > child', () => {
  const st = parse('#cat { &:state(cat.excited) { fill: #f44; > #eye { r: 3px; } } }').rules[0].states[0];
  expect(st.machineState).toEqual({ machine: 'cat', name: 'excited' });
  expect(st.children).toHaveLength(1);
  expect(st.children[0].selector).toEqual({ type: 'id', name: 'eye' });
  expect(st.children[0].declarations[0].property).toBe('r');
});

test(':state() coexists with &:hover; hover unchanged and still present', () => {
  const states = parse('#c { &:hover { fill: #0f0; } &:state(idle) { fill: #00f; } }').rules[0].states;
  expect(states.map((s) => s.state)).toEqual(['hover', 'state']);
  expect(states[0].machineState).toBeUndefined();
  expect(states[1].machineState).toEqual({ machine: null, name: 'idle' });
});

test('--tap: trigger; is a normal keyword variable declaration', () => {
  const ast = parse(':root { --tap: trigger; --energy: 0; --pressed: false; }');
  expect(ast.variables).toEqual([
    { name: '--tap', value: { type: 'keyword', value: 'trigger' } },
    { name: '--energy', value: { type: 'number', value: 0 } },
    { name: '--pressed', value: { type: 'keyword', value: 'false' } },
  ]);
});

// The real example scenes must parse end-to-end (recursing into subdirs like
// examples/lottie/ so converter output is exercised too).
const examplesDir = fileURLToPath(new URL('../../../examples', import.meta.url));
function collectCss(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...collectCss(`${dir}/${entry.name}`, `${prefix}${entry.name}/`));
    else if (entry.name.endsWith('.css')) out.push(`${prefix}${entry.name}`);
  }
  return out;
}
for (const file of collectCss(examplesDir)) {
  test(`example scene: ${file}`, () => {
    expect(parse(readFileSync(`${examplesDir}/${file}`, 'utf8')).type).toBe('stylesheet');
  });
}

// Parser robustness on minified input: strip every *optional* whitespace and
// assert the AST is unchanged. `stripWs` mirrors a conservative minifier —
// remove whitespace adjacent to `{ } ; : , > ( )`, collapse the rest to a
// single space (the space that separates list values is syntactically
// required, so it must survive) — while leaving string literals untouched.
const PUNCT = '{};:,>()';
function stripWs(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') { // comment
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") { // string literal — copy verbatim
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j++;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      out += ' ';
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  let res = '';
  for (let i = 0; i < out.length; ) {
    const ch = out[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < out.length && out[j] !== ch) j++;
      res += out.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === ' ') {
      const prev = res[res.length - 1];
      const next = out[i + 1];
      if (prev === undefined || next === undefined || PUNCT.includes(prev) || PUNCT.includes(next)) { i++; continue; }
      res += ' ';
      i++;
      continue;
    }
    res += ch;
    i++;
  }
  return res.trim();
}

for (const file of collectCss(examplesDir)) {
  test(`minified (whitespace-stripped) parses identically: ${file}`, () => {
    const src = readFileSync(`${examplesDir}/${file}`, 'utf8');
    expect(parse(stripWs(src))).toEqual(parse(src));
  });
}
