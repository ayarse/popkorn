import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from './parser';

// One assertion per Value / node kind — together these pin down the whole AST contract.

test('id rule: dimension + color', () => {
  expect(parse('#box { width: 100px; fill: #ff0000; }')).toEqual({
    type: 'stylesheet', keyframes: [], definitions: [], variables: [],
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

test('canvas config hoisted', () => {
  const ast = parse(':canvas { width: 800px; height: 600px; background: #1a1a2e; }');
  expect(ast.canvas).toEqual({ width: 800, height: 600, background: '#1a1a2e' });
  expect(ast.rules).toHaveLength(0);
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
  expect(block.easing).toBe('ease-in');
  expect(block.declarations.map((d) => d.property)).toEqual(['opacity']);
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

test('comment ignored', () => {
  const ast = parse('/* hi */ #box { fill: #fff; }');
  expect(ast.rules).toHaveLength(1);
  expect(ast.rules[0].declarations[0].value).toEqual({ type: 'color', value: '#fff' });
});

test('string value (path d)', () => {
  expect(parse('#p { type: path; d: "M 10 10 L 50 50 Z"; }').rules[0].declarations[1].value)
    .toEqual({ type: 'string', value: 'M 10 10 L 50 50 Z' });
});

// The real example scenes must parse end-to-end.
const examplesDir = fileURLToPath(new URL('../../../examples', import.meta.url));
for (const file of readdirSync(examplesDir).filter((f) => f.endsWith('.css'))) {
  test(`example scene: ${file}`, () => {
    expect(parse(readFileSync(`${examplesDir}/${file}`, 'utf8')).type).toBe('stylesheet');
  });
}
