# Introduction

Popkorn is a format and a runtime for motion graphics. The format is a text
file written in a close dialect of CSS. The runtime is a small player that
draws that file in the browser (Canvas2D or SVG) and on iOS and Android through
React Native and Skia.

The [README](../README.md) shows what a scene looks like. This page explains
how a scene works, so the rest of the docs make sense.

## A scene is a tree of shapes

In a web page, CSS styles elements that already exist in the HTML. A Popkorn
scene has no HTML. Each rule with an id selector creates a node, and the rule's
`type:` says what kind:

```css
:root { width: 400px; height: 300px; background: #10131c; }

#sun {
  type: circle;
  cx: 200px; cy: 150px; r: 40px;
  fill: #ffcf5c;
}
```

`:root` is the canvas. It sets the size and background, and holds scene-wide
custom properties.

Nest one rule inside another with `>` and you get a parent and a child. A
`type: group` node draws nothing itself. It exists to move, scale, fade or
clip everything inside it together:

```css
#planet {
  type: group;
  transform: translate(200px, 150px);
  > #body { type: circle; r: 20px; fill: #6ec1ff; }
  > #moon { type: circle; cx: 40px; r: 6px; fill: #ccd; }
}
```

The children are drawn in the parent's coordinates, so animating the group's
`transform` moves the planet and its moon as one unit. This nesting is the
scene graph. It works like layers and parenting in After Effects, or like
groups in Figma.

There is no layout. Nothing flows or wraps, and there's no `margin` or
`display: flex`. Every shape sits at the coordinates you give it, the same way
it would in SVG. The geometry properties come from SVG too (`cx`, `r`, `d`,
`fill`, `stroke`), because CSS already defines them for SVG shapes.

## One timeline

Animation works the way CSS animation does: `@keyframes` describe a track, and
`animation` plays it on a node. Easing, delays, iteration counts, `alternate`
and fill modes all mean the same thing as in CSS.

All the animations in a scene run off a single clock. The picture at any
moment depends only on the time, so jumping to 1.5 seconds always gives the
same frame. That's why scrubbing, looping and export are exact, and why
interaction can sit on top of animation without disturbing it. A `:hover`
changes a property for as long as the pointer is there, while the keyframes
keep running underneath.

When a scene needs to remember something, like a switch that stays on after
you let go, a `@machine` holds named states, and `:state()` rules restyle or
start animations when the machine enters a state. See
[State machines](state-machines.md).

## Format and runtime

The format and the runtime are kept separate on purpose. A scene file doesn't
depend on the renderer that plays it: the same file runs on Canvas2D, SVG and
Skia, and a shared conformance suite checks that all three draw it the same
way.

That separation is what makes the file the artifact you keep. You commit it,
review it, and ship it, and the runtime is simply whatever plays it on the
current platform.

## Why a CSS dialect

Popkorn uses a CSS feature whenever CSS already has one, with the same
meaning. Motion paths are `offset-path`, holds are `step-end`, staggers are
negative `animation-delay`, and layering is `z-index`. Where CSS has nothing
suitable (shape types, trim paths, masks as motion designers use them),
Popkorn adds as little as possible.

Because of that, anyone who has written CSS can read a scene, and so can a
language model: it writes working Popkorn from a short guide. Popkorn is still
a dialect, though, not CSS itself. [Format limitations](limitations.md) lists
where it differs.

## Where scenes come from

There's no dedicated authoring tool yet. Scenes come from three places today:

- **Import.** Convert an existing Lottie or SVG file
  ([Importing](importing.md)).
- **Prompting.** Describe a scene to the playground's Copilot, or ask it to
  change the one that's open ([Prompting with AI](prompting.md)).
- **Writing it.** For simple scenes, or if you like writing CSS, a text editor
  is enough.

Whichever way a scene starts, you end up with the same kind of readable file.

Design tools are next. A Figma plugin that exports Figma Motion timelines is in
progress. The parser, converters and runtime are open source and published as
separate packages, so an exporter for any design tool can be built the same
way: it only has to write the text format.

Scenes can also leave Popkorn. The playground exports any scene as a Lottie
file, a GIF, or an MP4. The Lottie export is also available in code, as
`convertPopkorn` in `@popkorn/converters`, so a scene made here can ship to an
existing Lottie player. Every export is a recording of the animation alone,
though. Interactivity, state machines and live bindings need the Popkorn
player, so play scenes with it directly wherever you can.

## Next

- [Getting started](getting-started.md): write a scene and put it on a page.
- [Coming from Lottie or Rive](coming-from-lottie-and-rive.md).
- [The playground](https://usepopkorn.dev): no install needed.
