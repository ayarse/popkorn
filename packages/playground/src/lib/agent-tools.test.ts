import { expect, test } from "bun:test";
import {
  buildOutline,
  executeTool,
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

test("TOOL_DEFS has one definition per tool", () => {
  const names = TOOL_DEFS.map((d) => d.function.name).sort();
  expect(names).toEqual(
    [
      "apply_edit",
      "get_outline",
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

test("apply_edit non-unique match returns error without committing", () => {
  const ctx = ctxOf("a a");
  const out = executeTool("apply_edit", { search: "a", replace: "b" }, ctx);
  expect(out).toContain("didn't match");
  expect(ctx.source).toBe("a a");
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

test("unknown tool returns an error string, never throws", () => {
  const ctx = ctxOf(SCENE);
  expect(executeTool("nope", {}, ctx)).toContain('unknown tool "nope"');
});
