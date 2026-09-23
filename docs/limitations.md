# Format limitations

Popkorn is a close CSS dialect, scoped on purpose. Its capability target is
motion graphics: the things a shipping Lottie player renders and animates, not
the full CSS layout engine. Most of what's listed here is deliberate scope, and
every entry comes with the thing to reach for instead. For worked recipes that
translate classic CSS-art tricks into scene-graph shapes, see
[CSS art → Popkorn](css-art-in-popkorn.md).

One meta-limitation frames all the others: an unknown property name gets an
`unknown-property` warning (with a did-you-mean hint), but a known property
with a value it can't use is dropped silently at build time. `width: 10vw`,
`x: 1e2px`, and `fill: color-mix(...)` all parse and draw nothing. When a
declaration seems dead, check its value against the
[format reference](reference.md) before debugging anything else.

## No box model, no layout

There is no `position`, `margin`, `padding`, flexbox, or grid; the box-model
properties are rejected with a warning. A scene is a scene graph: explicit
shapes with coordinates, composed under groups with transforms. This is the
foundational trade, and it's permanent.

Instead: `left`/`top` are accepted as aliases for `x`/`y` (`right`/`bottom`
are rejected, since there is no containing box), `border: <w> solid <c>`
rewrites to `stroke-width` + `stroke`, and `padding` becomes arithmetic on the
child's coordinates.

## `box-shadow`: spread and inset need a basic shape

`box-shadow` works with CSS syntax: offsets, blur, spread, color, `inset`, and
comma-separated lists, all animatable. Spread is realized only on `rect`,
`circle`, and `ellipse`; on a `path`, `star`, or `polygon` an outer shadow's
spread is ignored. `inset` needs a shape outline, so it is dropped on text,
images, and groups.

Instead: for a spread shadow on free-form geometry, draw a second, larger copy
of the path behind it with `filter: blur(...)`. An inset ring on a group is a
stroked shape nested inside it.

## Circular corners only

`border-radius` takes one value or the 2 to 4 value per-corner form (and the
four `border-*-radius` longhands), but every corner is circular. The eight-value
elliptical form (`10px / 20px`) is rejected.

Instead: draw a `path`. An elliptical corner is one arc or quadratic curve.

## No pseudo-elements

No `::before`/`::after`: a pseudo-element selector is a parse error, and there
are no `content` boxes to decorate. Every visible layer is a real node with an
id.

Instead: promote each pseudo-element to a named child shape. Scenes read better
for it: the notch, the speaker, and the camera each get a name instead of
hiding inside one selector.

## Colors are values, not expressions

Hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklab()`/`oklch()`, and named colors
all work. There are no color *functions*: no `color-mix()`, no relative color
syntax, and nothing like Sass `darken()`/`lighten()`.

A whole color can ride a custom property: `fill: var(--brand)` binds live, so a
host `setVariable` recolors the node at runtime. A color's channels can't be
computed, though: `input()` yields numbers, and `rgb(var(--r), 0, 0)` does not
resolve its arguments. Gradients through `var()` are not live either.

Instead: precompute derived colors to literals (a comment noting the recipe,
like `/* darken(#272C31, 10%) */`, keeps the intent). To change color over
time, animate `fill`/`stroke` in `@keyframes`; solid colors, gradient stops,
and compatible gradients all interpolate there, in Oklab when either endpoint
is an `oklab()`/`oklch()` color.

## Transforms: 2D only

`translate`, `rotate`, `scale`, and `skew`/`skewX`/`skewY`, all animatable. No
3D, no `perspective`, no camera. Transform angles are degrees: `rad`, `grad`,
and `turn` convert inside the trig functions and `oklch()` hues, but
`rotate(0.5turn)` reads as half a degree. Rotation interpolates linearly with no
shortest-arc logic, deliberately, so `rotate(0deg)` to `rotate(360deg)` spins a
full turn.

Instead: write angles in `deg`. Faux-3D reads (flips, tilts) are
`scaleX`/`scaleY` animations, or a `skew` for a cheap perspective fake.

## Text animates as a whole node

Text supports `\n` multi-line content, `text-align`, `line-height`, and
`letter-spacing`, but there are no per-glyph animators: a text node draws and
animates as one unit.

Instead: per-character motion is one text node per character, usually stamped
from a `@define` symbol with a negative `animation-delay` stagger.

## No scripting

There are no JS expressions in the format, by design. Reactivity is
declarative: `var()`/`input()` bindings, `calc()` and the math functions,
`transition`, and `@machine` state machines. When a use case outgrows those,
the answer is a richer binding vocabulary, not an embedded script engine.

## Blend modes don't isolate a group

`mix-blend-mode` takes the full CSS keyword set, but the blend applies to each
shape's own paint. A group's blend mode is not an isolated composite: its
children blend individually, including against each other.

Instead: put `mix-blend-mode` on the shapes that should blend. Where
overlapping children must blend as one unit, merge them into a single `path`.

## Filters: the CSS function set

`filter` takes the CSS functions: `blur`, `drop-shadow`, `brightness`,
`contrast`, `saturate`, `grayscale`, `sepia`, `invert`, `opacity`, and
`hue-rotate`. There are no `url(#...)` SVG filter references. A filter list
animates only between keyframes with the same function sequence; a mismatch
holds instead of interpolating. The React Native/Skia backend draws filters
unfiltered, and that includes outer `box-shadow`s without spread, which render
through the same path.

Instead: keep keyframe filter lists structurally identical (use `blur(0px)` as a
placeholder). For shadows that must show on Skia, use a spread shadow on a basic
shape, or a blurred copy of the shape.

## Shape modifiers: union only

Merge-path union is supported. Subtract and intersect modes, and the
offset-path/zig-zag/pucker/round-corners shape modifiers, are skipped, matching
what shipping Lottie players actually implement.

Instead: bake the modified outline into the `path` data, or express a subtract
as an `evenodd` fill or an inverted mask.

## Grammar strictness

A few CSS habits don't parse: `//` line comments are a parse error (use
`/* */`), and exponent notation (`1e2`) is not a number. Units are `px`, `em`,
`rem`, `%`, `s`, `ms`, and the angles `deg`, `rad`, `grad`, `turn`; there is no
`vw`/`vh`/`pt`. `em`/`rem` parse but have no font-relative effect, and the
parser warns when they're used.

## Which of these might change

The box model, scripting, and 3D are settled scope: they define what Popkorn
is. Per-glyph text animation and group-isolated blending are gaps that may
close as real scenes demand them. If a scene needs one today, precompute by
hand rather than waiting.
