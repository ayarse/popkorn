# Popcorn

**Lottie you can write by hand.** Popcorn is a CSS-subset DSL for scene graphs
and motion graphics, played by a zero-dependency Canvas2D engine. It targets
parity with Lottie players in rendering and animation capability — vector
shapes, gradients, masks and track mattes, trim paths, motion paths, path
morphing, symbols, per-subtree time scoping, interactive state machines — while
the format stays something
a human (or an LLM) can author, read, and diff, where Lottie JSON is
machine-generated and opaque.

Design stance, in one paragraph: when a capability exists in CSS, Popcorn uses
the CSS property and its semantics (`offset-path` for motion paths, `step-end`
for holds, negative `animation-delay` for staggering, `z-index` for layering)
rather than inventing syntax. Interactivity is declarative — `var()` and
`input(cursor.x)` bindings — not a scripting engine. Real Lottie files convert
into the DSL via the bundled converter (`tools/lottie2popcorn-cli.ts`, or the
demo's Import button), validated continuously against the LottieFiles
conformance corpus. Static SVG imports too, via `tools/svg2popcorn-cli.ts` (same
Import button) — phase 1 brings in the artwork; animated SVG is a later phase.

## Packages

- `@popcorn/parser` - Parser for the Popcorn DSL (hand-rolled, zero-dependency)
- `@popcorn/player` - Web component and Canvas2D rendering engine
- `@popcorn/demo` - React demo application
- `@popcorn/skia` - React Native Skia renderer (proof of concept) — runs the same `.css` scenes on React Native and the web
- `@popcorn/expo-demo` - Expo app demonstrating the Skia renderer

## Getting Started

```bash
bun install
bun run dev
```

Open http://localhost:5173

## Usage

### Web Component

The easiest way to use Popcorn is via the `<popcorn-player>` web component:

```html
<script type="module">
  import '@popcorn/player';
</script>

<popcorn-player
  width="800"
  height="600"
  background="#1a1a2e"
></popcorn-player>

<script>
  const player = document.querySelector('popcorn-player');
  player.source = `
    #circle {
      type: circle;
      cx: 400px;
      cy: 300px;
      r: 50px;
      fill: #e94560;
    }
  `;
</script>
```

### JavaScript API

For more control, use the lower-level APIs:

```ts
import { parse, buildSceneGraph, Canvas2DRenderer, RenderLoop } from '@popcorn/player';

const ast = parse(source);
const scene = buildSceneGraph(ast);

const renderer = new Canvas2DRenderer(canvas);
const loop = new RenderLoop(renderer);
loop.setScene(scene);
loop.start();
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start demo dev server |
| `bun run build` | Build demo app |
| `bun run test` | Run parser tests |

## Minification

`serialize(sheet, { minify })` in **@popcorn/parser** turns an AST back into DSL
source — pretty by default, or minified (no comments or optional whitespace,
shortest value-preserving number forms). Minification is done by round-tripping
through the parser, so the output is **guaranteed to parse to the same AST as the
input** (a data-driven test asserts this for every scene in `examples/`).

```
bun tools/popcorn-minify.ts <in.css> [-o out.css] [--pretty]
```

Default minifies; `--pretty` reformats. Byte counts are printed to stderr. Across
the example scenes, minification is ~40% smaller.

## DSL Syntax

The full DSL reference — shapes, text, symbols, transforms, gradients, clipping,
track mattes, images, trim paths, dashes, animations, motion paths, time scoping,
layering, and interactivity — lives in [docs/DSL.md](docs/DSL.md).

## Project Structure

```
popcorn/
├── packages/
│   ├── demo/             # React demo app
│   ├── popcorn-parser/   # DSL parser (hand-rolled) → AST
│   └── popcorn-player/   # Web component & renderer
├── examples/             # Example DSL files
└── docs/                 # Documentation
```
## Architecture

The pipeline, engine principles, Lottie converter, and comparison harness are
described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).


## License

MIT
