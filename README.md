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

### Text

```css
#label {
  type: text;
  content: "Hello";
  x: 400px;
  y: 300px;
  font-size: 32px;        /* default 16px */
  font-family: sans-serif; /* keyword or "Quoted Family"; default sans-serif */
  font-weight: bold;       /* keyword or number (700); default normal */
  text-anchor: middle;     /* start | middle | end; default start */
  fill: #ffffff;
}
```

Text nodes carry `fill`/`stroke`/gradients/opacity/transforms/clipping like any
other shape. `x`, `y`, and `font-size` are animatable and bindable.

### Star & Polygon

`type: star` and `type: polygon` are pure-geometry shapes (radius, points,
rotation) synthesized into the path pipeline — so they get fill, stroke, trim,
gradients, hit-testing and `fill-rule` for free. Geometry matches Lottie/After
Effects: with `rotation: 0` the first point faces straight up.

```css
#star {
  type: star;
  points: 5;             /* number of star points (static) */
  outer-radius: 130px;   /* tip radius */
  inner-radius: 45px;    /* valley radius (star only) */
  rotation: 0deg;        /* default 0 = pointing up */
  cx: 400px;             /* center */
  cy: 300px;
  outer-roundness: 0%;   /* 0 = sharp; >0 rounds the tips into beziers */
  inner-roundness: 0%;   /* valley rounding (star only) */
  fill: #ffe66d;
}

#hexagon {
  type: polygon;         /* `points` vertices on the outer radius, no inner */
  points: 6;
  outer-radius: 70px;
  cx: 160px;
  cy: 150px;
  fill: #4ecdc4;
}
```

`outer-radius`, `inner-radius`, `rotation`, `cx` and `cy` are animatable and
bindable; `points` is static. `outer-roundness`/`inner-roundness` are Lottie's
`os`/`is` (a percentage of the edge length turned into a bezier handle).

### Symbols

`@define <name> { ... }` declares a reusable symbol whose body is an ordinary
rule body (declarations, `>` children, `&:hover`/`&:active`). Instantiate it
with `use: <name>`; use-site declarations override the definition's.

```css
@define spark {
  type: circle;
  r: 5px;
  fill: #fbbf24;
}

#spark1 { use: spark; cx: 100px; cy: 100px; }
#spark2 { use: spark; cx: 200px; cy: 140px; fill: #60a5fa; } /* recoloured */
```

Symbols are expanded at build time by deep-cloning; each instance gets its own
animation state, and cloned children get namespaced ids (`spark1.tail`) so
instances never collide.

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

A gradient `fill`/`stroke` is animatable in `@keyframes`: each stop's offset and
color are interpolated. The two endpoints must be *compatible* — same gradient
type and same stop count — so stops pair up index-for-index. Incompatible
gradients step (hold the departing value) instead of interpolating.

```css
@keyframes recolor {
  0%   { fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%); }
  100% { fill: linear-gradient(45deg, #ffe66d 0%, #a855f7 100%); }
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

Multiple `path()` values are unioned into one clip region (a point inside **any**
of them is kept) — this maps Lottie's additive multi-mask:

```css
#masked {
  type: group;
  clip-path: path('M0 0 L60 0 L60 60 Z') path('M80 80 L140 80 L140 140 Z');
}
```

### Track Mattes

`matte` masks a node by another node's **alpha** or **luminance**. The matte
source is referenced by id (it can live anywhere in the scene) and is *not*
painted on its own — only sampled as the matte:

```css
#reveal {
  type: text;
  content: "POPCORN";
  matte: #wipe luma;       /* alpha | alpha-invert | luma | luma-invert */
}

#wipe {                    /* an animated white bar sweeping across = a wipe */
  type: rect;
  x: 0px; y: 0px; width: 100px; height: 120px;
  fill: #ffffff;
  animation: sweep 2s ease-in-out infinite;
}
```

- `alpha` keeps the node where the source is opaque; `alpha-invert` where it's
  transparent.
- `luma` keeps it where the source is bright; `luma-invert` where it's dark.

Compositing is done offscreen, so both subtrees line up exactly regardless of
their transforms. (Headless/no-canvas environments skip the matte and draw the
content directly.)

### Images

`type: image` draws a bitmap from a URL or `data:` URI into an x/y/width/height
box. Omit width/height to use the image's natural size once it loads.

```css
#logo {
  type: image;
  src: 'data:image/png;base64,iVBORw0…';   /* or 'https://…/logo.png' */
  x: 0px; y: 0px; width: 120px; height: 120px;
}
```

Images load asynchronously; the node is transparent until the bitmap decodes,
then the running loop paints it in. A decode failure logs a warning and the node
renders nothing.

### Trim Paths

Trim paths reveal only part of a node's **stroke** (the fill is always drawn in
full) — the effect behind Lottie-style progressive line drawing. Valid on any
strokeable node (`path`, `circle`, `ellipse`, `rect`). The trims are percentages
of the outline length and are animatable.

```css
@keyframes draw {
  0% { trim-end: 0%; }
  100% { trim-end: 100%; }
}

