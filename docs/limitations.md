# Limitations

Popkorn is young, and it's small on purpose. It aims at motion graphics, the
kind of thing a Lottie player draws and animates, rather than everything CSS
can do in a browser. So some of what's missing is a choice, and some is simply
work that hasn't happened yet. This page is the honest list of both, along with
what to reach for in the meantime.

If you're porting classic CSS art, [CSS art → Popkorn](css-art-in-popkorn.md)
has worked recipes for most of the tricks below.

## First, the one that trips everyone up

Popkorn tells you when it doesn't recognize a property name: you get an
`unknown-property` warning, usually with a did-you-mean hint. But when the
property is fine and the *value* isn't something it can use, the declaration is
quietly dropped at build time. `width: 10vw`, `x: 1e2px` and
`fill: color-mix(...)` all parse without complaint and then draw nothing.

So if a line seems to do nothing, check its value against the
[format reference](reference.md) before digging anywhere else. It saves a lot
of head-scratching.

## Where to run it, and how to make scenes

On the web, Popkorn plays through canvas or SVG. On mobile, React Native is
supported today through [React Native Skia](https://shopify.github.io/react-native-skia/),
which is what the Skia backend is built on. We'd like to go further with native
players, so Flutter, React Native and everything in between can run Popkorn
more directly and more fully.

Authoring tools are the other big gap. There's no visual editor yet: you write
the CSS by hand, ask an assistant like the playground's Copilot to write it
(see [Prompting with AI](prompting.md)), or convert an existing Lottie or SVG
file (see [Importing](importing.md)). A Figma plugin that exports Figma Motion
animations to Popkorn is planned.

To be straightforward about it: how quickly these arrive depends on whether
people actually use Popkorn. If it finds an audience, native players and better
tooling are the next things to build.

## Scenes, not layout

There's no box model here. `position`, `margin`, `padding`, flexbox and grid
don't exist, and the box-model properties are rejected with a warning. A
Popkorn scene is a scene graph: shapes at explicit coordinates, grouped and
moved with transforms. That's the foundation the whole format sits on, and it
won't change.

A few familiar habits still carry over. `left` and `top` work as aliases for
`x` and `y` (`right` and `bottom` don't, since there's no containing box to
measure from). `border: <w> solid <c>` becomes `stroke-width` plus `stroke`.
And padding is just arithmetic on the child's coordinates.

## Every layer is a real node

There's no `::before` or `::after`. A pseudo-element selector is a parse error,
and there are no `content` boxes to decorate. Instead, give each of those
layers its own named child shape. It tends to read better anyway: the notch,
the speaker and the camera each get a name instead of hiding inside one
selector.

## Shapes and shadows

`border-radius` takes a single value, the two-to-four value per-corner form,
or the four `border-*-radius` longhands. Every corner is circular, though, so
the eight-value elliptical form (`10px / 20px`) is rejected. For an elliptical
corner, draw a `path`: it's one arc or quadratic curve.

`box-shadow` uses normal CSS syntax: offsets, blur, spread, color, `inset` and
comma-separated lists, all animatable. Spread only takes effect on `rect`,
`circle` and `ellipse`; on a `path`, `star` or `polygon`, an outer shadow's
spread is ignored. `inset` needs a shape outline to work with, so it's dropped
on text, images and groups. For a spread shadow on free-form geometry, put a
larger copy of the path behind it with `filter: blur(...)`. For an inset ring
on a group, nest a stroked shape inside it.

For shape modifiers, merge-path union works. Subtract and intersect don't, and
neither do the offset-path, zig-zag, pucker and round-corners modifiers, which
matches what shipping Lottie players implement. Bake the result into the
`path` data instead, or express a subtract as an `evenodd` fill or an inverted
mask.

## Colors

Hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklab()`/`oklch()` and named colors
all work. What's missing is color *math*: no `color-mix()`, no relative color
syntax, nothing like Sass `darken()` or `lighten()`.

A whole color can live in a custom property, and it stays live:
`fill: var(--brand)` means a host `setVariable` call recolors the node at
runtime. You can't compute individual channels, though. `input()` gives you
numbers, and `rgb(var(--r), 0, 0)` doesn't resolve its arguments. Gradients
passed through `var()` aren't live either.

The workaround is to precompute derived colors as literals, with a comment to
keep the intent (`/* darken(#272C31, 10%) */`). To change a color over time,
animate `fill` or `stroke` in `@keyframes`: solid colors, gradient stops and
compatible gradients all interpolate, in Oklab whenever either end is an
`oklab()` or `oklch()` color.

## Transforms are 2D

You get `translate`, `rotate`, `scale`, `skew`/`skewX`/`skewY` and `matrix()`,
all animatable. There's no 3D, no `perspective` and no camera. For flips and
tilts, a `scaleX`/`scaleY` animation or a `skew` fakes the depth convincingly.

Angles deserve a note. Transform angles are read as degrees: `rad`, `grad` and
`turn` convert correctly inside the trig functions and `oklch()` hues, but
`rotate(0.5turn)` means half a degree. Stick to `deg` in transforms. Rotation
also interpolates linearly with no shortest-path logic, deliberately, so
`rotate(0deg)` to `rotate(360deg)` gives you a full spin.

## Text moves as one piece

Text supports multi-line content with `\n`, `text-align`, `line-height` and
`letter-spacing`. There are no per-glyph animators, so a text node draws and
animates as a single unit. For per-character motion, use one text node per
character, usually stamped out from a `@define` symbol and staggered with a
negative `animation-delay`.

## Blending and filters

`mix-blend-mode` accepts the full set of CSS keywords, but it applies to each
shape's own paint. A group's blend mode isn't an isolated composite: its
children blend individually, including against each other. Put
`mix-blend-mode` on the shapes that should blend, and where overlapping
children need to blend as one, merge them into a single `path`.

`filter` takes the CSS functions: `blur`, `drop-shadow`, `brightness`,
`contrast`, `saturate`, `grayscale`, `sepia`, `invert`, `opacity` and
`hue-rotate`. SVG filter references (`url(#...)`) aren't supported. A filter
list only animates between keyframes that use the same sequence of functions;
if they don't match, the value holds instead of interpolating, so keep the
lists the same shape and use `blur(0px)` as a placeholder.

On the React Native/Skia backend, filters currently draw unfiltered. That
includes outer `box-shadow`s without spread, which go through the same path.
If a shadow has to show up on Skia, use a spread shadow on a basic shape, or a
blurred copy of the shape.

## No scripting, by design

There are no JS expressions in the format, and that's intentional. Reactivity
is declarative: `var()`/`input()` bindings, `calc()` and the math functions,
`transition`, and `@machine` state machines. When something outgrows those,
the plan is a richer binding vocabulary rather than an embedded script engine.

## Small grammar differences

A few CSS habits don't parse. `//` line comments are a parse error, so use
`/* */`. Exponent notation like `1e2` isn't a number. The supported units are
`px`, `em`, `rem`, `%`, `s`, `ms`, and the angles `deg`, `rad`, `grad` and
`turn`; there's no `vw`, `vh` or `pt`. `em` and `rem` parse, but they have no
font-relative effect, and the parser warns when you use them.

## What might change

The box model, scripting and 3D are settled: they're part of what makes
Popkorn what it is. Per-glyph text animation and group-isolated blending are
gaps that could close as real scenes need them. Native players and authoring
tools, including the Figma plugin, are on the roadmap, and adoption is what
moves them forward. If you need one of these today, the workarounds above get
you most of the way.
