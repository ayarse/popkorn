# Claude Code Notes

## Vision

Popcorn is **"Lottie you can write by hand"**: a CSS-subset DSL + Canvas2D
player targeting parity with Lottie players in *rendering and animation
capability* — not After Effects tooling. The differentiator is that the format
is hand-authorable, diffable, and LLM-friendly, where Lottie JSON is
machine-generated and opaque. Every feature decision flows from that:

- **CSS idiom first.** When adding a capability, use the existing CSS
  property/semantics if one exists: motion paths are `offset-path`/
  `offset-distance`/`offset-rotate`, holds are `step-end`, staggering is
  negative `animation-delay`, layering is `z-index`. Never invent syntax CSS
  already has.
- **Zero runtime dependencies.** Hand-rolled parser, no build step, Canvas2D.
  A tree-sitter version existed and was deleted as overkill; don't reintroduce
  heavyweight machinery.
- **Declarative reactivity over scripting.** `var()`/`input(cursor.x)`
  bindings instead of JS expressions. If a use case demands more, extend the
  binding vocabulary (e.g. a `wiggle()` primitive), don't add a script engine.

## Architecture (and its load-bearing invariants)

Pipeline: `@popcorn/parser` `parse(source)` → typed-CSS AST (flat, knows no
shape semantics) → `@popcorn/player` `buildSceneGraph` → scene tree →
`RenderLoop` → `Renderer` interface → `Canvas2DRenderer`. The demo is a Vite
React shell around the `<popcorn-player>` web component.

Invariants that keep the system correct — violating any of these is how bugs
have actually happened here:

1. **`scene/transform.ts` is the single source of truth for transform math.**
   Render walk and hit-testing both consume `computeLocalMatrix`/
   `computeWorldMatrix` (motion-path placement and transform-origin included).
   Never reimplement transform composition elsewhere; there were once three
   divergent copies and the hit-boxes were wrong.
2. **Per-frame value resolution order is fixed:** reset to `node.base`
   snapshot → `var()`/`input()` bindings → animation sampling (global
   timeline) → `:hover`/`:active` overrides last. Nothing may write animated
   state outside this walk; base snapshots are immutable and deep-copied
   (gradients, shape data).
3. **`animation/registry.ts` is the only path to animatability.** A property
   animates iff it has a registry entry (number/color/gradient/path kinds).
   Geometry entries must set the relevant dirty flags (outline length, text
   bounds) — the caches (`cachedOutlineLength`, `cachedTextBounds`,
   polystar commands) trust them.
4. **Timeline is a pure function of time.** One global clock, `seek(t)` twice
   gives identical frames; per-subtree `time-offset`/`time-scale` transform
   inherited time during the walk. Never store per-animation wall-clock state.
5. **Paint order = document order among siblings, modified only by
   `z-index`** (stable sibling sort); hit-testing uses the same order
   reversed. Visibility windows (`visible-from`/`visible-until`) gate both.
6. **The renderer clears the full device-space backing buffer before the
   viewport (fit/DPR) transform is applied**; pointer input maps CSS px →
   device px → scene coords through the inverse viewport in `InputTracker`.
7. **The three renderer backends (Canvas2D, SVG, Skia) must never hand-copy
   paint semantics from each other** — Skia drifted this way once. Rendering
   *decisions* live in the shared walk (`runtime/loop.ts renderNode`) or the
   shared helpers (`renderer/gradient-geometry.ts`, `paint-state.ts`,
   `stroke.ts`); backends keep only platform realization. Keep the `Renderer`
   interface primitive-level — don't raise it to `renderNode(node)` (SVG's
   retained diffing and Skia's per-frame RN canvas need the primitive seam).
   Any per-backend rendering fix or new backend capability gets a case in the
   cross-backend conformance suite (`renderer/conformance.ts`, one spec table
   run against all three); deliberate divergences (Skia luma·alpha limit,
   text/image no-ops, SVG text-measure approximation) are pinned there as
   expected-divergence tests — extend that table, don't silently change them.

## Lottie converter

`packages/popcorn-converters/src/lottie2popcorn.ts` (browser-safe core, used by the demo's Import
button) + `packages/popcorn-converters/src/cli.ts` (CLI: `--validate`, `--batch`).
Structure: a **normalization layer** canonicalizes real-world/minified
bodymovin quirks (inferred `a` flags, legacy `e` keyframes, split position,
0-255 color arrays, missing names/inds) before mapping. Hard-won mapping
facts: Lottie stores both easing tangents on the *departing* keyframe; anchor
points bake into position (`translate = p − a`, origin = `a`); parenting is
transform-only (paint order preserved via nesting + `z-index`); sibling
contours sharing a group fill are ONE nonzero compound path (holes), not
separate fills; layer `ip`/`op` → `visible-from`/`until`.

