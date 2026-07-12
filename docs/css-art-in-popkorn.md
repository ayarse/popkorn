# CSS art → Popkorn

You've made single-div art: a `::before`/`::after` army, a stack of
`background-image` gradients standing in for shapes, a `box-shadow` list
stamping out copies, a border trick faking a triangle. It works, but every
one of those is a workaround for something CSS boxes don't give you
natively — extra paintable layers, arbitrary vector shapes, cheap
repetition, non-rectangular clipping.

Popkorn is a *scene graph*, not a box model. Layers, shapes, repetition, and
clipping are first-class, so the workaround is usually just... the direct
way to say what you mean. This doc is a hack-by-hack translation table. Every
snippet below was checked against [`reference.md`](./reference.md); see the
`creating-popkorn-animations` skill for the full authoring workflow.

The examples here teach Popkorn's native property names (`x`/`y`, `fill`,
`rx`/`ry`, `stroke`), but a few CSS spellings are accepted as write-in-only
sugar and rewritten on the way in: `left`/`top` → `x`/`y`, `color`/`background`
→ `fill`, single-value `border-radius` → `rx`+`ry`, and `border: <w> solid <c>`
→ `stroke-width`+`stroke`. See [CSS aliases](./reference.md#css-aliases). They
only ease the first keystrokes — the saved format is always the canonical name,
so lean on the native names once you're fluent.

## `::before` / `::after` layer multiplication

CSS gives you exactly two extra paintable layers per element, so CSS art
piles pseudo-elements on pseudo-elements to get more surfaces to paint.
Popkorn nodes just... have children. Any node can be a `group` with as many
`> #child` nodes as you want, each independently shaped, painted, and
animated.

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

For *repeated* layers (a row of dots, a burst of spokes), don't hand-copy
nodes — `@define` a symbol once and `use:` it per instance, overriding only
what differs (see the `box-shadow` section below).

## Stacked `background-image` gradients as sprites

Faking an icon or a scene by layering `radial-gradient()`/`linear-gradient()`
backgrounds on one box is a way of drawing *shapes* using the one paintable
surface CSS backgrounds give you. Popkorn has real shape nodes — draw the
shape, then give it a gradient fill if you want one.

```css
/* before: a "moon" faked as two overlapping radial-gradient background layers */
.moon {
  background:
    radial-gradient(circle at 30% 30%, #1a1a2e 40%, transparent 41%),
    radial-gradient(circle at 50% 50%, #fef9e7 100%);
}
```

```css
/* after: an actual circle, with an actual bite taken out via clip-path,
   and a gradient fill for shading — no layered-background arithmetic */
#moon {
  type: circle; cx: 100px; cy: 100px; r: 60px;
  fill: radial-gradient(circle 60px at 100px 100px, #fef9e7 0%, #fde9a0 100%);
}
#bite {
  type: circle; cx: 128px; cy: 82px; r: 48px;
  fill: #0f0f23; /* same as stage background: punches a visual crescent */
}
```

Radial and linear gradients are natively animatable (see the `@property`
section below) — no swapping background layers to fake a transition.

## `box-shadow` multi-shadow stamping

Comma-separated `box-shadow` values are the classic way to stamp out dozens
of copies of a shape (starfields, confetti, polka-dot patterns) from one
element, because CSS has no "repeat this element N times" primitive.
Popkorn's analog is `@define` + repeated `use:` — a real symbol, actually
instantiated, each copy independently positionable, colorable, and
animatable (not just an offset/color/blur tuple).

```css
/* before: "50 stars" as 50 box-shadow entries on one 1px div */
.stars {
  box-shadow: 20px 30px white, 80px 10px white, 140px 60px white, /* ...47 more */;
}
```

```css
/* after: define the star once, stamp instances, animate them individually */
@define spark {
  type: circle;
  r: 2px;
  fill: #ffffff;
}

#s1 { use: spark; cx: 20px;  cy: 30px; }
#s2 { use: spark; cx: 80px;  cy: 10px; }
#s3 { use: spark; cx: 140px; cy: 60px; fill: #a5b4fc; } /* per-instance override */
```

Each `use:` clone gets its own animation state (and namespaced ids for any
children), so a twinkle animation staggered with negative `animation-delay`
(see below) reads as independent stars, not one shadow list moving in
lockstep.

## Border-triangle hack

Making a triangle from four transparent/colored borders is the single most
recognizable CSS-art trick, and exists purely because CSS has no polygon
primitive. Popkorn does — `type: polygon` (regular polygons) or `type: path`
for an arbitrary triangle.

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
/* after: say "triangle" */
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

Clipping a box's contents to its rectangle (or faking a circular crop with
`border-radius: 50%` + `overflow: hidden`) is CSS art's stand-in for
non-rectangular masking. Popkorn's `clip-path` clips a group (and its whole
subtree) to a circle, inset, or arbitrary path — and, unlike the CSS
workaround, `mask` also gives you alpha/luminance mattes from another node.

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

/* or matte one node's shape onto another (no CSS equivalent at all) */
#wiped {
  type: group;
  mask: #wipeShape alpha;   /* alpha | alpha-invert | luminance | luminance-invert */
}
```

## Eight-value `border-radius` blobs

Giving `border-radius` eight different length/percentage values (the
`10% 60% 40% 70% / 60% 40% 70% 30%` incantation) is how CSS art fakes an
organic blob, because there's no path primitive to draw one directly. In
Popkorn, draw the blob as a `path` — and because `d` is animatable between
compatible command sequences, you get free morphing that the border-radius
trick can only approximate by *animating the eight numbers*, which frequently
looks mushy because the topology doesn't actually change.

```css
/* before: eight border-radius values, animated pairwise, approximating a blob */
.blob {
  border-radius: 63% 37% 54% 46% / 55% 48% 52% 45%;
  animation: morph 6s ease-in-out infinite alternate;
}
```

```css
/* after: an actual bezier outline that morphs between two real shapes */
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

