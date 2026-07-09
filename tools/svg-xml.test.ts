import { test, expect } from 'bun:test';
import { parseXml, type SvgNode } from './svg-xml.ts';

/** Local names of an element's direct children. */
function tags(node: SvgNode): string[] {
  return node.children.map((c) => c.tag);
}

test('parses a simple element with attributes and returns the root', () => {
  const root = parseXml('<svg width="100" height="50"></svg>');
  expect(root.tag).toBe('svg');
  expect(root.attrs.get('width')).toBe('100');
  expect(root.attrs.get('height')).toBe('50');
  expect(root.children).toEqual([]);
});

test('nesting and document-order children', () => {
  const root = parseXml('<g><rect/><circle/><path/></g>');
  expect(tags(root)).toEqual(['rect', 'circle', 'path']);
});

test('self-closing tags', () => {
  const root = parseXml('<svg><rect x="1"/></svg>');
  expect(root.children).toHaveLength(1);
  expect(root.children[0].tag).toBe('rect');
  expect(root.children[0].attrs.get('x')).toBe('1');
  expect(root.children[0].children).toEqual([]);
});

test('both quote styles for attribute values', () => {
  const root = parseXml(`<rect x='1' y="2" fill='#f00'/>`);
  expect(root.attrs.get('x')).toBe('1');
  expect(root.attrs.get('y')).toBe('2');
  expect(root.attrs.get('fill')).toBe('#f00');
});

test('predefined entities decoded in text and attribute values', () => {
  const root = parseXml('<t title="a &amp; b &lt; c">x &gt; y &quot;q&quot; &apos;a&apos;</t>');
  expect(root.attrs.get('title')).toBe('a & b < c');
  expect(root.text).toBe('x > y "q" \'a\'');
});

test('numeric character references (decimal and hex)', () => {
  const root = parseXml('<t data="&#38;&#x26;">&#65;&#x42;</t>');
  expect(root.attrs.get('data')).toBe('&&');
  expect(root.text).toBe('AB');
});

test('unknown entities pass through literally', () => {
  const root = parseXml('<t>a &nbsp; b &weird;</t>');
  expect(root.text).toBe('a &nbsp; b &weird;');
});

test('CDATA inside <style> preserved verbatim', () => {
  const root = parseXml('<style><![CDATA[ .a > .b { fill: #f00 } ]]></style>');
  expect(root.tag).toBe('style');
  expect(root.text).toBe(' .a > .b { fill: #f00 } ');
});

test('CDATA and surrounding text concatenate', () => {
  const root = parseXml('<t>before<![CDATA[<raw>]]>after</t>');
  expect(root.text).toBe('before<raw>after');
});

test('comments are skipped', () => {
  const root = parseXml('<svg><!-- hi --><rect/><!-- bye --></svg>');
  expect(tags(root)).toEqual(['rect']);
});

test('XML declaration, DOCTYPE, and leading comment in prolog are skipped', () => {
  const root = parseXml(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/svg.dtd">\n` +
    `<!-- a note -->\n` +
    `<svg><rect/></svg>`,
  );
  expect(root.tag).toBe('svg');
  expect(tags(root)).toEqual(['rect']);
});

test('DOCTYPE with internal subset is skipped', () => {
  const root = parseXml('<!DOCTYPE svg [ <!ENTITY foo "bar"> ]><svg/>');
  expect(root.tag).toBe('svg');
});

test('xlink:href normalized to href; other attrs kept verbatim', () => {
  const root = parseXml('<use xlink:href="#a" href="#b" data-x="1"/>');
  // Both map onto href; the later verbatim href wins on the shared key.
  expect(root.attrs.get('href')).toBe('#b');
  expect(root.attrs.get('data-x')).toBe('1');
  expect(root.attrs.has('xlink:href')).toBe(false);
});

test('xlink:href alone is normalized', () => {
  const root = parseXml('<use xlink:href="#icon"/>');
  expect(root.attrs.get('href')).toBe('#icon');
});

test('namespace prefixes stripped and lowercased on element names', () => {
  const root = parseXml('<svg:Svg><svg:Path/></svg:Svg>');
  expect(root.tag).toBe('svg');
  expect(root.children[0].tag).toBe('path');
});

test('boolean-ish attribute with no value is lenient (empty string)', () => {
  const root = parseXml('<rect hidden x="1"/>');
  expect(root.attrs.get('hidden')).toBe('');
  expect(root.attrs.get('x')).toBe('1');
});

test('whitespace inside and around tags is tolerated', () => {
  const root = parseXml('  <g\n  a = "1"\n >\n  <rect />\n</g>  ');
  expect(root.attrs.get('a')).toBe('1');
  expect(tags(root)).toEqual(['rect']);
});

test('mismatched close tag throws with a position', () => {
  expect(() => parseXml('<g><rect></g>')).toThrow(/mismatched close tag/);
});

test('realistic small SVG snippet round-trips its structure', () => {
  const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">
  <defs>
    <linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
  </defs>
  <g fill="url(#g)">
    <path d="M2 2 L10 10 Z"/>
    <use xlink:href="#g"/>
  </g>
</svg>`;
  const root = parseXml(svg);
  expect(root.tag).toBe('svg');
  expect(root.attrs.get('viewBox')).toBe('0 0 24 24');
  expect(tags(root)).toEqual(['defs', 'g']);

  const defs = root.children[0];
  expect(defs.children[0].tag).toBe('lineargradient');
  expect(tags(defs.children[0])).toEqual(['stop', 'stop']);

  const g = root.children[1];
  expect(g.attrs.get('fill')).toBe('url(#g)');
  expect(g.children[0].attrs.get('d')).toBe('M2 2 L10 10 Z');
  expect(g.children[1].attrs.get('href')).toBe('#g');
});
