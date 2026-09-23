<div align="center">

# Popkorn

**What if a CSS animation could leave the browser?**

https://github.com/user-attachments/assets/7df900b1-42f8-4db8-8aec-5dd987ab1a42

[**▶ Playground**](https://usepopkorn.dev) &nbsp;·&nbsp; [Docs](docs/README.md) &nbsp;·&nbsp; [Coming from Lottie or Rive](docs/coming-from-lottie-and-rive.md) &nbsp;·&nbsp; [Why CSS](#why-css)

</div>

Popkorn is a format and a runtime for motion graphics. A scene is a single text
file written in a close dialect of CSS: `@keyframes`, `transform`,
`offset-path`, `:hover`, `z-index`. A small runtime plays that file in the
browser (Canvas2D or SVG) and on iOS and Android through React Native and Skia.

The file is the source of truth. You can read it, review it in a pull request,
change a color by hand, or ask a language model to rework the timing. Existing
Lottie and SVG files import into it.

## A scene

A ball that falls, bounces, and warms up when you point at it:

```css
:root {
  width: 400px;
  height: 400px;
  background: #1a1a2e;
}

@keyframes bounce {
  0% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.33, 0, 1, 1);
  }
  50% {
    transform: translateY(180px);
    animation-timing-function: cubic-bezier(0, 0, 0.67, 1);
  }
  100% {
    transform: translateY(0);
  }
}

#ball {
  type: circle;
  cx: 200px;
  cy: 80px;
  r: 36px;
  fill: #ff6b6b;
  animation: bounce 1.2s linear infinite;
  transition: fill 250ms ease;
  &:hover {
    fill: #ffd166;
  }
}
```

The only line that isn't standard CSS is `type: circle`. There is no box model,
so shapes use the geometry properties CSS already defines for SVG: `cx`, `cy`,
`r`, `fill`.

The hover and the bounce play on the same timeline, so the color change
blends in while the ball keeps moving. The bounce doesn't restart, and you
don't write any code to coordinate the two.

## Next to Lottie

Here is the position track of a real Lottie file, `bouncy_ball.json`:

```json
"p": { "a": 1, "k": [
  { "t": 0,  "s": [235, 106], "h": 0,
    "o": { "x": [0.333], "y": [0] }, "i": { "x": [1], "y": [1] } },
  { "t": 60, "s": [265, 441], "h": 0,
    "o": { "x": [0], "y": [0] }, "i": { "x": [0.667], "y": [1] } },
  ...
```

And the same motion after `popkorn-convert`:

```css
@keyframes Layer-Ellipse-Group-k {
  0% { transform: translate(31px, -63px); }
  50% { transform: translate(61px, 272px); animation-timing-function: cubic-bezier(0, 0, 0.667, 1); }
  100% { transform: translate(31px, -63px); }
}
```

Both files hold the same information, with Lottie's anchor point folded into
the translation. The difference is that you can read and edit the second one.

Converted scenes are usually smaller than the source JSON before compression.
Once gzipped, they come out about the same size (smaller for 8 of the 17 files
in `examples/lottie/`, larger for the rest). Converted SVGs are about 20%
smaller gzipped. The full web player, with the parser and all three renderers,
is 63 KB gzipped and has no dependencies.

It works in the other direction too. Popkorn can export any scene as a
Lottie file, so you can write and edit in Popkorn and still ship to the Lottie
players your apps already use. Nothing about your runtime has to change to try
it. The playground also exports scenes as GIF and MP4, for places that only
take video or images.

All three exports are flat recordings of the animation. Hover states, state
machines, and bindings to your app's data only work when the Popkorn player
runs the scene, so use the exports where you have no choice and the player
everywhere else.

If you ship Lottie or Rive today, [Coming from Lottie or
Rive](docs/coming-from-lottie-and-rive.md) covers what maps across, what
doesn't, and how the runtimes compare.

## Why CSS

Popkorn follows one rule: **if CSS already has a way to say something, use it,
with the same meaning.** Motion along a curve is `offset-path`. A hold is
`step-end`. A stagger is a negative `animation-delay`. Layering is `z-index`.
Easing is `cubic-bezier()`. Interaction states are `:hover` and `:active`, and
tweening between them is `transition`.

This matters for three groups of readers:

- **People who write CSS** can already read a scene. The additions are small:
  shape types, SVG-style geometry, and a few motion-graphics properties like
  trim paths and masks.
- **Language models** have seen a lot of CSS. They write working Popkorn from
  a short guide without fine-tuning. Every scene in the playground gallery was
  written this way.
- **Tools** get it for free. Scenes are `.css` files, so GitHub, editors and
  formatters highlight them, and a change shows up as a readable diff.

Popkorn isn't exactly CSS. It's a dialect that stays as close as it can, and
the gaps are listed in [Format limitations](docs/limitations.md).

## Where scenes come from

There's no dedicated authoring tool yet. Today a scene usually starts as an
import (Lottie or SVG) or as a prompt to the playground's Copilot. Some people
write them by hand, which works fine because the format is small.

Design tools are next. A Figma plugin that exports Figma Motion timelines to
Popkorn is in progress. The parser, converters and runtime are open source,
and each is a separate package, so an exporter for any other design tool can
build on the same pieces. A plugin only has to write the text format.

## Getting started

The easiest place to start is the [playground](https://usepopkorn.dev). It
runs in the browser with nothing to install. You can edit the gallery scenes
live, import a Lottie or SVG with the **Import** button, or ask the Copilot to
write a scene from a description.

To put a scene on a web page:

```html
<script type="module">
  import "@popkorn/player";
</script>

<popkorn-player src="scene.css" width="400" height="400"></popkorn-player>
```

In React Native:

```tsx
import { PopkornView } from "@popkorn/react-native";

<PopkornView source={scene} width={300} height={300} loop />;
```

The [Player API](docs/player-api.md) covers the playback controls (`seek`,
`setVariable`, `fire`) and the events a scene sends back to your app.

## What it can do

**Drawing.** Circles, rects, ellipses, polygons, stars, and full SVG paths.
Solid, linear and radial gradient fills. Strokes with dashes, caps and joins.
Text and images. CSS `filter`, `box-shadow`, and `mix-blend-mode`.

**Animation.** `@keyframes` with easing per keyframe, several animations
stacked on one node, motion paths, trim paths, and morphing between path
shapes. `calc()` and the CSS math functions work in property values. The
timeline depends only on time: seeking to the same moment always gives the
same frame, so scrubbing and exporting are exact.

**Structure.** A real scene graph with nested transforms, reusable symbols,
`repeat:` for generating fields of copies, clipping, masks and track mattes,
visibility windows, and time scaling per subtree.

**Interaction.** `:hover` and `:active` states with `transition`, properties
bound to the pointer with `input(cursor.x)`, and `@machine` state machines for
toggles, sequences, and timeouts. The host app sets variables and fires events
into the scene, and the scene reports state changes back. None of this needs a
scripting language ([State machines](docs/state-machines.md)).

## Status

Popkorn is at an early proof-of-concept stage, and the feature set is still
growing. The web renderers are the most mature. The React Native renderer
plays the same scenes and is marked work in progress. Lottie import is
regression-tested against the LottieFiles conformance corpus. Performance
tuning is the next big area of work.

## Documentation

- [Introduction](docs/introduction.md) and [Getting started](docs/getting-started.md)
- [Coming from Lottie or Rive](docs/coming-from-lottie-and-rive.md) and
  [Importing Lottie and SVG](docs/importing.md)
- [State machines](docs/state-machines.md) and [Player API](docs/player-api.md)
- [CSS art in Popkorn](docs/css-art-in-popkorn.md): common CSS-art tricks,
  rewritten as a scene graph
- [Format reference](docs/reference.md), [Format limitations](docs/limitations.md),
  and [Architecture](docs/architecture.md)

To run the playground locally:

```bash
bun install
bun run dev        # http://localhost:5173
```

## Packages

| Package                                                  | What it is                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| [`@popkorn/parser`](packages/popkorn-parser)             | Source to typed AST. Zero dependencies, no build step.       |
| [`@popkorn/player`](packages/popkorn-player)             | The `<popkorn-player>` web component, Canvas2D and SVG.      |
| [`@popkorn/converters`](packages/popkorn-converters)     | Lottie and SVG importers, Lottie exporter (CLI and library). |
| [`@popkorn/react-native`](packages/popkorn-react-native) | React Native renderer on Skia.                               |
| [`@popkorn/expo-demo`](packages/expo-demo)               | Expo app demoing the native renderer.                        |
| [`@popkorn/playground`](packages/playground)             | Scene editor with gallery, import, and Copilot.              |

## License

MIT
