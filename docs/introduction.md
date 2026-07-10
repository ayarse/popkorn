# Introduction

**What if a CSS animation could leave the browser?**

Popcorn is a portable format for motion graphics, and a small runtime that plays
it. You describe a scene in a file that looks like the CSS you already know
(`@keyframes`, `transform`, `offset-path`, `z-index`), and the same file runs on
the web and on mobile today, natively through React Native.

Most animation formats are made by a tool and read by a machine. Popcorn works
the other way around: it stays in familiar, readable syntax, so a scene is never
an opaque binary or JSON blob, however it was made.

## A format and a runtime

Popcorn is two things:

- **The format** is a self-contained scene file. It is the portable artifact you
  write, commit, diff, and share.
- **The runtime** is a small player that draws the scene. There is one for the
  web (Canvas2D and SVG) and one for mobile (React Native via Skia), and the same
  file plays on all of them.

Keeping those two apart is what makes a scene portable: the file isn't wed to any
one player, so it travels wherever a runtime exists.

## Why CSS

Choosing CSS wasn't a shortcut. It's the whole idea, and Popcorn holds itself to
one rule: **if CSS already has a way to express something, use it, with its real
semantics.** Motion paths are `offset-path`. Holds are `step-end`. Staggering is
a negative `animation-delay`. Layering is `z-index`. Popcorn never invents syntax
that CSS already has.

(It isn't _exactly_ CSS. It's a close dialect, kept as near to the real thing as
we can, and maybe some of the good parts go upstream one day 🤞)

Staying this close buys something rare: one format that two very different
audiences already read.

- **People already speak it.** There's a vibrant community making genuinely
  beautiful art in hand-written CSS. Popcorn meets them where they are, with no
  new mental model and no editor to learn.
- **Language models already speak it too.** Because Popcorn stays so close to
  real CSS, a model already knows most of it from its training data. There's no
  fine-tuned model and no bespoke format to teach. Hand it the small extra
  vocabulary and it writes valid, working Popcorn.

## What it can do

Popcorn covers most of what people reach for in real motion graphics: vector
shapes, gradients, strokes, and full SVG paths; text and images; `@keyframes`
animation with per-keyframe easing; motion along a path, trim paths, and path
morphing; a real scene graph with parent/child transforms, symbols, `z-index`
layering, clipping, and masks; and interactivity that goes past playback, from
`:hover` and `:active` to hand-written state machines. See the
[format reference](reference.md) for the full surface.

## Where it's at

Popcorn is an early proof of concept. In the browser it already works well, and
a wide range of real Lottie files convert and play faithfully. The same scenes
run on mobile through the React Native renderer, which is still marked
work-in-progress but holds up. The clearest frontier from here is performance.

It's a personal what-if that turned out to work. If the idea is as interesting to
you as it was to build, dive in.

## Next

- [Getting Started](getting-started.md): write your first scene.
- [Play in the browser](https://ayarse.github.io/popcorn), no install required.
