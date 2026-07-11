import { parse } from "@popkorn/parser";
import { applyEdits } from "./edits";

export type ToolContext = {
  getSource(): string;
  commit(next: string): void;
  // Optional curated gallery scenes for the read_example tool. Absent (the
  // default) → the tool reports that no examples are available.
  examples?: { name: string; source: string }[];
};

// ----------------------------------------------------------------------------
// Outline scanner
//
// A brace-depth scanner over the raw text — deliberately NOT the parser/AST, so
// the outline stays cheap and survives sources that don't fully parse. It honors
// /* */ comments and single/double-quoted strings so braces inside them don't
// count toward nesting.
// ----------------------------------------------------------------------------

type TopItem =
  | { kind: "decl"; prop: string }
  | {
      kind: "block";
      header: string;
      inner: string;
      startLine: number;
      endLine: number;
    };

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function declProp(buf: string): string {
  const colon = buf.indexOf(":");
  if (colon === -1) return "";
  const prop = buf.slice(0, colon).trim();
  return /^--?[a-zA-Z][\w-]*$|^[a-zA-Z][\w-]*$/.test(prop) ? prop : "";
}

// Scan the top level of `text`: emit declarations and balanced `{}` blocks in
// document order. Line numbers are 1-indexed and offset by `baseLine`.
function scanTop(text: string, baseLine = 1): TopItem[] {
  const items: TopItem[] = [];
  const n = text.length;
  let i = 0;
  let line = baseLine;

  const eatComment = () => {
    i += 2; // past /*
    while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
      if (text[i] === "\n") line++;
      i++;
    }
    i += 2; // past */ (overshoot on unterminated is harmless — clamped by i<n)
  };
  const eatString = () => {
    const q = text[i];
    i++;
    while (i < n && text[i] !== q) {
      if (text[i] === "\\") {
        i++;
        if (i < n) {
          if (text[i] === "\n") line++;
          i++;
        }
        continue;
      }
      if (text[i] === "\n") line++;
      i++;
    }
    if (i < n) i++; // closing quote
  };

  let buf = "";
  let bufStartLine = line;
  let haveStart = false;

  const flushDecl = () => {
    const prop = declProp(buf);
    if (prop) items.push({ kind: "decl", prop });
    buf = "";
    haveStart = false;
  };

  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      eatComment();
      continue;
    }
    if (c === '"' || c === "'") {
      if (!haveStart) {
        bufStartLine = line;
        haveStart = true;
      }
      const start = i;
      eatString();
      buf += text.slice(start, i);
      continue;
    }
    if (c === ";") {
      flushDecl();
      i++;
      continue;
    }
    if (c === "{") {
      const header = normalizeWs(buf);
      const headerLine = haveStart ? bufStartLine : line;
      i++; // past {
      const innerStartIdx = i;
      let depth = 1;
      while (i < n && depth > 0) {
        const d = text[i];
        if (d === "/" && text[i + 1] === "*") {
          eatComment();
          continue;
        }
        if (d === '"' || d === "'") {
          eatString();
          continue;
        }
        if (d === "{") {
          depth++;
          i++;
          continue;
        }
        if (d === "}") {
          depth--;
          i++;
          continue;
        }
        if (d === "\n") line++;
        i++;
      }
      const closeIdx = depth === 0 ? i - 1 : i;
      const inner = text.slice(innerStartIdx, closeIdx);
      items.push({
        kind: "block",
        header,
        inner,
        startLine: headerLine,
        endLine: line,
      });
      buf = "";
      haveStart = false;
      continue;
    }
    if (c === "\n") {
      line++;
      buf += c;
      i++;
      continue;
    }
    if (!haveStart && !/\s/.test(c)) {
      bufStartLine = line;
      haveStart = true;
    }
    buf += c;
    i++;
  }
  flushDecl(); // trailing semicolon-less declaration
  return items;
}

function topBlocks(source: string): Extract<TopItem, { kind: "block" }>[] {
  return scanTop(source).filter(
    (it): it is Extract<TopItem, { kind: "block" }> => it.kind === "block",
  );
}

function truncateList(names: string[], max: number): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")}, …(+${names.length - max})`;
}

function summarize(block: Extract<TopItem, { kind: "block" }>): string {
  const items = scanTop(block.inner);
  if (/^@keyframes\b/.test(block.header)) {
    // Animated property names across all keyframe steps. animation-timing-function
    // is easing metadata, not an animated channel — NOTE: excluded on purpose.
    const props: string[] = [];
    for (const it of items) {
      if (it.kind !== "block") continue;
      for (const d of scanTop(it.inner)) {
        if (
          d.kind === "decl" &&
          d.prop !== "animation-timing-function" &&
          !props.includes(d.prop)
        ) {
          props.push(d.prop);
        }
      }
    }
    return props.length ? `animates ${truncateList(props, 10)}` : "(empty)";
  }
  const props: string[] = [];
  let nested = 0;
  for (const it of items) {
    if (it.kind === "decl") {
      if (!props.includes(it.prop)) props.push(it.prop);
    } else {
      nested++;
    }
  }
  const parts: string[] = [];
  if (props.length) parts.push(truncateList(props, 10));
  if (nested) parts.push(`${nested} nested`);
  return parts.join("; ") || "(empty)";
}

