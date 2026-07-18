# Popkorn Architecture

How the pipeline fits together. See the [README](../README.md) for setup and the [format reference](reference.md) for syntax.

## Pipeline

```
┌─────────────────────────┐  ┌─────────────────────────┐
│  Lottie JSON / SVG      │  │  @popkorn/converters     │  Lottie + SVG import
└───────────┬─────────────┘  │  (browser-safe core, CLI)│
            │                └───────────┬─────────────┘
            └──────────────┬─────────────┘
                            ▼
┌─────────────────────────┐
│  @popkorn/parser        │  parse(source) → AST
│  (zero deps, sync)      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  @popkorn/player        │  Rendering engine
│  <popkorn-player>       │
│  Canvas2DRenderer       │
│  AnimationScheduler     │
│  RenderLoop             │
└───────────┬─────────────┘
            │
     ┌──────┴──────┐
     ▼             ▼
┌───────────┐  ┌──────────────────────┐
│ playground│  │ @popkorn/react-native│  Skia backend
│ React app │  │                      │
└───────────┘  └──────────────────────┘
```

### Parser

**@popkorn/parser** is a small tokenizing recursive-descent parser (`src/parser.ts`).
The format is a CSS subset, so `parse(source)` turns the source directly into a typed
AST, synchronously, with no dependencies or build step. Parse errors surface through
a structured diagnostics channel (`src/diagnostics.ts`) rather than bare throws, so a
host can point at the offending line. A separate crush mode (`src/crush.ts`) minifies
a scene for shipping. Tests live alongside it in `src/parser.test.ts` (`bun run test`).

### Parser → Player

**@popkorn/player** takes the parsed AST and:

- Builds a scene graph from the AST rules
- Renders shapes through a primitive renderer interface (Canvas2D and SVG on the
  web, Skia on native via `@popkorn/react-native`)
- Animates properties via keyframe interpolation
- Tracks input for interactive variables
- Exposes a `<popkorn-player>` web component

Artboard clipping is on by default: the scene is cropped to the `:root` stage box,
the way an After Effects comp crops to its bounds. `:root { overflow: visible }` opts
out (`runtime/loop.ts`, `clipToScene`).

### Player → Playground

**@popkorn/playground** is a React app that:

- Uses the `<popkorn-player>` web component via a thin React wrapper
- Provides example scenes to demonstrate features (curated in
  `packages/playground/src/examples.ts`, kept in sync with `examples/popkorn/*.css`)
- Shows the scene source alongside the rendered output
- Imports real Lottie JSON via the browser-safe converter core

### Engine principles

The player's correctness rests on a few structural rules:

- One transform implementation: render and hit-testing both consume the
  matrices in `scene/transform.ts` (transform-origin and motion-path placement
  included), so what you see is always what you can hover.
- Deterministic frames: every frame re-resolves node values from an immutable
  base snapshot in a fixed order (bindings, then animation, then
  `:hover`/`:active`) off a single seekable global timeline. `seek(t)` twice
  renders the identical frame.
- Properties become animatable by adding an entry to the property registry
  (`animation/registry.ts`), never by special-casing the interpolator.
- Paint order follows document order among siblings, changed only by
  `z-index` (a stable sort); hit-testing walks the same order in reverse, so
  the topmost thing drawn is the first thing hit.
- Rendering decisions live once, in the shared walk (`runtime/loop.ts`'s
  `renderNode`) and shared helpers (`renderer/gradient-geometry.ts`,
  `paint-state.ts`, `stroke.ts`), never duplicated per backend. Canvas2D, SVG,
  and Skia each only realize those decisions on their own platform. A single
  spec table, `renderer/conformance.ts`, runs the same cases against all
  three backends to keep them from drifting apart.

### Lottie converter

`packages/popkorn-converters/src/lottie2popkorn.ts` is the conversion core (browser-safe; the demo
imports it), `packages/popkorn-converters/src/cli.ts` the CLI (`--validate` runs the
output through parse + buildSceneGraph; `--batch <dir>` converts a tree and
prints a clean/warn/blocked table). A normalization layer canonicalizes
real-world bodymovin output (legacy v4 keyframes, split positions, 0-255
colors, missing names) before mapping, so minified production exports convert
as reliably as pristine ones. Against the 160-file LottieFiles conformance
corpus, 142 files convert clean, 11 convert with warnings, and 7 stay blocked
on rare shape modifiers that mainstream Lottie players skip too.

### SVG converter

`packages/popkorn-converters/src/svg2popkorn.ts` converts SVG the same way, sharing the
Lottie converter's `Converter`/`convertSvg`/`validate` contract (its own
dependency-free XML reader lives beside it in `svg-xml.ts`). It maps CSS
`@keyframes` and basic SMIL `<animate>`/`<animateTransform>` into Popkorn
`@keyframes` and `animation-*`, and shares the same CLI (`--validate`,
`--batch`) against the fixtures in `examples/svg/`.

### Comparison harness

`tools/harness/` is a frame-accurate side-by-side page comparing
`<popkorn-player>` against lottie-web and ThorVG at the same paused frame, with
per-region pixel diffing (see its README). It's how rendering changes get
checked visually. The goal is matching the intended After Effects motion, not
matching any one reference renderer byte-for-byte — the references sometimes
disagree with each other.
