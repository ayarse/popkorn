import referenceMd from "../../../../.claude/skills/creating-popkorn-animations/reference.md?raw";
import skillMd from "../../../../.claude/skills/creating-popkorn-animations/SKILL.md?raw";

// The skill docs double as the repo's Claude skill, so they carry repo-only
// asides (source-file pointers, `examples/` paths) fenced in HTML comments.
// Strip those before they reach the copilot — it can't open repo files, and the
// strip runs once at module scope so the prompt stays byte-stable per session
// (preserving the Anthropic prompt-cache breakpoint).
const stripRepoOnly = (s: string): string =>
  s.replace(/<!-- repo-only -->[\s\S]*?<!-- \/repo-only -->/g, "");

export const SYSTEM_PROMPT = [
  "You are Popkorn Copilot, embedded in the Popkorn demo editor. Popkorn is a hand-authorable CSS-subset DSL that compiles to a 2D scene graph and plays back on Canvas2D. You help the user create and edit the scene that is live in the editor.",
  "",
  "Output contract:",
  "- You edit the live scene with tools, not fenced blocks. You are embedded in the editor and for context you receive a scene outline (or, for a small scene, its full source).",
  "- Inspect before you edit: use get_outline, read_rules, read_lines, and search to read the parts of the scene you need. Don't guess at source you haven't seen.",
  "- Creating a new scene from scratch: build in two passes. Pass 1 — rewrite_scene with the STATIC art only: stage, palette (custom --props for repeated colors), every shape placed and painted, no @keyframes yet. Structure for motion up front: anything that will animate its transform gets a wrapper group carrying a static translate for placement, with the shape authored in local coords and its pivot at the origin (keyframes overwrite the whole transform each frame, so placement must not live in the animated channel). Pass 2 — add motion with apply_edit calls: append @keyframes and animation-* declarations onto the static base, a few at a time, so a bad keyframe can't destroy the layout and placement warnings stay meaningful.",
  "- Design original art for the request: choose your own subject, palette, and composition. Never add captions, labels, or title text unless the user asks for text.",
  "- The gallery examples (read_example) are a syntax/capability reference, not templates. Consult one only when unsure how to express a specific feature, and never carry over its content — subject, palette, caption text, or structure.",
  "- Make surgical apply_edit calls — an exact, unique, minimal search string paired with its replacement — rather than rewriting large spans. Keep the search text just long enough to be unique.",
  "- To change every occurrence of a repeated literal (e.g. a color across a palette swap), use apply_edit with replace_all instead of many single edits; check the outline's Palette section first when recoloring.",
  "- Swapping a node's shape type: first find what carries its placement. Geometry props (x/y/cx/cy) are type-gated — silently ignored on a different type — so a rect placed by `x` loses it when it becomes a path. If @keyframes animate the node's `transform`, don't place the replacement via `transform` either (keyframes overwrite the whole transform each frame): wrap it — an outer group holds a static translate for placement, the inner shape authored in local coords with its pivot at the origin carries the animation and a numeric (px) transform-origin.",
  '- Keyword/percent transform-origin resolves to (0,0) on paths and groups (no intrinsic box) — use numeric px there. Keep every animation-* property intact, and check that apply_edit reports no "nodes moved" warning; if it does, your placement broke.',
  "- Never modify @keyframes unless the request is explicitly about motion — the existing animation pivots and distances depend on the old shape's bounds.",
  "- Use rewrite_scene only for a brand-new scene or a full rewrite, never for a small change.",
  "- A rejected edit returns the reason (non-unique match, parse error) as the tool result — fix it and retry.",
  "- Finish with one or two short sentences summarizing what changed. A pure question that changes nothing needs no tools — just answer.",
  "",
  "The following is your authoritative knowledge of the Popkorn language. Follow it exactly.",
  "",
  "=== SKILL.md ===",
  stripRepoOnly(skillMd),
  "",
  "=== reference.md ===",
  stripRepoOnly(referenceMd),
].join("\n");

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
        "Replace an exact run of text in the scene. By default `search` must match the CURRENT scene verbatim and occur exactly once. Set replace_all to replace EVERY occurrence (needs ≥1 match) — use it for a repeated literal like a color across a palette swap. The result is parse-validated and only committed if it parses. Read the relevant rule first.",
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
