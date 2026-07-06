# Popcorn

A CSS-like DSL for defining scene graphs and animations.

## Packages

- `@popcorn/parser` - Parser for the Popcorn DSL (hand-rolled, zero-dependency)
- `@popcorn/player` - Web component and rendering engine
- `@popcorn/demo` - React demo application

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

## DSL Syntax

### Canvas Configuration

```css
:canvas {
  width: 800px;
  height: 600px;
  background: #1a1a2e;
}
```

### Shapes

```css
/* Rectangle */
#rect {
  type: rect;
  x: 100px;
  y: 100px;
  width: 200px;
  height: 150px;
  rx: 10px;          /* border radius */
  fill: #4ecdc4;
  stroke: #333;
  stroke-width: 2px;
}

/* Circle */
#circle {
  type: circle;
  cx: 300px;
  cy: 200px;
  r: 50px;
  fill: #e94560;
}

/* Ellipse */
#ellipse {
  type: ellipse;
  cx: 500px;
  cy: 200px;
  rx: 60px;
  ry: 40px;
  fill: #ffe66d;
}

/* Group (for nesting) */
#group {
  type: group;
  transform: translate(100px, 100px);

  > #child {
    type: circle;
    cx: 0;
    cy: 0;
    r: 20px;
    fill: white;
  }
}
```

### Transforms

```css
#shape {
  transform: translate(100px, 50px);
  transform: rotate(45deg);
  transform: scale(1.5);
  transform: translate(100px, 50px) rotate(45deg) scale(1.5);
}
```

### Gradient Fills

`fill` and `stroke` accept CSS gradients. Color stops are hex or `rgb()`/`rgba()`.

```css
#a {
  type: rect;
  /* 0deg points up, 90deg right (CSS angle convention) */
  fill: linear-gradient(90deg, #ff0000 0%, #0000ff 100%);
}

#b {
  type: circle;
  /* radial is centered on the shape's bbox, radius = half its diagonal */
  fill: radial-gradient(#ffffff 0%, #000000 100%);
}
```

### Clipping

`clip-path` clips a node and all its descendants (most useful on a group).

```css
#masked {
  type: group;
  clip-path: circle(120px at 200px 150px);      /* circle(<r> at <x> <y>) */
  /* clip-path: inset(20px 20px 20px 20px);      inset(<t> <r> <b> <l>) */
  /* clip-path: path('M0 0 L200 0 L100 200 Z');  arbitrary SVG path */
}
```

### Animations

```css
@keyframes bounce {
  0% { transform: translateY(0); }
  50% { transform: translateY(-50px); }
  100% { transform: translateY(0); }
}

@keyframes colorCycle {
  0% { fill: #e94560; }
  50% { fill: #4ecdc4; }
  100% { fill: #e94560; }
}

#ball {
  type: circle;
  animation: bounce 1s ease-in-out infinite;
}
```

Animation shorthand: `name duration timing-function iteration-count direction delay`

```css
#shape {
  animation: spin 2s linear infinite;
  animation: pulse 1s ease-in-out infinite alternate;
  animation: fadeIn 0.5s ease-out 1 normal 0.2s;
}
```

### Variables & Interactivity

```css
:root {
  --primary: #e94560;
  --cursor-x: input(cursor.x);
  --cursor-y: input(cursor.y);
}

#follower {
  type: circle;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
  r: 20px;
  fill: var(--primary);
}
```

Available inputs:
- `cursor.x`, `cursor.y` - Mouse position
- `cursor.isDown` - Mouse button state (1 or 0)
- `scroll.x`, `scroll.y` - Scroll position
- `time` - Elapsed time in milliseconds

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
│  @popcorn/demo          │  Demo application
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

**@popcorn/demo** is a React app that:

- Uses the `<popcorn-player>` web component via a thin React wrapper
- Provides example scenes to demonstrate features
- Shows the DSL source alongside the rendered output

## License

MIT
