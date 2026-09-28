# CSS art → Popkorn

If you've made single-div art, you know the toolkit: a `::before`/`::after`
army, a stack of `background-image` gradients standing in for shapes, a
`box-shadow` list stamping out copies, a border trick faking a triangle. Each
of those works around something CSS boxes don't provide natively: extra
paintable layers, arbitrary vector shapes, cheap repetition, and
non-rectangular clipping.

Popkorn is built around a scene graph with no box model. Layers, shapes,
repetition, and clipping are first-class, so each of those tricks has a direct
equivalent. This page goes through them one at a time, with a before and after
for each. Every snippet was checked against the
[reference](./reference.md), which covers the full format.

The examples use Popkorn's native property names (`x`/`y`, `fill`, `rx`/`ry`,
`stroke`). A few CSS spellings are also accepted and rewritten on the way in:
`left`/`top` become `x`/`y`, `color`/`background` become `fill`,
`border-radius` becomes `rx`+`ry` (or the per-corner longhands when you give it
2 to 4 values), and `border: <w> solid <c>` becomes `stroke-width`+`stroke`.
See [CSS aliases](./reference.md#css-aliases). They help with the first
keystrokes, and the saved format always uses the canonical name.

## `::before` / `::after` layer multiplication

CSS gives you exactly two extra paintable layers per element, so CSS art piles
pseudo-elements on pseudo-elements to get more surfaces to paint. In Popkorn,
any node can be a `group` with as many `> #child` nodes as you want, each
independently shaped, painted, and animated.

```css
/* before: div + ::before + ::after squeezed into "three layers" */
.badge::before { content: ""; position: absolute; /* layer 2 */ }
.badge::after  { content: ""; position: absolute; /* layer 3, and that's it */ }
```

```css
/* after: as many real nodes as the design needs */
#badge {
  type: group;
  > #base   { type: circle; cx: 60px; cy: 60px; r: 50px; fill: #f59e0b; }
  > #ring   { type: circle; cx: 60px; cy: 60px; r: 50px; fill: none; stroke: #fff; stroke-width: 3px; }
  > #shine  { type: ellipse; cx: 45px; cy: 40px; rx: 18px; ry: 10px; fill: #ffffff55; }
  > #label  { type: text; content: "NEW"; x: 60px; y: 65px; text-anchor: middle; fill: #fff; }
}
```

For repeated layers such as a row of dots or a burst of spokes, `@define` a
symbol once and `use:` it per instance, overriding only what differs, instead
of copying nodes by hand (see the `box-shadow` section below).

## Stacked `background-image` gradients as sprites

Layering `radial-gradient()` and `linear-gradient()` backgrounds on one box to
fake an icon is a way of drawing shapes with the only paintable surface CSS
backgrounds give you. Popkorn has shape nodes, so you draw the shape and give it
a gradient fill if you want one.

```css
/* before: a "moon" faked as two overlapping radial-gradient background layers */
.moon {
  background:
    radial-gradient(circle at 30% 30%, #1a1a2e 40%, transparent 41%),
    radial-gradient(circle at 50% 50%, #fef9e7 100%);
}
```

```css
/* after: a circle with a gradient fill, and a second circle in the stage
   color painted over it to cut the crescent */
#moon {
  type: circle; cx: 100px; cy: 100px; r: 60px;
  fill: radial-gradient(circle 60px at 100px 100px, #fef9e7 0%, #fde9a0 100%);
}
#bite {
  type: circle; cx: 128px; cy: 82px; r: 48px;
  fill: #0f0f23; /* same as stage background: punches a visual crescent */
}
```

Linear and radial gradients animate directly in `@keyframes` (see the
`@property` section below), so a transition between two gradients needs no
layer swapping.

## `box-shadow` multi-shadow stamping

Comma-separated `box-shadow` values are the classic way to stamp out dozens of
copies of a shape (starfields, confetti, polka dots) from one element, because
CSS has no "repeat this element N times" primitive. Popkorn has one:
`repeat: <n>` stamps a rule into N sibling nodes, and each copy can be
positioned, colored, and animated on its own, where a shadow entry only carries
an offset, color, and blur. Differentiate the copies with `sibling-index()` and
`sibling-count()`, or use `@define` with repeated `use:` when each copy is
placed by hand.

```css
/* before: "50 stars" as 50 box-shadow entries on one 1px div */
.stars {
  box-shadow: 20px 30px white, 80px 10px white, 140px 60px white, /* ...47 more */;
}
```

```css
/* after: one rule, 50 real nodes, scattered and staggered by index */
#star {
  type: circle;
  r: 2px;
  fill: #ffffff;
  repeat: 50;
  cx: random(per-element, 0px, 400px);
  cy: random(per-element, 0px, 300px);
  animation: twinkle 2s ease-in-out infinite;
  animation-delay: calc(sibling-index() * -0.04s);
}
```

Each copy is a node with its own animation state (and namespaced ids for any
children), so the stagger reads as independent stars rather than one shadow
list moving in lockstep. When the copies don't follow a formula, for example a
handful of hand-placed shapes with individual overrides, `@define` + `use:` is
the better fit.

## Border-triangle hack

Building a triangle from four transparent and colored borders is the most
recognizable CSS-art trick, and it exists because CSS has no polygon
primitive. Popkorn has `type: polygon` for regular polygons and `type: path`
for any other triangle.

```css
/* before: a triangle is really a border of a degenerate box */
.triangle {
  width: 0; height: 0;
  border-left: 20px solid transparent;
  border-right: 20px solid transparent;
  border-bottom: 30px solid #ef4444;
}
```

```css
/* after: draw the triangle */
#triangle {
  type: path;
  d: 'M 20 0 L 40 30 L 0 30 Z';
  fill: #ef4444;
}
/* or, for a regular polygon: */
#tri2 {
  type: polygon; sides: 3; cx: 60px; cy: 15px; outer-radius: 18px;
  fill: #ef4444;
}
```

## `overflow: hidden` cropping

Clipping a box's contents to its rectangle, or faking a circular crop with
`border-radius: 50%` plus `overflow: hidden`, is how CSS art gets
non-rectangular masking. Popkorn's `clip-path` clips a group and its whole
subtree to a circle, an inset, or an arbitrary path. `mask` goes further and
uses another node as an alpha or luminance matte.

```css
/* before: overflow: hidden on a wrapper to crop children to a rounded box */
.window { overflow: hidden; border-radius: 50%; width: 120px; height: 120px; }
```

```css
/* after: clip the group directly */
#window {
  type: group;
  clip-path: circle(60px at 60px 60px);
  > #scene { /* anything drawn here is cropped to the circle */ }
}

/* or matte one node's shape onto another */
#wiped {
  type: group;
  mask: #wipeShape alpha;   /* alpha | alpha-invert | luminance | luminance-invert */
}
```

## Eight-value `border-radius` blobs

Giving `border-radius` eight different values (`10% 60% 40% 70% / 60% 40% 70%
30%`) is how CSS art fakes an organic blob, since there's no path primitive to
draw one directly. In Popkorn you draw the blob as a `path`. Its `d` property
animates between paths with the same command sequence, so you can morph
between two outlines you drew, where the CSS version can only animate the eight
radii.

```css
/* before: eight border-radius values, animated pairwise, approximating a blob */
.blob {
  border-radius: 63% 37% 54% 46% / 55% 48% 52% 45%;
  animation: morph 6s ease-in-out infinite alternate;
}
```

```css
/* after: a bezier outline that morphs between two drawn shapes */
@keyframes blobMorph {
  0%   { d: 'M 400 150 C 483 150 550 217 550 300 C 550 383 483 450 400 450 C 317 450 250 383 250 300 C 250 217 317 150 400 150 Z'; }
  100% { d: 'M 400 130 C 520 180 580 240 560 320 C 540 400 460 470 380 460 C 300 450 240 380 250 300 C 260 220 320 160 400 130 Z'; }
}
#blob {
  type: path;
  fill: #a855f7;
  animation: blobMorph 6s ease-in-out infinite alternate;
}
```

Both keyframes must use the same command sequence (same letters, same counts)
to interpolate. Mismatched sequences step from one to the other instead of
morphing.

## `position: absolute; left/top` placement

CSS art leans on `position: absolute` with `left`/`top`/`transform` because
that's the way to escape flow layout and place things freely. Popkorn has no
flow layout. Every shape node carries its own geometry (`x`/`y`, `cx`/`cy`,
and so on) in its parent's coordinate space, and `transform` composes on top of
that the way CSS transforms do.

```css
/* before: escaping flow to place a decorative element */
.dot { position: absolute; left: 40px; top: 10px; width: 8px; height: 8px; }
```

```css
/* after: geometry is the placement, no positioning scheme to pick */
#dot { type: circle; cx: 44px; cy: 14px; r: 4px; fill: #22d3ee; }
```

Nested groups behave like nested coordinate spaces: translate, rotate, or scale
a group and everything inside moves with it. That's the closest Popkorn
equivalent to `position: relative` scoping, declared as a transform on the
group rather than inferred from box containment.

## `margin`/`padding`, centering, and rows/columns

Popkorn has no layout algorithm for any of these. There's no box to reflow, so
spacing is arithmetic on the coordinates you already write. This is a design
choice: a scene's positions are literal and diffable, and nothing is solved
for at render time.

```css
/* before: a card with 16px padding around its label */
.card { width: 200px; height: 80px; padding: 16px; }
.card .label { /* flows to x=16, y=16 inside the padding box */ }
```

```css
/* after: bake the offset into the child's coordinates */
#card {
  type: group;
  > #bg    { type: rect; x: 0px; y: 0px; width: 200px; height: 80px; fill: #1e293b; }
  > #label { type: text; content: "Title"; x: 16px; y: 16px; fill: #fff; } /* 16px "padding" */
}
```

Centering is the same arithmetic, solved once: place a child at
`(parentWidth - childWidth) / 2` instead of writing `margin: 0 auto`.

```css
/* before: center a 40px dot in a 200px-wide card via auto margins */
.dot { width: 40px; margin: 0 auto; }
```

```css
/* after: compute the centered coordinate directly (card is 200px wide, dot r=20px) */
#dot { type: circle; cx: 100px; cy: 40px; r: 20px; fill: #22d3ee; } /* 200/2, 80/2 */
```

Rows and columns repeat the idea. Either compute each child's `x`/`y` by hand
(a fixed gap times its index), or, for a symbol repeated many times, give a
group a `transform: translate(...)` per row and let every child keep geometry
relative to `(0,0)`.

```css
/* before: a row of three 48px icons with 12px gaps via flexbox */
.toolbar { display: flex; gap: 12px; }
```

```css
/* after: fixed-step arithmetic (icon width 48px + 12px gap = 60px stride) */
@define icon { type: rect; width: 48px; height: 48px; fill: #6366f1; }
#icon-1 { use: icon; x: 0px;   y: 0px; }
#icon-2 { use: icon; x: 60px;  y: 0px; }
#icon-3 { use: icon; x: 120px; y: 0px; }

/* or, translate a group per row/column instead of restating x/y each time */
#row-2 { type: group; transform: translate(0px, 60px); > #icon-4 { use: icon; } }
```

## Stacking order without `z-index: auto` flow rules

CSS stacking contexts, where `z-index` interacts with `position`, `isolation`,
and opacity creating a layer, are one of the fussier corners of the box model.
Paint order in Popkorn is flatter. Siblings paint in document order, and
`z-index` (plain integers, default `0`, negatives allowed) reorders them. There
are no nested stacking contexts to reason about, and the same order drives
hit-testing.

```css
/* before: relying on stacking-context quirks to get an overlay above content */
.overlay { position: absolute; z-index: 10; }
```

```css
/* after: reorder by document position, or override with z-index directly */
#card {
  type: group;
  > #bg      { type: rect; x: 0px; y: 0px; width: 200px; height: 80px; fill: #1e293b; }
  > #label   { type: text; content: "Title"; x: 16px; y: 16px; fill: #fff; }
  > #ribbon  { type: path; d: '...'; z-index: -1; } /* pinned behind bg despite coming last */
}
```

## Checkbox hack

`:checked` plus a sibling combinator is how CSS art gets durable, togglable
state without JavaScript: toggles, accordions, and tab panels all run through a
hidden checkbox. Popkorn has named state. `@machine` declares states and the
events that move between them, and any node can style itself per state with
`:state()`.

```css
/* before: a hidden checkbox drives a sibling's style via :checked */
input:checked ~ .panel { display: block; }
```

```css
/* after: a two-state machine, no proxy element */
@machine drawer {
  initial: closed;
  state closed { to: open   on click(#handle); }
  state open   { to: closed on click(#handle); }
}

#panel {
  type: rect; x: 0px; y: 0px; width: 200px; height: 0px; fill: #1e293b;
  &:state(drawer.open) { animation: expand 300ms ease-out; }
}
```

A `:state()` rule can also set static paint, such as a different fill or stroke
for the "on" look, with no animation at all.

## `@property`-animated gradients

To animate a CSS gradient smoothly you register the custom property's syntax
with `@property`, and stop counts still have to line up. Without that, the
browser swaps one gradient for the other instead of blending. In Popkorn,
gradients are an animatable value: `fill: linear-gradient(...)` or
`radial-gradient(...)` inside `@keyframes` interpolates stop colors and
offsets, the angle, and the radial center and radius, with no registration
step.

```css
/* before: needs @property syntax registration to animate smoothly at all */
@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.spin-gradient { background: conic-gradient(from var(--angle), red, blue); animation: spin 4s linear infinite; }
```

```css
/* after: animate the gradient declaration */
@keyframes recolor {
  0%   { fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%); }
  100% { fill: linear-gradient(45deg, #ffe66d 0%, #a855f7 100%); }
}
#panel { type: rect; x: 0px; y: 0px; width: 200px; height: 120px; animation: recolor 3s ease-in-out infinite alternate; }
```

`conic-gradient` is supported as a fill too, and its `from` angle and `at`
center animate the same way. It paints natively on the Canvas2D and Skia
backends; the SVG backend has no conic primitive and falls back to a flat
color (see [Gradient Fills](./reference.md#gradient-fills)).

## CSS idioms that carry over

Beyond replacing hacks, Popkorn keeps a set of CSS idioms with their CSS
meaning, so there's no new syntax to learn for them.

| Idiom | In Popkorn |
| --- | --- |
| Negative `animation-delay` | `animation: drift 3s linear infinite -1s;` starts as if already running for 1s, the usual way to stagger copies. |
| `steps()` / `step-end` | Holds and frame-stepped animation, same syntax as CSS. |
| `linear(<stops>)` | Overshoot and bounce curves with control points above 1, with no separate spring system. |
| `offset-path` / `offset-distance` / `offset-rotate` | CSS Motion Path, for moving a node along an arbitrary curve. |
| `:hover` / `:active` | Interactive overrides, nested in a rule as `&:hover { ... }`. |
| `var()` / `input()` | Custom properties and input bindings (`input(cursor.x)`, `input(scroll.progress)`) for numeric properties, with the same substitution model as CSS custom properties. |
| `calc()` and CSS math functions | `min()`/`max()`/`clamp()`, `round()`/`mod()`/`rem()`, trig and exponentials, over `var()`/`input()` values, evaluated per frame. |
| `mix-blend-mode` | The full CSS keyword set, on all three renderer backends. |
| `box-shadow` | A drop shadow (including `inset`) on a node. |

## What's not there yet

A few CSS art features have no Popkorn equivalent today.

`background-blend-mode` isn't supported. A node blends against the scene with
`mix-blend-mode`, but a paint can't blend against its own backdrop.

`border-radius` accepts one value for uniform corners and 2 to 4 values for
per-corner radii, which are circular. The elliptical slash form
(`10px / 20px`) is rejected. For uniform elliptical corners on a `rect`, set
`rx` and `ry` to different values; for anything else, draw the outline with
`type: path`.

Text draws as a whole. There are no text animators or per-glyph effects, which
matches what shipping Lottie players support. To animate individual
characters, split them into separate text nodes.
