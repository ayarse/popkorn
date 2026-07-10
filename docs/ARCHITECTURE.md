# Popcorn Architecture

How the pipeline fits together. See the [README](../README.md) for setup and the [DSL reference](REFERENCE.md) for syntax.

## Architecture

```
┌─────────────────────────┐
│  @popcorn/parser        │  parse(source) → AST
│  (hand-rolled, sync)    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  @popcorn/player        │  Rendering engine
│  <popcorn-player>       │
│  Canvas2DRenderer       │
│  AnimationScheduler     │
│  RenderLoop             │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  @popcorn/playground          │  Demo application
│  React wrapper          │
└─────────────────────────┘
```

### Parser

**@popcorn/parser** is a small tokenizing recursive-descent parser (`src/parser.ts`).
The DSL is a CSS subset, so `parse(source)` turns the source directly into a typed
AST — synchronously, with no dependencies or build step. Tests live alongside it in
`src/parser.test.ts` (`bun run test`).

### Parser → Player

**@popcorn/player** takes the parsed AST and:

- Builds a scene graph from the AST rules
- Renders shapes using Canvas 2D (ThorVG-compatible interface)
- Animates properties via keyframe interpolation
- Tracks input for interactive variables
- Exposes a `<popcorn-player>` web component

### Player → Demo

**@popcorn/playground** is a React app that:

- Uses the `<popcorn-player>` web component via a thin React wrapper
- Provides example scenes to demonstrate features (curated in
  `packages/playground/src/examples.ts`, kept in sync with `examples/*.css`)
- Shows the DSL source alongside the rendered output
- Imports real Lottie JSON via the browser-safe converter core

### Engine principles

The player's correctness rests on a few structural rules (spelled out with
their rationale in `CLAUDE.md` — read that before changing the engine):

- One transform implementation: render and hit-testing both consume the
  matrices in `scene/transform.ts` (transform-origin and motion-path placement
  included), so what you see is always what you can hover.
- Deterministic frames: every frame re-resolves node values from an immutable
  base snapshot in a fixed order — bindings, then animation, then
  `:hover`/`:active` — off a single seekable global timeline. `seek(t)` twice
  renders the identical frame.
- Properties become animatable by adding an entry to the property registry
  (`animation/registry.ts`), never by special-casing the interpolator.

### Lottie converter

`packages/popcorn-converters/src/lottie2popcorn.ts` is the conversion core (browser-safe; the demo
imports it), `packages/popcorn-converters/src/cli.ts` the CLI (`--validate` runs the
output through parse + buildSceneGraph; `--batch <dir>` converts a tree and
prints a clean/warn/blocked table). A normalization layer canonicalizes
real-world bodymovin output (legacy v4 keyframes, split positions, 0-255
colors, missing names) before mapping, so minified production exports convert
as reliably as pristine ones. Against the 80-file LottieFiles conformance
corpus, 73 files convert (66 clean); the remainder use rare shape modifiers
that mainstream Lottie players also skip.

### Comparison harness

`tools/harness/` is a frame-accurate lottie-web vs `<popcorn-player>`
side-by-side page — the visual-truth step of the verification bar (see its
README). lottie-web is the parity floor, not the ceiling.
