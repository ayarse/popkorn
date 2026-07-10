# Popcorn

**What if a CSS animation could leave the browser?**

![Demo](./demo.gif)

Popcorn is a portable format for motion graphics, and a small runtime that plays
it. A scene is a self-contained file written in syntax you already know
(`@keyframes`, `transform`, `offset-path`, `z-index`), and the same file runs on
the web and on mobile today, natively through React Native. It keeps the
familiar, readable syntax of CSS, so a scene is never an opaque binary or JSON blob.

It began as a what-if and became a proof of concept, and it went further than
expected. Popcorn renders vector shapes, gradients, masks, motion paths, and
path morphing. Its interactivity goes past playback,
too: the familiar CSS pseudo-classes `:hover` and `:active` just work ✨, layering
on top of running animations without restarting them, and hand-written state
machines can drive toggles, taps, and app-state behavior with no scripting. It even imports real Lottie files and SVGs,
often a touch smaller than the source they came from.

It's still early, so it might have some rough edges. But the thing it set out to
prove, that a CSS animation can be a portable artifact, already works.

**▶ [Try it live in the playground](https://ayarse.github.io/popcorn)**: edit
scenes in the browser, no install.

## A scene, in full

This is a complete Popcorn scene: a red ball, falling and bouncing, with the
easing an animator would reach for.

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

If you've written CSS, you can already read every line. So can a language model,
which is the point (see [Why CSS](#why-css)).

Point at the ball and its color warms, smoothly tweened by the `transition`,
while the bounce never pauses or restarts. This is one of Popcorn's nicer
surprises: interactive states like `:hover` and `:active` compose _on top of_
running animations rather than fighting them, because the whole scene plays on
one continuous timeline. Dropping a small interaction onto an animating element
just works.

## Making a scene

It's early enough that there are no authoring tools yet, but you can already make
scenes today. Most start one of two ways, and because the format is readable
underneath both, you can always drop into the code to adjust:

- **From an existing animation.** Already have a Lottie or an SVG? Drop it into
  the [playground](https://ayarse.github.io/popcorn) with the **Import** button
  and it becomes a Popcorn scene you can read and tweak on the spot. No starting
  from a blank file.
- **By prompting.** The playground's **Popcorn Copilot** builds a scene from a
  description or edits the live one on request. It works because the format stays
  close enough to CSS that a model already knows it, no fine-tuning required.

Hand-authoring is a first-class option too, for simple scenes or for anyone who
enjoys writing CSS, and a visual creation tool may come in time. But whichever
path you take, you land on the same thing: one legible file you can open and
edit.

## Getting started

The quickest way in is the playground. No install, it runs in your browser:

**▶ [ayarse.github.io/popcorn](https://ayarse.github.io/popcorn)**

Edit the example scenes live, tweak values and watch them update, or import a
Lottie or SVG to see it convert.

To put a scene on your own page, the simplest way is the `<popcorn-player>` web
component:

```html
<script type="module">
  import "@popcorn/player";
</script>

<popcorn-player width="400" height="400"></popcorn-player>

<script>
  document.querySelector("popcorn-player").source = `
    #dot { type: circle; cx: 200px; cy: 200px; r: 40px; fill: #e94560; }
  `;
</script>
```

Driving the renderer yourself? The parser, scene builder, and renderers are all
exported from [`@popcorn/player`](packages/popcorn-player); its README covers the
programmatic API.

To run the playground or hack on Popcorn locally:

```bash
bun install
bun run dev        # http://localhost:5173
```

## What it can do

Popcorn covers most of what people reach for in real motion graphics:

- **Shapes & paint.** Circles, rects, ellipses, polygons, polystars, and full
  SVG paths. Solid fills, linear and radial gradients, strokes with dashes and
  caps.
- **Text & images.** Laid out and transformed as first-class scene nodes.
- **Animation.** `@keyframes` with per-keyframe easing, spring-style beziers,
  holds (`step-end`), staggering (negative `animation-delay`), and additive
  layering of animations on one node.
- **Motion & morphing.** `offset-path` for motion along a curve, trim paths and
  dashes, and path morphing between shapes.
- **Composition.** A real scene graph with parent/child transforms, symbols
  (reusable definitions), `z-index` layering, clipping, masks and track mattes,
  visibility windows, and per-subtree time scaling.
- **Interactivity, declared not scripted.** Bind properties to live input with
  `var()` and `input(cursor.x)`, react with `:hover` and `:active` tweened by CSS
  `transition`s, and drive multi-state behavior with state machines. Because it
  all runs on one continuous timeline, interactive states compose cleanly on top
  of running animations instead of restarting them. There's no script engine; the
  reactivity is part of the format
  ([docs/state-machines.md](docs/state-machines.md)).

The [playground](packages/playground) shows each of these as a live scene, and
the sources live in [`examples/popcorn/`](examples/popcorn). The full format
reference is in [docs/reference.md](docs/reference.md); the design and internals are in
[docs/architecture.md](docs/architecture.md).

## Why CSS

Choosing CSS wasn't a shortcut. It's the whole idea, and Popcorn holds itself to
one rule: **if CSS already has a way to express something, use it, with its real
semantics.** Motion paths are `offset-path`. Holds are `step-end`. Staggering is
a negative `animation-delay`. Layering is `z-index`. Popcorn never invents syntax
that CSS already has. (It isn't _exactly_ CSS. It's a close dialect, kept as near
to the real thing as we can, and maybe some of the good parts go upstream one
day 🤞)

Staying this close buys something rare: one format that two very different
audiences already read.

- **People already speak it.** There's a vibrant community making genuinely
  beautiful art in hand-written CSS. Popcorn meets them where they are, with no
  new mental model and no editor to learn.
- **Language models already speak it too.** Because Popcorn stays so close to
  real CSS, a model already knows most of it from its training data. There's no
  fine-tuned model and no bespoke format to teach. Hand it the small extra
  vocabulary and it writes valid, working Popcorn. That's a property you only get
  by refusing to invent syntax.

The payoff is a format that's hand-authorable, diffable in a pull request, and
generatable by an LLM, all at once.

## Status & what's next

In the browser it already works well, with two renderers behind it (Canvas2D and
SVG) and a wide range of real Lottie files converting and playing faithfully. The
same scenes run on mobile through a React Native (Skia) renderer, with a demo
Expo app in the repo; it's still marked work-in-progress but holds up just as
well. The clearest frontier from here is performance: deeper optimization and
benchmarking still to do.

It's early enough that even the file extension is unsettled. Scenes are `.css`
for now, mostly because it earns free syntax highlighting almost everywhere, a
side benefit of staying so close to CSS. A custom file extension is something we may explore later.

It's a personal what-if that turned out to work, shared in case the idea is as
interesting to you as it was to build. Feedback and curiosity welcome.

## Packages

| Package                                                  | What it is                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`@popcorn/parser`](packages/popcorn-parser)             | The format parser: source to typed AST. Hand-rolled, zero dependencies.       |
| [`@popcorn/player`](packages/popcorn-player)             | The `<popcorn-player>` web component and the Canvas2D + SVG runtimes.         |
| [`@popcorn/converters`](packages/popcorn-converters)     | Lottie and SVG to Popcorn importers (CLI + library).                          |
| [`@popcorn/react-native`](packages/popcorn-react-native) | React Native / Skia renderer, running scenes natively on mobile.              |
| [`@popcorn/expo-demo`](packages/expo-demo)               | Expo app demoing the native renderer.                                         |
| [`@popcorn/playground`](packages/playground)             | A live scene editor: example gallery, Lottie/SVG import, and Popcorn Copilot. |

## License

MIT