**Regression gate:** the LottieFiles conformance corpus (clone of
`LottieFiles/test-files`, 80 files). Run `--batch <corpus>/data` before and
after converter/player changes — the clean/warn/blocked counts are the
scoreboard (baseline: 65/8/7/0; only rare shape modifiers pb/op/zz/rd remain
blocked, deliberately — shipping players skip them too). Real-file smoke
checks live in the sticker/demo files under `examples/lottie/`.

## SVG converter

`packages/popcorn-converters/src/svg2popcorn.ts` (browser-safe core; `packages/popcorn-converters/src/svg-xml.ts` is its dependency-
free XML reader) + `packages/popcorn-converters/src/cli.ts` (CLI: `--validate`, `--batch`,
raw-string input, matches `.svg`). Shares the same `Converter`/`convertSvg`/
`validate` contract shape as the Lottie converter, so the demo's **Import**
button branches on file type into either. **Animation imports too:** CSS
`@keyframes` from `<style>` blocks and basic SMIL `<animate>`/`<animateTransform>`
map into Popcorn `@keyframes` + `animation-*` (opacity/fill/stroke/transform/dash);
unmappable channels degrade to a warning (`@media`-wrapped keyframes, gradient
keyframes, `<set>`, `<animateMotion>`, event/sync-base begins, additive/accumulate,
skew). Static skips mirror Lottie's plus SVG-only ones: `<pattern>`,
`<marker>`, `<foreignObject>`, `<textPath>`. Batch gate: run `--batch
examples/svg` over the fixtures in `examples/svg/` before/after converter changes.

## Deliberate skips (don't "helpfully" add these)

JS expressions, text animators, merge-path subtract/intersect (union is
supported), offset/zig-zag/pucker/round-corner modifiers, 3D/camera, effects
beyond what Canvas2D gives nearly free. These match what shipping Lottie
players actually support; revisit only with real files that need them.

Precomp time remap (layer `tm`) IS supported: the `time-remap` property maps a
subtree's inherited time through a keyframe curve (AE tm semantics), and the
converter emits it for precomp layers.

## Workflow

- **bun**, not npm/pnpm: `bun install`, `bun run test`, `bun run build`,
  `bun run dev`, `bun --filter <pkg> <cmd>`. A stray `pnpm-lock.yaml` is
  always an accident.
- Tests are bun-native and DOM-free by design (headless fallbacks are marked
  `NOTE:`); a few Path2D-dependent tests skip under bun — that's expected.
- Deliberate-simplification / known-ceiling comments use the `NOTE:` prefix
  (e.g. `// NOTE: adaptive subdivision would be tighter here`) — name the
  ceiling and the upgrade path. Never use a tool/plugin brand as the prefix
  (no `ponytail:`, etc.); the marker must read as project intent.
- Verification bar for any player/converter change: `bun run test` green,
  `bun run build` green, corpus batch unchanged-or-better, and a browser
  eyeball of an affected demo scene (screenshots lie less than tests here —
  several real bugs were only visible on canvas). For frame-accurate visual
  truth, use the comparison harness at `tools/harness/` (see its README) —
  **thorvg is the parity target; lottie-web canvas is the floor** and the
  sanity cross-check (thorvg fails some things too: when JSON intent and
  lottie-web agree against thorvg, don't chase thorvg).
- Demo gallery scenes live in `examples/popcorn/*.css` (the source of truth,
  also test-globbed by the parser). The demo loads them dynamically via
  `import.meta.glob` in `packages/playground/src/examples.ts` — filename
  `NN-kebab-name.css` sets order + label; drop a file in to add a scene.
  Use the `creating-popcorn-animations` skill when authoring scenes.
- Commits: straight to main, short conventional messages, no attribution
  trailers. When multiple agents work in parallel, fence them to disjoint
  files and make each run the corpus gate.

## Releasing

npm publishing is **changesets** + `.github/workflows/release.yml`: run `bun
changeset`, merge to main, then merge the bot's "Version Packages" PR — that
merge publishes. Don't `bun run release` by hand.

`scripts/publish.ts` is a bun-specific shim. changesets shells out to `npm
publish` for any non-pnpm repo, and npm applies neither `publishConfig`
field-overrides nor `workspace:*` resolution. So the script splices each
package's dist-pointing `publishConfig` onto its manifest AND rewrites
`workspace:*` deps → real versions before publishing, then `git checkout`s the
src-pointing dev manifests back (dev keeps main/types/exports on `./src` so the
workspace runs build-free; only the published tarball points at `./dist`).
**Don't drop the `workspace:*` rewrite — without it the published tarballs are
uninstallable.** Tests are `bun:test`, so switching to pnpm (which would delete
this shim) isn't worth it.
