import { expect, test } from "bun:test";
import {
  buildOutline,
  executeTool,
  placementWarning,
  TOOL_DEFS,
  type ToolContext,
} from "@/lib/agent-tools";

// A mutable ToolContext backed by a plain string, for exercising executeTool.
function ctxOf(source: string): ToolContext & { source: string } {
  const box = {
    source,
    getSource() {
      return box.source;
    },
    commit(next: string) {
      box.source = next;
    },
  };
  return box;
}

const FIXTURE = `/* header comment { with a brace } that must not nest */
:root {
  width: 400px;
  height: 300px;
  --accent: #f0a;
}

@keyframes spin {
  0% { transform: rotate(0deg); animation-timing-function: ease-out; }
  100% { transform: rotate(360deg); opacity: 1; }
}

#stage {
  type: group;
  transform: translate(10px, 10px);
  > #label {
    type: text;
    content: "a brace { inside a string";
    x: 20px;
  }
}`;

test("buildOutline: comments and quoted braces don't break nesting", () => {
  const outline = buildOutline(FIXTURE);
  // Exactly three top-level rules; the '{' inside the comment and the string
  // must not have opened phantom blocks.
  expect(outline).toContain("3 top-level rules");
  expect(outline).toContain(":root");
  expect(outline).toContain("@keyframes spin");
  expect(outline).toContain("#stage");
  // :root lists its custom property.
  expect(outline).toMatch(/:root.*--accent/);
  // @keyframes summary names animated props but not the easing meta property.
  expect(outline).toMatch(/@keyframes spin.*transform/);
  expect(outline).not.toContain("animation-timing-function");
  // #stage has a nested child.
  expect(outline).toMatch(/#stage.*1 nested/);
});

test("buildOutline: line ranges are correct on the fixture", () => {
  const outline = buildOutline(FIXTURE);
  // :root spans lines 2–6 (1-indexed, comment on line 1 is skipped).
  expect(outline).toMatch(/:root {2}L2–6/);
});

test("buildOutline on a real example scene", async () => {
  const src = await Bun.file(
    new URL(
      "../../../../examples/popkorn/13-state-machine--lamp.css",
      import.meta.url,
    ),
  ).text();
  const outline = buildOutline(src);
  expect(outline).toContain(":root");
  expect(outline).toContain("@machine lamp");
  expect(outline).toContain("@keyframes glowIn");
  expect(outline).toContain("#lamp");
  // #lamp is a big group with many nested children.
  expect(outline).toMatch(/#lamp.*nested/);
  // Reported line count matches the file.
  const total = src.split("\n").length;
  expect(outline).toContain(`${total} lines`);
});

test("buildOutline palette: hex case-normalizes and counts, most-frequent first", () => {
  const src = `#a { fill: #E94560; stroke: #e94560; }
#b { fill: #E94560; background: #4ECDC4; }`;
  const outline = buildOutline(src);
  // #e94560 seen 3× (case-folded), #4ecdc4 once, most-frequent first.
  expect(outline).toMatch(/Palette: #e94560 ×3, #4ecdc4 ×1/);
});

test("buildOutline palette: rgb() whitespace/comma spacing is normalized", () => {
  const src = `#a { fill: rgb(255, 230, 109); }
#b { fill: rgb(255,230,109); }
#c { fill: rgb(255,  230 , 109); }`;
  const outline = buildOutline(src);
  expect(outline).toContain("rgb(255, 230, 109) ×3");
});

test("buildOutline palette: named color counts in fill but keywords don't", () => {
  const src = `#a { fill: gold; stroke: none; type: circle; }
#b { fill: gold; background: none; }`;
  const outline = buildOutline(src);
  expect(outline).toContain("gold ×2");
  expect(outline).not.toContain("none");
  expect(outline).not.toContain("circle");
});

test("buildOutline palette: named colors inside gradient args count", () => {
  const src = `#a { fill: linear-gradient(gold, crimson); }
#b { filter: drop-shadow(2px 2px teal); }`;
  const outline = buildOutline(src);
  expect(outline).toContain("gold ×1");
  expect(outline).toContain("crimson ×1");
  expect(outline).toContain("teal ×1");
});

test("buildOutline palette: color custom props show as var entries with use counts", () => {
  const src = `:root { --brand: #e94560; --accent: gold; }
#a { fill: var(--brand); stroke: var(--brand); }
#b { fill: var(--brand); background: var(--accent); }`;
  const outline = buildOutline(src);
  expect(outline).toContain("--brand: #e94560 (var, ×3 uses)");
  expect(outline).toContain("--accent: gold (var, ×1 uses)");
  // The var def's literal hex is not double-counted as a plain palette entry.
  expect(outline).not.toContain("#e94560 ×");
});

test("buildOutline palette: colors in comments and strings are ignored", () => {
  const src = `/* fill: #deadbe here */
#a { content: "#c0ffee gold"; fill: #123456; }`;
  const outline = buildOutline(src);
  expect(outline).toContain("#123456 ×1");
  expect(outline).not.toContain("#deadbe");
  expect(outline).not.toContain("#c0ffee");
  expect(outline).not.toContain("gold");
});

test("buildOutline palette: caps at 24 entries with an omitted note", () => {
  const decls = Array.from(
    { length: 30 },
    (_, i) => `#n${i} { fill: #${i.toString(16).padStart(6, "0")}; }`,
  ).join("\n");
  const outline = buildOutline(decls);
  const palette = outline.split("\n").find((l) => l.startsWith("Palette:"))!;
  expect(palette).toContain("(+6 more)");
  // 24 shown entries → 24 " ×" occurrences on the line.
  expect(palette.match(/ ×/g)!.length).toBe(24);
});

test("buildOutline: no palette line when the scene has no colors", () => {
  const outline = buildOutline("#a { type: circle; r: 20px; }");
  expect(outline).not.toContain("Palette:");
});

test("TOOL_DEFS has one definition per tool", () => {
  const names = TOOL_DEFS.map((d) => d.function.name).sort();
  expect(names).toEqual(
    [
      "apply_edit",
      "get_outline",
      "read_example",
      "read_lines",
      "read_rules",
      "rewrite_scene",
      "search",
    ].sort(),
  );
});

const SCENE = `#ball {
  radius: 20px;
  fill: #f00;
}`;

test("apply_edit success commits and reports line count", () => {
  const ctx = ctxOf(SCENE);
  const out = executeTool(
    "apply_edit",
    { search: "#f00", replace: "#0f0" },
    ctx,
  );
  expect(out).toContain("Edit applied");
  expect(out).toContain("4 lines");
  expect(ctx.source).toContain("#0f0");
});

test("apply_edit non-unique match reports count and lines without committing", () => {
  const ctx = ctxOf("a a");
  const out = executeTool("apply_edit", { search: "a", replace: "b" }, ctx);
  expect(out).toContain("matched 2 times");
  expect(out).toContain("lines 1, 1");
  expect(out).toContain("replace_all");
  expect(ctx.source).toBe("a a");
});

test("apply_edit near-miss: whitespace-drift search returns the anchored region", () => {
  const ctx = ctxOf(SCENE);
  // Same content, wrong indentation → no exact match, but the trimmed first
  // line anchors the closest region, shown verbatim and line-numbered.
  const out = executeTool(
    "apply_edit",
    { search: "    radius: 20px;", replace: "  radius: 40px;" },
    ctx,
  );
  expect(out).toContain("Closest region");
  expect(out).toContain("copy EXACTLY");
  expect(out).toContain("2\t  radius: 20px;");
  expect(ctx.source).toBe(SCENE);
});

test("apply_edit near-miss: whitespace-insensitive probe locates the region", () => {
  const ctx = ctxOf(SCENE);
  // First line "radius:" trims to nothing that exists as a whole line, so the
  // trimmed-anchor step misses; the collapsed-whitespace probe still finds it.
  const out = executeTool(
    "apply_edit",
    { search: "radius:\n  20px;", replace: "radius: 40px;" },
    ctx,
  );
  expect(out).toContain("Closest region");
  expect(out).toContain("2\t  radius: 20px;");
});

test("apply_edit near-miss: unknown search falls back gracefully", () => {
  const ctx = ctxOf(SCENE);
  const out = executeTool(
    "apply_edit",
    { search: "totally: absent;", replace: "x: 1;" },
    ctx,
  );
  expect(out).toContain("no similar region was found");
  expect(out).toContain("read_rules");
  expect(ctx.source).toBe(SCENE);
});

test("apply_edit near-miss: non-unique reports every match line", () => {
  const ctx = ctxOf("#a { fill: #f00; }\n#b { fill: #f00; }");
  const out = executeTool(
    "apply_edit",
    { search: "#f00", replace: "#0f0" },
    ctx,
  );
  expect(out).toContain("matched 2 times");
  expect(out).toContain("lines 1, 2");
});

test("apply_edit that breaks parsing is rejected without committing", () => {
  const ctx = ctxOf(SCENE);
  // Delete the closing brace → parser throws.
  const out = executeTool(
    "apply_edit",
    { search: "  fill: #f00;\n}", replace: "  fill: #f00;" },
    ctx,
  );
  expect(out).toContain("Edit rejected — resulting scene failed to parse");
  expect(ctx.source).toBe(SCENE);
});

test("apply_edit replace_all swaps every occurrence and reports the count", () => {
  const ctx = ctxOf(`#a { fill: #f00; }
#b { fill: #f00; }
#c { stroke: #f00; }`);
  const out = executeTool(
    "apply_edit",
    { search: "#f00", replace: "#0f0", replace_all: true },
    ctx,
  );
  expect(out).toContain("Edit applied (3 occurrences)");
  expect(out).toContain("3 lines");
  expect(ctx.source).not.toContain("#f00");
  expect(ctx.source.match(/#0f0/g)!.length).toBe(3);
});

test("apply_edit replace_all with a single occurrence works", () => {
  const ctx = ctxOf(SCENE);
  const out = executeTool(
    "apply_edit",
    { search: "#f00", replace: "#0f0", replace_all: true },
    ctx,
  );
  expect(out).toContain("Edit applied (1 occurrence)");
  expect(out).not.toContain("occurrences");
  expect(ctx.source).toContain("#0f0");
});

test("apply_edit replace_all with zero matches errors without committing", () => {
  const ctx = ctxOf(SCENE);
  const out = executeTool(
    "apply_edit",
    { search: "#0ff", replace: "#0f0", replace_all: true },
    ctx,
  );
  expect(out).toContain("didn't match");
  expect(ctx.source).toBe(SCENE);
});

test("apply_edit replace_all still reverts when the result won't parse", () => {
  const ctx = ctxOf(SCENE);
  // Replacing every "}" deletes the closing brace → parser throws.
  const out = executeTool(
    "apply_edit",
    { search: "}", replace: "", replace_all: true },
    ctx,
  );
  expect(out).toContain("Edit rejected — resulting scene failed to parse");
  expect(ctx.source).toBe(SCENE);
});

test("rewrite_scene commits valid css and rejects invalid", () => {
  const ctx = ctxOf(SCENE);
  const ok = executeTool(
    "rewrite_scene",
    { css: "#x {\n  radius: 5px;\n}" },
    ctx,
  );
  expect(ok).toContain("Scene rewritten");
  expect(ctx.source).toContain("#x");

  const bad = executeTool("rewrite_scene", { css: "#x { radius: " }, ctx);
  expect(bad).toContain("Edit rejected — resulting scene failed to parse");
  expect(ctx.source).toContain("#x {\n  radius: 5px;");
});

test("read_lines clamps to file bounds", () => {
  const ctx = ctxOf(SCENE);
  const out = executeTool("read_lines", { start: -5, end: 999 }, ctx);
  expect(out).toBe("1\t#ball {\n2\t  radius: 20px;\n3\t  fill: #f00;\n4\t}");
});

test("read_rules reports near-misses on a miss", () => {
  const ctx = ctxOf(SCENE);
  const out = executeTool("read_rules", { selectors: ["#bal"] }, ctx);
  expect(out).toContain("not found");
  expect(out).toContain("#ball");
});

test("read_rules returns the numbered rule body on a hit", () => {
  const ctx = ctxOf(SCENE);
  const out = executeTool("read_rules", { selectors: ["#ball"] }, ctx);
  expect(out).toContain("1\t#ball {");
  expect(out).toContain("3\t  fill: #f00;");
});

// Dominoes-style doc comments live BETWEEN rules; read_rules must fold the
// contiguous comment/blank run directly above the header into the rule body so
// the trap-documenting prose reaches the model.
const DOC_SCENE = `:root {
  width: 800px;
  height: 600px;
}

/* A standing tile, pivoting about its base so it topples like a domino.
   Placed by the type-gated x; a path swap would drop it. */
#d1 {
  type: rect;
  x: 200px;
  fill: #4ecdc4;
}`;

test("read_rules folds the leading doc comment (and blank) into the rule", () => {
  const ctx = ctxOf(DOC_SCENE);
  const out = executeTool("read_rules", { selectors: ["#d1"] }, ctx);
  // Starts at the blank line above the comment (line 5), not the header.
  expect(out).toContain("6\t/* A standing tile");
  expect(out).toContain("7\t   Placed by the type-gated x");
  expect(out).toContain("8\t#d1 {");
  // The previous rule's closing brace stays with :root, not #d1.
  expect(out).not.toContain(":root {");
});

test("read_rules leaves a rule with no leading comment unchanged", () => {
  const ctx = ctxOf(DOC_SCENE);
  const out = executeTool("read_rules", { selectors: [":root"] }, ctx);
  expect(out).toContain("1\t:root {");
});

// --- apply_edit render-truth feedback -------------------------------------

// A rect placed by the type-gated `x`; swapping to a path silently drops `x`,
// so the node collapses to the path's local origin — a real move.
const PLACED_RECT = `#d1 {
  type: rect;
  x: 200px;
  y: 344px;
  width: 20px;
  height: 96px;
  fill: #4ecdc4;
}`;

test("apply_edit warns when a rect->path swap drops the type-gated x", () => {
  const ctx = ctxOf(PLACED_RECT);
  const out = executeTool(
    "apply_edit",
    {
      search:
        "type: rect;\n  x: 200px;\n  y: 344px;\n  width: 20px;\n  height: 96px;",
      replace: 'type: path;\n  d: "M 0 0 L 20 0 L 20 96 L 0 96 Z";',
    },
    ctx,
  );
  expect(out).toContain("Edit applied");
  expect(out).toContain("nodes moved");
  expect(out).toContain("#d1");
});

test("apply_edit appends no warning for a pure recolor", () => {
  const ctx = ctxOf(PLACED_RECT);
  const out = executeTool(
    "apply_edit",
    { search: "fill: #4ecdc4;", replace: "fill: #ff8f5e;" },
    ctx,
  );
  expect(out).toContain("Edit applied");
  expect(out).not.toContain("nodes moved");
});

test("placementWarning is empty when nothing moves and flags a moved node", () => {
  expect(
    placementWarning(
      "#a { type: circle; cx: 10px; cy: 10px; r: 5px; }",
      "#a { type: circle; cx: 10px; cy: 10px; r: 6px; }",
    ),
  ).toBe("");
  const moved = placementWarning(
    "#a { type: circle; cx: 10px; cy: 10px; r: 5px; }",
    "#a { type: circle; cx: 90px; cy: 10px; r: 5px; }",
  );
  expect(moved).toContain("nodes moved");
  expect(moved).toContain("#a (10,10)->(90,10)");
});

test("search caps at 30 matches and reports the omitted count", () => {
  const many = Array.from({ length: 50 }, (_, i) => `line ${i} target`).join(
    "\n",
  );
  const ctx = ctxOf(many);
  const out = executeTool("search", { query: "target" }, ctx);
  expect(out).toContain("50 matches");
  expect(out).toContain("20 omitted");
});

test("search with an invalid regex returns an error string", () => {
  const ctx = ctxOf(SCENE);
  const out = executeTool("search", { query: "(", isRegex: true }, ctx);
  expect(out).toContain("invalid regex");
});

const EXAMPLES = [
  { name: "Bouncing ball", source: "#ball { type: circle; r: 20px; }" },
  { name: "Spinner", source: "#s { type: group; }" },
];

test("read_example with no name lists the available example names", () => {
  const ctx = { ...ctxOf(SCENE), examples: EXAMPLES };
  const out = executeTool("read_example", {}, ctx);
  expect(out).toContain("Bouncing ball");
  expect(out).toContain("Spinner");
});

test("read_example returns the full source on a name hit", () => {
  const ctx = { ...ctxOf(SCENE), examples: EXAMPLES };
  const out = executeTool("read_example", { name: "Spinner" }, ctx);
  expect(out).toBe("#s { type: group; }");
});

test("read_example on an unknown name lists what's available", () => {
  const ctx = { ...ctxOf(SCENE), examples: EXAMPLES };
  const out = executeTool("read_example", { name: "Nope" }, ctx);
  expect(out).toContain("not found");
  expect(out).toContain("Bouncing ball");
});

test("read_example reports when no examples are wired in", () => {
  const ctx = ctxOf(SCENE); // no examples field
  const out = executeTool("read_example", { name: "Spinner" }, ctx);
  expect(out).toBe("No examples available.");
});

test("unknown tool returns an error string, never throws", () => {
  const ctx = ctxOf(SCENE);
  expect(executeTool("nope", {}, ctx)).toContain('unknown tool "nope"');
});
