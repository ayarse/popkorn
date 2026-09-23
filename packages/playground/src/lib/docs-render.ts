import { Marked, type Token, type Tokens } from "marked";
import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-css";
import "prismjs/components/prism-css-extras";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import { DOCS, docDiagram, docSource, GITHUB_REPO } from "@/lib/docs";

// Prism's bash grammar only knows common coreutils; color any line-leading
// command (`bun`, `popkorn-convert`) too.
Prism.languages.insertBefore("bash", "function", {
  command: {
    pattern: /(^|[\n;&|]\s*)(?:sudo\s+)?[a-z][\w.-]*(?=\s|$)/m,
    lookbehind: true,
    alias: "function",
  },
});

// Docs markdown → HTML segments, rendered identically on server and client.
// Highlighting happens here (not in a client effect) so SSR ships colored code.

export type DocSegment =
  | { kind: "html"; html: string }
  | { kind: "scene"; source: string };

const LANG_ALIAS: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  js: "javascript",
  html: "markup",
  xml: "markup",
  svg: "markup",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Highlighted HTML for `text`, or escaped text when the language is unknown. */
export function highlight(text: string, lang: string): string {
  const key = LANG_ALIAS[lang] ?? lang;
  const grammar = Prism.languages[key];
  return grammar ? Prism.highlight(text, grammar, key) : escapeHtml(text);
}

function codeBlock(text: string, lang = ""): string {
  const key = LANG_ALIAS[lang] ?? lang;
  const body = highlight(text, lang);
  const label = lang
    ? `<span class="code-lang">${escapeHtml(lang)}</span>`
    : "<span></span>";
  return `<div class="code-block"><div class="code-head">${label}<button type="button" class="code-copy" data-copy>Copy</button></div><pre class="language-${key}"><code class="language-${key}">${body}</code></pre></div>`;
}

// Repo-relative link → docs route or GitHub. Absolute URLs and anchors pass through.
function rewriteHref(href: string): string {
  if (/^([a-z]+:|#|\/)/i.test(href)) return href;
  const [raw, hash = ""] = href.split("#");
  const path = raw.replace(/^\.\//, "");
  const anchor = hash ? `#${hash}` : "";
  const doc = DOCS.find((d) => d.file === path);
  if (doc) return `/docs/${doc.key}${anchor}`;
  if (path === "README.md" || path === "") return `/docs${anchor}`;
  if (path === "../README.md") return `${GITHUB_REPO}${anchor}`;
  const repoPath = path.startsWith("../")
    ? path.replace(/^(\.\.\/)+/, "")
    : `docs/${path}`;
  const kind = /\.[a-z]+$/i.test(repoPath) ? "blob" : "tree";
  return `${GITHUB_REPO}/${kind}/main/${repoPath}${anchor}`;
}

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

let slugCounts = new Map<string, number>();

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    code({ text, lang }: Tokens.Code) {
      return codeBlock(text, lang?.split(/\s/)[0]);
    },
    heading({ tokens, depth }: Tokens.Heading) {
      const inner = this.parser.parseInline(tokens);
      if (depth === 1) return `<h1>${inner}</h1>\n`;
      const base =
        slugify(tokens.map((t) => ("text" in t ? t.text : "")).join("")) ||
        "section";
      const n = (slugCounts.get(base) ?? 0) + 1;
      slugCounts.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      return `<h${depth} id="${id}">${inner}<a class="heading-anchor" href="#${id}" aria-label="Link to this section"></a></h${depth}>\n`;
    },
    // Diagrams inline so they take the site's theme (on GitHub they stay <img>).
    image({ href }: Tokens.Image) {
      const svg = docDiagram(href);
      if (!svg) return false;
      return `<figure class="diagram">${svg.replace(/<\?xml[^>]*>/, "")}</figure>`;
    },
    blockquote({ text }: Tokens.Blockquote) {
      const m = CALLOUT.exec(text);
      if (!m) return false;
      const kind = m[1].toLowerCase();
      const inner = md.parser(md.lexer(text.slice(m[0].length)));
      return `<div class="callout callout-${kind}"><p class="callout-title">${kind}</p>${inner}</div>\n`;
    },
  },
});

/** A css fence with a `:root` block is a whole scene: render it live. */
function isScene(t: Token): t is Tokens.Code {
  return (
    t.type === "code" &&
    (t as Tokens.Code).lang === "css" &&
    /:root\s*\{/.test((t as Tokens.Code).text)
  );
}

export function renderDoc(file: string): DocSegment[] {
  slugCounts = new Map();
  const tokens = md.lexer(docSource(file));
  md.walkTokens(tokens, (t) => {
    if (t.type === "link") t.href = rewriteHref(t.href);
  });
  const out: DocSegment[] = [];
  let buf: Token[] = [];
  const flush = () => {
    if (buf.length) out.push({ kind: "html", html: md.parser(buf) });
    buf = [];
  };
  for (const t of tokens) {
    if (isScene(t)) {
      flush();
      out.push({ kind: "scene", source: t.text });
    } else buf.push(t);
  }
  flush();
  return out;
}