export function buildOutline(source: string): string {
  const totalLines = source === "" ? 0 : source.split("\n").length;
  const bytes = new TextEncoder().encode(source).length;
  const blocks = topBlocks(source);
  const lines = [
    `Scene: ${totalLines} lines, ${bytes} bytes, ${blocks.length} top-level rules`,
  ];
  for (const b of blocks) {
    lines.push(`${b.header}  L${b.startLine}–${b.endLine}  ${summarize(b)}`);
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Line helpers
// ----------------------------------------------------------------------------

function numberLines(lines: string[], from1: number): string {
  return lines.map((l, idx) => `${from1 + idx}\t${l}`).join("\n");
}

// ----------------------------------------------------------------------------
// Tool executors — every one returns a string, never throws.
// ----------------------------------------------------------------------------

const READ_LINES_CAP = 400;
const SEARCH_MATCH_CAP = 30;

function toolGetOutline(ctx: ToolContext): string {
  return buildOutline(ctx.getSource());
}

function toolReadRules(
  args: Record<string, unknown>,
  ctx: ToolContext,
): string {
  const selectors = args.selectors;
  if (
    !Array.isArray(selectors) ||
    selectors.some((s) => typeof s !== "string")
  ) {
    return "Error: read_rules needs { selectors: string[] }.";
  }
  const source = ctx.getSource();
  const blocks = topBlocks(source);
  const srcLines = source.split("\n");
  const out: string[] = [];
  for (const raw of selectors as string[]) {
    const want = normalizeWs(raw);
    const block = blocks.find((b) => b.header === want);
    if (!block) {
      const near = blocks
        .map((b) => b.header)
        .filter(
          (h) =>
            h.includes(want) ||
            want.includes(h) ||
            h.split(" ")[0] === want.split(" ")[0],
        );
      const hint = near.length
        ? `did you mean: ${near.join(", ")}`
        : `known rules: ${blocks.map((b) => b.header).join(", ")}`;
      out.push(`Rule "${raw}" not found — ${hint}`);
      continue;
    }
    const body = srcLines.slice(block.startLine - 1, block.endLine);
    out.push(numberLines(body, block.startLine));
  }
  return out.join("\n\n");
}

function toolReadLines(
  args: Record<string, unknown>,
  ctx: ToolContext,
): string {
  const start = args.start;
  const end = args.end;
  if (typeof start !== "number" || typeof end !== "number") {
    return "Error: read_lines needs { start: number, end: number }.";
  }
  const srcLines = ctx.getSource().split("\n");
  const total = srcLines.length;
  const from = Math.max(1, Math.floor(start));
  let to = Math.min(total, Math.floor(end));
  if (to < from)
    return `Error: read_lines end (${end}) is before start (${start}).`;
  if (to - from + 1 > READ_LINES_CAP) to = from + READ_LINES_CAP - 1;
  return numberLines(srcLines.slice(from - 1, to), from);
}

function toolSearch(args: Record<string, unknown>, ctx: ToolContext): string {
  const query = args.query;
  if (typeof query !== "string" || query === "") {
    return "Error: search needs a non-empty { query: string }.";
  }
  const isRegex = args.isRegex === true;
  let test: (line: string) => boolean;
  if (isRegex) {
    try {
      const re = new RegExp(query);
      test = (line) => re.test(line);
    } catch (e) {
      return `Error: invalid regex — ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    test = (line) => line.includes(query);
  }
  const srcLines = ctx.getSource().split("\n");
  const hits: number[] = [];
  for (let i = 0; i < srcLines.length; i++) {
    if (test(srcLines[i])) hits.push(i);
  }
  if (hits.length === 0) return `No matches for ${JSON.stringify(query)}.`;

  const shown = hits.slice(0, SEARCH_MATCH_CAP);
  const omitted = hits.length - shown.length;

  // Merge ±2 context windows that overlap.
  const ranges: Array<[number, number]> = [];
  for (const i of shown) {
    const lo = Math.max(0, i - 2);
    const hi = Math.min(srcLines.length - 1, i + 2);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }
  const groups = ranges.map(([lo, hi]) =>
    numberLines(srcLines.slice(lo, hi + 1), lo + 1),
  );
  let result = groups.join("\n--\n");
  if (omitted > 0) {
    result += `\n\n(${hits.length} matches; showing first ${shown.length}, ${omitted} omitted)`;
  }
  return result;
}

function commitValidated(next: string, ctx: ToolContext, verb: string): string {
  try {
    parse(next);
  } catch (e) {
    return `Edit rejected — resulting scene failed to parse: ${
      e instanceof Error ? e.message : String(e)
    }`;
  }
  ctx.commit(next);
  const lines = next === "" ? 0 : next.split("\n").length;
  return `${verb}. Scene is now ${lines} lines.`;
}

function toolApplyEdit(
  args: Record<string, unknown>,
  ctx: ToolContext,
): string {
  const search = args.search;
  const replace = args.replace;
  if (typeof search !== "string" || typeof replace !== "string") {
    return "Error: apply_edit needs { search: string, replace: string }.";
  }
  const res = applyEdits(ctx.getSource(), [{ search, replace }]);
  if (!res.ok) return res.error;
  return commitValidated(res.result, ctx, "Edit applied");
}

function toolReadExample(
  args: Record<string, unknown>,
  ctx: ToolContext,
): string {
  const examples = ctx.examples ?? [];
  if (examples.length === 0) return "No examples available.";
  const names = examples.map((e) => e.name);
  const name = args.name;
  if (typeof name !== "string" || name === "") {
    return `Available examples: ${names.join(", ")}. Call read_example with a name to read one.`;
  }
  const hit = examples.find((e) => e.name === name);
  if (!hit) {
    return `Example "${name}" not found. Available examples: ${names.join(", ")}.`;
  }
  return hit.source;
}

function toolRewriteScene(
  args: Record<string, unknown>,
  ctx: ToolContext,
): string {
  const css = args.css;
  if (typeof css !== "string") {
    return "Error: rewrite_scene needs { css: string }.";
  }
  return commitValidated(css, ctx, "Scene rewritten");
}

export function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): string {
  try {
    switch (name) {
      case "get_outline":
        return toolGetOutline(ctx);
      case "read_rules":
        return toolReadRules(args, ctx);
      case "read_lines":
        return toolReadLines(args, ctx);
      case "search":
        return toolSearch(args, ctx);
      case "read_example":
        return toolReadExample(args, ctx);
      case "apply_edit":
        return toolApplyEdit(args, ctx);
      case "rewrite_scene":
        return toolRewriteScene(args, ctx);
      default:
        return `Error: unknown tool "${name}".`;
    }
  } catch (e) {
    return `Error running ${name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ----------------------------------------------------------------------------
// OpenAI chat-completions tool definitions.
// ----------------------------------------------------------------------------

export const TOOL_DEFS: Array<{
  type: "function";
  function: { name: string; description: string; parameters: object };
}> = [
  {
    type: "function",
    function: {
      name: "get_outline",
      description:
        "Scene map: every top-level rule with its selector/at-rule header, line range, and a one-line summary. Start here to learn the scene without reading the whole source.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_rules",
      description:
        'Read the verbatim, line-numbered source of named top-level rules. Selectors must match outline headers exactly (e.g. "#ball", "@keyframes spin").',
      parameters: {
        type: "object",
        properties: {
          selectors: {
            type: "array",
            items: { type: "string" },
            description:
              "Top-level rule headers to read, exactly as shown in the outline.",
          },
        },
        required: ["selectors"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_lines",
      description:
        "Read a 1-indexed inclusive line range (line-numbered), clamped to the file and capped at 400 lines.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "number", description: "First line (1-indexed)." },
          end: { type: "number", description: "Last line (inclusive)." },
        },
        required: ["start", "end"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description:
        "Find matching lines (with 2 lines of context each side). Plain substring by default; set isRegex to treat the query as a JS regex.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text or regex to find." },
          isRegex: { type: "boolean", description: "Treat query as a regex." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_example",
      description:
        "Read a curated gallery scene demonstrating idiomatic Popkorn. Call with no name to list the available example names; then read 1–2 relevant ones before writing a scene from scratch, to match house style.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Example name to read, exactly as listed by a no-argument call. Omit to list.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_edit",
      description:
        "Replace one exact, unique run of text in the scene. `search` must match the CURRENT scene verbatim and occur exactly once; the result is parse-validated and only committed if it parses. Read the relevant rule first.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Exact unique text to replace.",
          },
          replace: { type: "string", description: "Replacement text." },
        },
        required: ["search", "replace"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rewrite_scene",
      description:
        "Replace the entire scene with new CSS. Parse-validated; only committed if it parses. Use for from-scratch scenes, not small edits.",
      parameters: {
        type: "object",
        properties: {
          css: {
            type: "string",
            description: "The complete new scene source.",
          },
        },
        required: ["css"],
        additionalProperties: false,
      },
    },
  },
];