#signature {
  type: path;
  d: 'M100 300 C200 120 300 480 400 300';
  fill: none;
  stroke: #4ecdc4;
  stroke-width: 8px;
  stroke-linecap: round;          /* butt | round | square */
  animation: draw 2s ease-in-out infinite;
}
```

- `trim-start` (default `0%`) and `trim-end` (default `100%`) select the visible
  window of the outline.
- `trim-offset` (default `0%`) rotates the start point around the outline —
  animate it for a "marching" dash on a closed shape (circle/ellipse/rect).
- `stroke-linecap` sets the stroke's end caps: `butt` (default), `round`, or `square`.

`trim-start >= trim-end` hides the stroke entirely.

### Stroke Dashes

`stroke-dasharray` sets a repeating dash/gap pattern (in local units, like SVG);
`stroke-dashoffset` shifts the pattern along the stroke and is animatable.

```css
#dashed {
  type: polygon;
  points: 3;
  outer-radius: 70px;
  cx: 400px;
  cy: 300px;
  fill: none;
  stroke: #f472b6;
  stroke-width: 5px;
  stroke-dasharray: 16px 10px;   /* one or more lengths: dash gap dash gap … */
  stroke-dashoffset: 0px;        /* animate for a marching-ants effect */
}
```

Trim paths and dashes share Canvas's single dash slot, so when both are set on
one node **trim wins** and the dash array is ignored (compositing a dash inside a
trim window is a future upgrade).

### Fill Rule

`fill-rule` chooses the winding rule for `path`, `star` and `polygon` fills (and
their hit-testing and clipping): `nonzero` (default) or `evenodd`. With
`evenodd`, an inner subpath punches a hole out of an outer one.

```css
#donut {
  type: path;
  d: 'M0 0 H100 V100 H0 Z M35 35 H65 V65 H35 Z';
  fill: #4ecdc4;
  fill-rule: evenodd;   /* inner square becomes a hole */
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

Timing functions: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`,
`cubic-bezier(x1, y1, x2, y2)`, and `step-end` (alias `hold`) — a hold/step
that keeps the departing keyframe's value until the next keyframe, then jumps.
Works as the shorthand default easing or per-keyframe via
`animation-timing-function`:

```css
@keyframes blink {
  0%   { opacity: 1; animation-timing-function: step-end; }
  50%  { opacity: 0; animation-timing-function: step-end; }
  100% { opacity: 1; }
}
```

A path's `d` is animatable — **path morphing**. The two keyframe paths must be
*compatible*: the same command sequence (same letters in the same order, same
counts) after parsing, so their numeric arguments interpolate pairwise.
Incompatible sequences step (hold the departing path) instead of morphing.
Trim, fill-rule and hit-testing all keep working on the morphing path.

```css
@keyframes blob {
  0%   { d: 'M 400 150 C 483 150 550 217 550 300 C 550 383 483 450 400 450 Z'; }
  100% { d: 'M 400 130 C 520 180 580 240 560 320 C 540 400 460 470 380 460 Z'; }
}
```

A **negative delay** starts an animation as if it had already been running for
that long (the first `|delay|` of the timeline is skipped, iteration counting
included) — handy for staggering copies of the same animation:

```css
#a { animation: drift 3s linear infinite; }
#b { animation: drift 3s linear infinite; animation: drift 3s linear infinite -1s; }
```

### Motion Paths

Move a node along an arbitrary curve with the CSS Motion Path idiom. `offset-path`
is an SVG path in the node's local space; `offset-distance` is the position along
it by arc length (`0%`–`100%`, animatable); `offset-rotate` orients the node.

```css
@keyframes fly {
  0%   { offset-distance: 0%; }
  100% { offset-distance: 100%; }
}

#plane {
  type: path;
  d: "M -8 -6 L 8 0 L -8 6 L -4 0 Z";
  fill: #ffe66d;
  offset-path: path("M 100 400 C 250 100, 550 100, 700 400");
  offset-rotate: auto;              /* face along the path tangent */
  animation: fly 4s ease-in-out infinite;
}
```

- `offset-path: path("<svg d>")` — the motion path (static).
- `offset-distance: <pct>` — arc-length position, `0%` by default; animate it to
  travel the path. At `0%` (or with no path) placement is a no-op, so the node
  sits at its authored position.
- `offset-rotate: auto | <angle>deg | auto <angle>deg` — `auto` follows the
  tangent, an angle is a fixed orientation, `auto <angle>` is tangent plus a
  fixed offset. Default `auto`.

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
