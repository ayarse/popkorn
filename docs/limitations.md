# Format limitations

Popkorn is a close CSS dialect, scoped on purpose. Its capability target is
motion graphics: the things a shipping Lottie player renders and animates, not
the full CSS layout engine. Most of what's listed here is deliberate scope, and
every entry comes with the thing to reach for instead. For worked recipes that
translate classic CSS-art tricks into scene-graph shapes, see
[CSS art → Popkorn](css-art-in-popkorn.md).

One meta-limitation frames all the others: the parser is generic, so an
unsupported property parses fine and is silently ignored at build time. A
declaration that does nothing is far more likely than a syntax error. When a
property seems dead, check it against the [format reference](reference.md)
before debugging anything else.

## No box model, no layout

There is no `position`, `margin`, `padding`, `border`, flexbox, or grid. A
scene is a scene graph: explicit shapes with coordinates, composed under groups
with transforms. This is the foundational trade, and it's permanent.

Instead: `left`/`top` placement becomes `x`/`y` (or `cx`/`cy`, or a
`transform: translate(...)` on a group), `border` becomes `stroke`, and
`padding` becomes arithmetic on the child's coordinates.

## No `box-shadow`

Neither inset nor outset, and no multi-shadow lists.

Instead: an inset ring (`box-shadow: inset 0 0 0 6px ...`) is a stroked rect
nested inside the outer one. A soft outer shadow is `filter: drop-shadow(...)`
(static, one per node). The multi-shadow stamping trick (one element, fifty
shadows) becomes a `@define` symbol instantiated per copy, which also unlocks
per-copy overrides and animation.

## One radius per rect

`rx`/`ry` round all four corners of a rect equally. There is no per-corner
`border-radius`, and no eight-value elliptical form.

Instead: draw a `path`. A rect with only its bottom corners rounded is four
lines and two quadratic curves.

## No pseudo-elements

No `::before`/`::after`, and no `content` boxes to decorate. Every visible
layer is a real node with an id.

Instead: promote each pseudo-element to a named child shape. Scenes read better
for it: the notch, the speaker, and the camera each get a name instead of
hiding inside one selector.

## Colors are values, not expressions

Hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, and named colors all work, and all
fold to a concrete color at build time. There are no color *functions*: no
`color-mix()`, and nothing like Sass `darken()`/`lighten()`.

`var()` and `input()` bind numbers only, so a color can't be driven through a
custom property or a runtime input either.

Instead: precompute derived colors to literals (a comment noting the recipe,
like `/* darken(#272C31, 10%) */`, keeps the intent). To change color over
time, animate `fill`/`stroke` in `@keyframes`; solid colors, gradient stops,
and compatible gradients all interpolate there.

## Transforms: 2D, no skew

`translate`, `rotate`, and `scale` only. No `skew`/`skewX`/`skewY`, no 3D, no
`perspective`, no camera. One related behavior is deliberate rather than
missing: rotation interpolates linearly with no shortest-arc logic, so
`rotate(0deg)` to `rotate(360deg)` spins a full turn.

Instead: skew-shaped geometry is authored as a `path`; faux-3D reads (flips,
tilts) are `scaleX`/`scaleY` animations.

## Text is one line, one unit

No `text-align`, `line-height`, or `letter-spacing`, and no per-glyph
animators: text draws and animates as a whole node.

Instead: multi-line copy is one text node per line; per-character motion is one
text node per character, usually stamped from a `@define` symbol with a
negative `animation-delay` stagger.

## No scripting

There are no JS expressions in the format, by design. Reactivity is
declarative: `var()`/`input()` bindings, `calc()` and the math functions,
`transition`, and `@machine` state machines. When a use case outgrows those,
the answer is a richer binding vocabulary, not an embedded script engine.

## No blend modes

No `mix-blend-mode` equivalent. Compositing is `clip-path`, `mask` (alpha and
luminance, plus inverts), and group `opacity` (which cascades down the
subtree).

## Filters: two functions

`filter` supports `blur(...)` (radius animatable in `@keyframes`) and
`drop-shadow(...)` (static). Anything else in a filter list is dropped.

## Shape modifiers: union only

Merge-path union is supported. Subtract and intersect modes, and the
offset-path/zig-zag/pucker/round-corners shape modifiers, are skipped, matching
what shipping Lottie players actually implement.

Instead: bake the modified outline into the `path` data, or express a subtract
as an `evenodd` fill or an inverted mask.

## Grammar strictness

A few CSS habits don't parse: `//` line comments (use `/* */`), leading-dot
numbers (`0.5`, never `.5`), and exponent notation. Units are `px`, `deg`,
`em`, `rem`, `ms`, `s`, and `%`; there is no `vw`/`vh`/`pt`/`turn`.

## Which of these might change

The box model, scripting, and 3D are settled scope: they define what Popkorn
is. Blend modes and per-glyph text animation are gaps that may close as real
scenes demand them. If a scene needs one today, precompute by hand rather than
waiting.
