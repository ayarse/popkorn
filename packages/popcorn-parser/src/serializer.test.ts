import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from './parser';
import { serialize } from './serializer';

// The correctness gate: serialize is value-preserving in both modes, i.e.
// parse(serialize(parse(src))) deep-equals parse(src).

test('minify: no optional whitespace, no trailing ; before }', () => {
  const out = serialize(parse('#box { width: 100px; fill: #ff0000; }'), { minify: true });
  expect(out).toBe('#box{width:100px;fill:#ff0000}');
});

test('minify: number shortening is value-preserving (1.50→1.5, 2.0→2)', () => {
  const out = serialize(parse('#s { a: 1.50; b: 2.0; c: 0.7px; }'), { minify: true });
  expect(out).toBe('#s{a:1.5;b:2;c:0.7px}');
  expect(parse(out)).toEqual(parse('#s { a: 1.50; b: 2.0; c: 0.7px; }'));
});

test('pretty: 2-space indent, one decl per line', () => {
  expect(serialize(parse('#box { width: 100px; fill: #ff0000; }'))).toBe(
    '#box {\n  width: 100px;\n  fill: #ff0000;\n}\n',
  );
});

test('minify: nested child (>) and pseudo-state (&:) survive', () => {
  const src = '#p { type: group; > #c { r: 20px; } &:hover { fill: #f00; } }';
  const out = serialize(parse(src), { minify: true });
  expect(parse(out)).toEqual(parse(src));
  expect(out).toBe('#p{type:group;>#c{r:20px}&:hover{fill:#f00}}');
});

test('state-block child rule (&:hover > #c) round-trips both modes', () => {
  const src = '#card { fill: #111; &:hover { fill: #2a2a4a; > #icon { transform: rotate(15deg); } } }';
  const min = serialize(parse(src), { minify: true });
  expect(parse(min)).toEqual(parse(src));
  expect(min).toBe('#card{fill:#111;&:hover{fill:#2a2a4a;>#icon{transform:rotate(15deg)}}}');
  expect(parse(serialize(parse(src)))).toEqual(parse(src));
});

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
  for (const minify of [false, true]) {
    test(`round-trip ${minify ? 'minify' : 'pretty'}: ${file}`, () => {
      const ast = parse(readFileSync(`${examplesDir}/${file}`, 'utf8'));
      expect(parse(serialize(ast, { minify }))).toEqual(ast);
    });
  }
}
