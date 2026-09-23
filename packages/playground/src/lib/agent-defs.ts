import referenceMd from "../../../../.claude/skills/creating-popkorn-animations/reference.md?raw";
import skillMd from "../../../../.claude/skills/creating-popkorn-animations/SKILL.md?raw";

// The skill docs double as the repo's Claude skill, so they carry repo-only
// asides (source-file pointers, `examples/` paths) fenced in HTML comments.
// Strip those before they reach the copilot — it can't open repo files, and the
// strip runs once at module scope so the prompt stays byte-stable per session
// (preserving the Anthropic prompt-cache breakpoint).
const stripRepoOnly = (s: string): string =>
  s.replace(/<!-- repo-only -->[\s\S]*?<!-- \/repo-only -->/g, "");

// reference.md split on its `## N. Title` headings. Only the gotchas section
// rides in the prompt; the rest is fetched per section via read_docs.
type DocSection = { num: string; title: string; body: string };

const REFERENCE_SECTIONS: DocSection[] = stripRepoOnly(referenceMd)
  .split(/^(?=## )/m)
  .flatMap((chunk) => {
    const m = /^## (\d+)\. (.+)$/m.exec(chunk);
    return m && chunk.startsWith("## ")
      ? [{ num: m[1], title: m[2].trim(), body: chunk.trim() }]
      : [];
  });

const GOTCHAS = REFERENCE_SECTIONS.find((s) => /gotchas/i.test(s.title));

// One line per section with its `###` subheads, so the model can pick the
// section a feature lives in without reading it.
const DOCS_INDEX = REFERENCE_SECTIONS.map((s) => {
  const subs = [...s.body.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
  return `§${s.num} ${s.title}${subs.length ? ` — ${subs.join(" · ")}` : ""}`;
}).join("\n");

// The core authoring guide: quick reference, the CSS-divergence gotchas, and
// the reference index. Inlined in SYSTEM_PROMPT; also what a no-argument
// read_docs returns, for MCP clients that ignore the server `instructions`.
export const SKILL_DOCS = [
  stripRepoOnly(skillMd)
    .replace(/^---[\s\S]*?---\n/, "")
    .trim(),
  "",
  GOTCHAS?.body ?? "",
  "",
  "## Full reference index (read_docs with section numbers)",
  DOCS_INDEX,
].join("\n");

/** read_docs executor: the named reference sections verbatim, or the core
 * guide when none are given. Accepts "12", "§12", or a title fragment. */
export function readDocs(args: Record<string, unknown>): string {
  const wanted = Array.isArray(args.sections)
    ? args.sections.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (wanted.length === 0) return SKILL_DOCS;
  const out: string[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    const key = w.replace(/^§\s*/, "").toLowerCase();
    const hit =
      REFERENCE_SECTIONS.find((s) => s.num === key.split(/[.\s]/)[0]) ??
      REFERENCE_SECTIONS.find((s) => s.title.toLowerCase().includes(key));
    if (!hit) missing.push(w);
    else if (!out.includes(hit.body)) out.push(hit.body);
  }
  if (out.length === 0) {
    return `Error: no reference section matches ${missing.join(", ")}. Sections:\n${DOCS_INDEX}`;
  }
  if (missing.length) out.push(`(No section matches ${missing.join(", ")}.)`);
  return out.join("\n\n");
}

export const SYSTEM_PROMPT = [
  "You are Popkorn Copilot, embedded in the Popkorn demo editor. Popkorn is a hand-authorable CSS-subset DSL that compiles to a 2D scene graph and plays back on Canvas2D. You help the user create and edit the scene that is live in the editor.",
  "",
  "Knowledge:",
  "- Where Popkorn matches CSS, trust your CSS knowledge: @keyframes, the animation shorthand and longhands, easing functions, transform functions, colors, gradients, calc(), var(), :hover/:active, transition, filter, clip-path, offset-path, z-index, box-shadow, border-radius, mix-blend-mode all behave as in CSS.",
  "- Where it diverges, the guide below wins: no box model or layout (literal coordinates only), `type:` picks the shape, SVG-style geometry and paint props, fill/stroke default to none, fill-mode defaults to forwards. Unknown or misplaced properties parse fine and silently do nothing.",
  "- The guide below covers everyday authoring. Before using a feature it only mentions in passing (symbols, repeat, masks, motion paths, text, images, state machines, scrubbing, time scoping), call read_docs with its section numbers — several at once, once per run.",
  "",
  "Working:",
  "- You edit the live scene with tools, never fenced code blocks. Each request comes with the scene's full source (small scenes) or an outline; read only what you need with read_rules (many selectors per call), search, or read_lines. Don't re-read source you already have.",
  "- Be fast: issue independent tool calls in parallel in one turn, and don't re-read after a successful edit. Edit results already report parse errors, new diagnostics (unknown properties with did-you-mean, missing @keyframes), and nodes whose placement moved; fix any they report.",
  "- New scene from scratch: one rewrite_scene with the complete scene, art and motion. Stage first, palette as custom --props, every shape placed and painted. Structure for motion: anything whose transform animates gets a wrapper group carrying a static translate for placement, with the shape in local coords and its pivot at the origin (keyframes overwrite the whole transform each frame, so placement must not live in the animated channel).",
  "- Design original art for the request: choose your own subject, palette, and composition. Never add captions, labels, or title text unless the user asks for text.",
  "- Keep the stage transparent: no `background` on :root and no full-stage backdrop shape, unless the user asks for a background or the subject is inherently a scene (a sky, a room). The gallery examples all have backgrounds; don't copy that. Popkorn animations are embedded on other pages, where a transparent stage composites cleanly.",
  "- read_example is a syntax reference, not a template: consult one only when read_docs doesn't settle how to express a feature, and never carry over its subject, palette, caption text, or structure.",
  "- Changes to an existing scene: surgical apply_edit calls, each an exact, unique search string just long enough to be unique. Use replace_all for a repeated literal (a color across a palette swap; the outline's Palette line lists them). rewrite_scene is only for a brand-new scene or a full rewrite.",
  "- Swapping a node's shape type: first find what carries its placement. Geometry props (x/y/cx/cy) are type-gated, so a rect placed by `x` loses it when it becomes a path. If @keyframes animate the node's transform, wrap the replacement: an outer group with a static translate, the inner shape in local coords with its pivot at the origin and a numeric (px) transform-origin.",
  "- Keyword/percent transform-origin resolves to (0,0) on paths and groups (no intrinsic box); use numeric px there. Keep every animation-* property intact.",
  "- Never modify @keyframes unless the request is about motion; the existing pivots and distances depend on the old shape's bounds.",
  "- A rejected edit returns the reason (non-unique match with line numbers, or the closest region to copy verbatim); fix it and retry.",
  "- Finish with a brief note on what changed, sized for a chat bubble the user skims next to the canvas. A pure question needs no tools, just answer.",
  "",
  "=== Popkorn authoring guide ===",
  "",
  SKILL_DOCS,
].join("\n");

// ----------------------------------------------------------------------------
// OpenAI chat-completions tool definitions.
// ----------------------------------------------------------------------------

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};

// NOTE: tool results are plain strings, so failure is sniffed from known
// error/rejection prefixes rather than a structured status.
const ERROR_PREFIXES = [
  "Error", // Error: …, Error running …
  "Invalid", // malformed tool arguments (from runAgent)
  "Edit rejected", // parse-failed edit/rewrite
  "Edit block", // applyEdits non-unique / no match
  "Search text", // apply_edit near-miss / non-unique diagnostic
  "No match", // search: No matches for …
  'Rule "', // read_rules: Rule "…" not found
];

// Leads a tool result when the user edited the scene since the run last read it.
export const USER_EDIT_NOTE =
  "Note: the user edited the scene since your last read; re-read the affected rules before further edits.";

export function isToolError(result: string): boolean {
  const body = result.startsWith(USER_EDIT_NOTE)
    ? result.slice(USER_EDIT_NOTE.length + 1)
    : result;
  return ERROR_PREFIXES.some((p) => body.startsWith(p));
}

export const TOOL_DEFS: ToolDef[] = [
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
      name: "read_docs",
      description:
        'Read sections of the full Popkorn reference, verbatim. Pass every section you need in one call, by number from the index ("12") or title ("@keyframes"). With no sections, returns the core authoring guide.',
      parameters: {
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: { type: "string" },
            description: 'Section numbers or titles, e.g. ["8", "12"].',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_example",
      description:
        "Read a curated gallery scene demonstrating idiomatic Popkorn. Call with no name to list every example with a one-line summary of the features it demonstrates — pick by that summary, since one scene often covers several features. Use as a syntax/capability reference when unsure how to express a feature — not as a template: never copy an example's subject, palette, or caption text into a new scene.",
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
        "Replace an exact run of text in the scene. By default `search` must match the CURRENT scene verbatim and occur exactly once. Set replace_all to replace EVERY occurrence (needs ≥1 match) — use it for a repeated literal like a color across a palette swap. The result is parse-validated and only committed if it parses; it reports new diagnostics and moved nodes. Copy `search` from source you have seen.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Exact text to replace.",
          },
          replace: { type: "string", description: "Replacement text." },
          replace_all: {
            type: "boolean",
            description:
              "Replace every occurrence of `search` instead of requiring a single unique match.",
          },
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
        "Replace the entire scene with new CSS. Parse-validated; only committed if it parses; reports diagnostics. Use for from-scratch scenes, not small edits.",
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
