import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { PROPERTY_REGISTRY } from "./animation/registry";
import { GRADIENT_FN } from "./scene/value-parsers";

// Two reference docs, two audiences: docs/reference.md is the public docs site,
// .claude/skills/.../reference.md is served to the Copilot (core guide inline, sections on demand) by
// packages/playground/src/lib/agent-defs.ts. They are deliberately NOT the same
// document, so they can't be deduped — but they must agree on the FACTS. Drift
// here is silent and costly: a capability missing from the skill copy is a
// capability the authoring agent will never use, and it will reach for a worse
// spelling instead (this is how conic-gradient stayed unused for months).
//
// Paths resolve from this file, not cwd: `bun run test` runs each workspace
// package from its own directory.
const REPO_ROOT = resolve(import.meta.dir, "../../..");
const REFERENCES = [
  "docs/reference.md",
  ".claude/skills/creating-popkorn-animations/reference.md",
] as const;

// Internal transform-decomposition channels, not author-facing declarations —
// you write `transform: translate(...)`, never `translateX: ...`. Excluded by
// name so the exclusion stays visible in review.
const DECOMPOSITION_CHANNELS = new Set([
  "translateX",
  "translateY",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
]);

const authorFacing = Object.keys(PROPERTY_REGISTRY).filter(
  (key) => !DECOMPOSITION_CHANNELS.has(key),
);

describe("reference docs track the code", () => {
  test("every registry key is a real property name, not a decomposition channel", () => {
    // Guards the allowlist itself: a new camelCase key must be triaged, not
    // silently skipped by the /[A-Z]/ shape it happens to share.
    const unlisted = Object.keys(PROPERTY_REGISTRY).filter(
      (key) => /[A-Z]/.test(key) && !DECOMPOSITION_CHANNELS.has(key),
    );
    expect(unlisted).toEqual([]);
  });

  for (const path of REFERENCES) {
    describe(path, () => {
      const text = Bun.file(resolve(REPO_ROOT, path)).text();

      test("documents every animatable property", async () => {
        const doc = await text;
        const missing = authorFacing.filter((name) => !doc.includes(name));
        expect(missing).toEqual([]);
      });

      test("documents every gradient function", async () => {
        const doc = await text;
        const missing = [...GRADIENT_FN].filter((fn) => !doc.includes(fn));
        expect(missing).toEqual([]);
      });
    });
  }
});