Both keyframes must have the same path *command sequence* (same
letters/counts) to interpolate — mismatched sequences step instead of
morphing.

## `position: absolute; left/top` placement

CSS art leans hard on `position: absolute` + `left`/`top`/`transform` because
that's the only way to escape flow layout and place things freely. Popkorn
has no flow layout at all — every shape node just carries its own geometry
(`x`/`y`, `cx`/`cy`, etc.) in the parent's coordinate space, and `transform`
composes on top of that same way CSS transforms do. There's no box model to
opt out of, so there's nothing to fight.

```css
/* before: escaping flow to place a decorative element */
.dot { position: absolute; left: 40px; top: 10px; width: 8px; height: 8px; }
```

```css
/* after: geometry is the placement, no positioning scheme to pick */
#dot { type: circle; cx: 44px; cy: 14px; r: 4px; fill: #22d3ee; }
```

Nested groups behave like nested coordinate spaces (translate/rotate/scale a
group and everything inside moves with it) — the closest Popkorn equivalent
to `position: relative` scoping, but declared as a real transform rather than
inferred from box containment.

## `margin`/`padding`, centering, and rows/columns

None of these are layout algorithms in Popkorn — there's no box to reflow, so
"spacing" is just arithmetic on the coordinates you already write. This is a
permanent trade, not a missing feature: a scene's positions are meant to be
literal and diffable, not solved for at render time.

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

Centering is the same arithmetic, just solved once: a child at
`(parentWidth - childWidth) / 2` instead of `margin: 0 auto`.

```css
/* before: center a 40px dot in a 200px-wide card via auto margins */
.dot { width: 40px; margin: 0 auto; }
```

```css
/* after: compute the centered coordinate directly (card is 200px wide, dot r=20px) */
#dot { type: circle; cx: 100px; cy: 40px; r: 20px; fill: #22d3ee; } /* 200/2, 80/2 */
```

Rows and columns are the same idea repeated: either compute each child's
`x`/`y` by hand (a fixed gap times its index), or — cleaner for a symbol
repeated many times — give the group a `transform: translate(...)` per
instance and let every child keep local `(0,0)`-relative geometry.

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

CSS stacking contexts (`z-index` interacting with `position`, `isolation`,
opacity-creates-a-layer, etc.) are one of the fussier corners of the box
model. Popkorn's paint order is much flatter: siblings paint in document
order, and `z-index` (plain ascending integers, default `0`, negative values
allowed) overrides that — full stop, no stacking-context nesting to reason
about, and the same order drives hit-testing.

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

`:checked` + a sibling combinator is CSS art's only way to get durable,
togglable state without JS — toggles, accordions, tab panels, all wedged
through a hidden checkbox. Popkorn has real named state: `@machine` declares
states and the events that transition between them, and any node can style
itself per-state with `:state()`.

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

`:state()` rules can also just set static paint (swap a fill/stroke for the
"on" look) with no animation at all — states aren't only for triggering
motion.

## `@property`-animated gradients

Animating a CSS gradient smoothly requires registering the custom property's
syntax with `@property` (and even then, browser support and stop-count
matching are finicky) — otherwise the browser just swaps gradients instead
of blending them. In Popkorn, gradients are a first-class animatable value:
`fill: linear-gradient(...)`/`radial-gradient(...)` interpolates stop
colors/offsets, angle, and radial center/radius directly inside
`@keyframes`, no registration step.

```css
/* before: needs @property syntax registration to animate smoothly at all */
@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.spin-gradient { background: conic-gradient(from var(--angle), red, blue); animation: spin 4s linear infinite; }
```

```css
/* after: just animate the gradient declaration */
@keyframes recolor {
  0%   { fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%); }
  100% { fill: linear-gradient(45deg, #ffe66d 0%, #a855f7 100%); }
}
#panel { type: rect; x: 0px; y: 0px; width: 200px; height: 120px; animation: recolor 3s ease-in-out infinite alternate; }
```

(Both patterns work — `conic-gradient` is supported, and animating the gradient
declaration directly avoids needing `@property` registration.)

## Goodies you already know that just work

Popkorn kept the CSS idioms you already have muscle memory for, instead of
inventing new syntax:

- **Negative `animation-delay` staggering** — `animation: drift 3s linear infinite -1s;` starts the animation as if it had already been running for 1s, the standard trick for staggering copies.
- **`steps()`/`step-end`** — hold values, frame-stepped animation, same syntax as CSS.
- **`linear(<stops>)` springs** — fake overshoot/bounce physics with control points above 1, no separate spring engine.
- **`offset-path`/`offset-distance`/`offset-rotate`** — CSS Motion Path, verbatim, for moving a node along an arbitrary curve.
- **`:hover`/`:active`** — pseudo-class-style interactive overrides (`&:hover { ... }` nested in a rule).
- **`var()`/`input()`** — custom properties and input bindings (`input(cursor.x)`, `input(scroll.progress)`) for numeric props, same substitution model as CSS custom properties.

## Current absences (honest list)

Popkorn is not yet full CSS-parity, and won't fake it:

- **No blend modes** — no `mix-blend-mode`/`background-blend-mode` equivalent.
- **No text animators / per-glyph effects** — text draws as a whole, not per-character.

None of these are permanent design decisions the way "no box model" is —
they're gaps that may close. If a scene needs one today, precompute the
values by hand rather than waiting.
