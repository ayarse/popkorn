/**
 * Hand-rolled minimal XML reader for SVG.
 *
 * A tokenizing recursive-descent parser over the small XML subset that
 * SVG-in-the-wild uses — elements, attributes, text, CDATA. Synchronous,
 * zero-dependency, browser-safe (no DOM, no Node APIs), so both the demo's
 * Import button and a bun CLI can share it.
 *
 * Deliberately NOT a spec-complete XML parser: no DTD, no PI processing beyond
 * skipping `<?xml ...?>`, no namespace resolution (prefixes are just stripped).
 * Lenient on real-world sloppiness where cheap; mismatched close tags throw.
 */

export interface SvgNode {
  /** Lowercased local name (namespace prefix stripped for elements). */
  tag: string;
  /** Attribute names as written, except `xlink:href` normalized to `href`. */
  attrs: Map<string, string>;
  children: SvgNode[];
  /** Concatenated character data directly inside this element (incl. CDATA). */
  text?: string;
}

// Element/attribute name: a leading char plus name chars, optional `prefix:`.
const NAME = /[A-Za-z_:][\w.\-:]*/y;
const WS = /[ \t\r\n]*/y;

const PREDEFINED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

class Cursor {
  pos = 0;
  constructor(readonly src: string) {}

  /** Skip only whitespace (XML comments/PIs are handled where they may appear). */
  ws(): void {
    WS.lastIndex = this.pos;
    const m = WS.exec(this.src);
    if (m) this.pos += m[0].length;
  }

  eof(): boolean { return this.pos >= this.src.length; }
  peek(): string { return this.src[this.pos]; }

  starts(str: string): boolean { return this.src.startsWith(str, this.pos); }

  match(re: RegExp): string | null {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (m && m.index === this.pos) { this.pos += m[0].length; return m[0]; }
    return null;
  }

  errorAt(what: string): string {
    return `${what} at offset ${this.pos}: ${JSON.stringify(this.src.slice(this.pos, this.pos + 24))}`;
  }
}

/** Decode the 5 predefined entities + numeric refs; unknown refs pass through. */
function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const rep = PREDEFINED[body];
    return rep !== undefined ? rep : whole;
  });
}

/** Strip a namespace prefix from an element name and lowercase it. */
function localName(name: string): string {
  const colon = name.indexOf(':');
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

/** Normalize an attribute name: `xlink:href` → `href`, else keep verbatim. */
function attrName(name: string): string {
  return name === 'xlink:href' ? 'href' : name;
}

/** Skip a `<!-- -->` comment. Assumes the cursor is at `<!--`. */
function skipComment(c: Cursor): void {
  const end = c.src.indexOf('-->', c.pos + 4);
  c.pos = end === -1 ? c.src.length : end + 3;
}

/** Skip `<?xml ...?>` / any processing instruction. Assumes cursor at `<?`. */
function skipPI(c: Cursor): void {
  const end = c.src.indexOf('?>', c.pos + 2);
  c.pos = end === -1 ? c.src.length : end + 2;
}

/** Skip a DOCTYPE. Assumes cursor at `<!DOCTYPE` (or other `<!`). Handles `[…]`. */
function skipDoctype(c: Cursor): void {
  c.pos += 2; // past `<!`
  let depth = 0;
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === '>' && depth <= 0) { c.pos++; return; }
    c.pos++;
  }
}

/** Read the attributes of an open tag into `attrs`. Cursor sits after the name. */
function parseAttrs(c: Cursor, attrs: Map<string, string>): void {
  for (;;) {
    c.ws();
    const ch = c.peek();
    if (ch === '>' || ch === '/' || ch === undefined) return;
    const name = c.match(NAME);
    if (name === null) throw new Error(c.errorAt('expected attribute name'));
    c.ws();
    if (c.peek() === '=') {
      c.pos++; // `=`
      c.ws();
      const quote = c.peek();
      if (quote !== '"' && quote !== "'") throw new Error(c.errorAt('expected quoted attribute value'));
      c.pos++; // open quote
      const end = c.src.indexOf(quote, c.pos);
      if (end === -1) throw new Error(c.errorAt('unterminated attribute value'));
      const raw = c.src.slice(c.pos, end);
      c.pos = end + 1; // past close quote
      attrs.set(attrName(name), decodeEntities(raw));
    } else {
      // Boolean-ish attribute with no value (lenient) — store empty string.
      attrs.set(attrName(name), '');
    }
  }
}

/** Parse one element. Cursor must sit at the opening `<`. */
function parseElement(c: Cursor): SvgNode {
  c.pos++; // `<`
  const rawTag = c.match(NAME);
  if (rawTag === null) throw new Error(c.errorAt('expected element name'));
  const node: SvgNode = { tag: localName(rawTag), attrs: new Map(), children: [] };
  parseAttrs(c, node.attrs);
  c.ws();

  if (c.starts('/>')) { c.pos += 2; return node; } // self-closing
  if (c.peek() !== '>') throw new Error(c.errorAt('expected end of open tag'));
  c.pos++; // `>`

  let text = '';
  for (;;) {
    if (c.eof()) throw new Error(c.errorAt(`unexpected end of input inside <${node.tag}>`));

    if (c.starts('<![CDATA[')) {
      const end = c.src.indexOf(']]>', c.pos + 9);
      const stop = end === -1 ? c.src.length : end;
      text += c.src.slice(c.pos + 9, stop);
      c.pos = end === -1 ? c.src.length : end + 3;
      continue;
    }
    if (c.starts('<!--')) { skipComment(c); continue; }
    if (c.starts('<?')) { skipPI(c); continue; }
    if (c.starts('<!')) { skipDoctype(c); continue; }

    if (c.starts('</')) {
      c.pos += 2;
      const close = c.match(NAME);
      if (close === null) throw new Error(c.errorAt('expected close tag name'));
      c.ws();
      if (c.peek() !== '>') throw new Error(c.errorAt('expected `>` on close tag'));
      c.pos++;
      if (localName(close) !== node.tag) {
        throw new Error(`mismatched close tag </${localName(close)}> for <${node.tag}> at offset ${c.pos}`);
      }
      break;
    }

    if (c.peek() === '<') {
      node.children.push(parseElement(c));
      continue;
    }

    // Character data up to the next `<`.
    const lt = c.src.indexOf('<', c.pos);
    const stop = lt === -1 ? c.src.length : lt;
    text += decodeEntities(c.src.slice(c.pos, stop));
    c.pos = stop;
    if (lt === -1) throw new Error(c.errorAt(`unexpected end of input inside <${node.tag}>`));
  }

  if (text.trim() !== '') node.text = text;
  return node;
}

/** Parse XML source and return the root element (e.g. the `<svg>`). */
export function parseXml(source: string): SvgNode {
  const c = new Cursor(source);
  // Skip any prolog: whitespace, XML declaration, comments, DOCTYPE.
  for (;;) {
    c.ws();
    if (c.starts('<?')) { skipPI(c); continue; }
    if (c.starts('<!--')) { skipComment(c); continue; }
    if (c.starts('<!')) { skipDoctype(c); continue; }
    break;
  }
  if (c.peek() !== '<') throw new Error(c.errorAt('expected root element'));
  return parseElement(c);
}
