# Popcorn Format Reference

The complete reference for the Popcorn format. See the [README](../README.md) for setup and usage.

### Canvas Configuration

Canvas size and background go in the `:root` rule (the same rule that holds
`--variables`):

```css
:root {
  width: 800px;
  height: 600px;
  background: #1a1a2e;
}
```

### Selectors & Values

Selectors are `#id`, `.class`, or `:root` — any other `:pseudo` selector at the
top level is a parse error. Lengths accept `px`, `em`, `rem`, `%`, and the time
units `s` / `ms`, plus `deg` for angles; many properties also take a bare number
(fractions for `trim-*`/`offset-distance`, milliseconds for `time-*`/`visible-*`,
counts for `sides`). Hex colors accept 3–8 digits (`#rgb` … `#rrggbbaa`), and
`rgb()`/`rgba()` work for both solid colors and gradient stops. Block comments
(`/* … */`) and a trailing `;` before `}` are allowed.

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

/* Path — arbitrary SVG geometry */
#path {
  type: path;
  d: 'M10 10 L50 50 L10 50 Z';
  fill: none;
  stroke: #fff;
  stroke-width: 2px;
}
```

`type: path` takes an SVG `d` string supporting the commands `M L H V C S Q T A Z`
(absolute and relative), including smooth-curve reflection (`S`/`T`) and true
elliptical arcs (`A`); a degenerate arc collapses to a straight line.

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
  sides: 5;              /* number of star points (static) */
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
  type: polygon;         /* `sides` vertices on the outer radius, no inner */
  sides: 6;
  outer-radius: 70px;
  cx: 160px;
  cy: 150px;
  fill: #4ecdc4;
}
```

`outer-radius`, `inner-radius`, `rotation`, `cx` and `cy` are animatable and
bindable; `sides` is static. `outer-roundness`/`inner-roundness` are Lottie's
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

The individual CSS transform properties `translate:`, `rotate:`, and `scale:`
also work and write the **same** channels as `transform:` — so
`translate: 100px 50px` equals `transform: translate(100px, 50px)`. Mixing them
with `transform:` on one node is last-declaration-wins per channel (not CSS's
additive layering).

`transform-origin` sets the pivot for rotation and scale (default `0 0`).
Accepts the keywords `center`/`top`/`left`/`right`/`bottom`, percentages, or
lengths; a single value fills the other axis with `50%`.

```css
#spinner {
  type: rect;
  x: -40px; y: -40px; width: 80px; height: 80px;
  transform-origin: center;        /* rotate about the middle, not the corner */
  animation: spin 2s linear infinite;
}
```

### Gradient Fills

`fill` and `stroke` accept CSS gradients. Color stops are hex or `rgb()`/`rgba()`
(as are solid `fill`/`stroke` colors). Omitting a stop's percentage
auto-distributes it evenly; a `linear-gradient` with no angle defaults to
`to bottom` (180deg).

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

A `linear-gradient` may instead give explicit `from`/`to` endpoints, and a
`radial-gradient` an explicit center/`radius` and a `focal` highlight point
(Lottie's highlight offset), rather than the bbox-derived defaults.

A gradient `fill`/`stroke` is animatable in `@keyframes`: each stop's offset and
color are interpolated, along with the linear angle and the radial
radius/center/focal. The two endpoints must be *compatible* — same gradient
type, same stop count, and the same explicit-geometry presence (both or neither
specify `from`/`to`, both or neither `at`/`focal`) — so stops pair up
index-for-index. Incompatible gradients step (hold the departing value) instead
of interpolating.

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
  /* clip-path: inset(20px);                     inset(<t r b l> | <tb lr> | <t> <r> <b> <l>) */
  /* clip-path: path('M0 0 L200 0 L100 200 Z');  arbitrary SVG path */
}
```

`inset()` takes 1, 2, or 4 lengths (CSS shorthand: 1 → all sides, 2 →
top-bottom / left-right, 4 → top right bottom left).

Multiple `path()` values are unioned into one clip region (a point inside **any**
of them is kept) — this maps Lottie's additive multi-mask:

```css
#masked {
  type: group;
  clip-path: path('M0 0 L60 0 L60 60 Z') path('M80 80 L140 80 L140 140 Z');
}
```

`clip-path` is animatable in `@keyframes`, but only the `path()` form morphs
(same command-sequence compatibility rule as `d`); `circle()`/`inset()` clips
can't be tweened.

### Track Mattes

`mask` masks a node by another node's **alpha** or **luminance**. The matte
source is referenced by id (it can live anywhere in the scene) and is *not*
painted on its own — only sampled as the matte:

```css
#reveal {
  type: text;
  content: "POPCORN";
  mask: #wipe luminance;   /* alpha | alpha-invert | luminance | luminance-invert */
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
- `luminance` keeps it where the source is bright; `luminance-invert` where it's dark.
- Given only an id, the mode defaults to `alpha`.

Compositing is done offscreen, so both subtrees line up exactly regardless of
their transforms. (Headless/no-canvas environments skip the matte and draw the
content directly.) A `luminance` matte silently degrades to `alpha` if the
source canvas is tainted by a cross-origin image (pixel readback is blocked).

### Filters

`filter` applies CSS filter functions to a node and its subtree. Two functions
are supported — CSS `blur()` is Gaussian by spec, so nothing needs inventing:

```css
#glow {
  type: circle;
  cx: 100px; cy: 100px; r: 40px;
  fill: #ffcc00;
  filter: blur(12px);
}

#card {
  type: group;
  /* Multiple functions compose left-to-right, CSS grammar; color is optional
     on drop-shadow (defaults to black). */
  filter: blur(2px) drop-shadow(4px 6px 8px rgba(0, 0, 0, 0.4));
}
```

- `blur(<length>)` — Gaussian blur; the radius is the `stdDeviation`.
- `drop-shadow(<dx> <dy> <blur>? <color>?)` — offset, blur radius, and color
  (color optional, defaults to black).

Filter lengths are authored in the node's **local** space and **scale with the
node's transform** — a scaled-up element's blur scales too, matching CSS. On a
node with children the subtree is composited offscreen and blitted back through
the filter; a leaf shape is filtered the same way. The blur **radius is
animatable** in `@keyframes` (`filter: blur(...)`); drop-shadow is static.
Renderers without filter support (e.g. old Safari) skip filters and draw
unfiltered (warned once).

### Images

`type: image` draws a bitmap from a URL or `data:` URI into an x/y/width/height
box. Omit width/height to use the image's natural size once it loads. The source
can be given as `src:` or as `content: url('…')`.

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
strokeable node (`path`, `circle`, `ellipse`, `rect`, `star`, `polygon`). The trims are percentages
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

`trim-start >= trim-end` hides the stroke entirely. The trim properties accept a
bare number as a `0..1` fraction as well as a percentage; values clamp to range.

### Stroke Dashes

`stroke-dasharray` sets a repeating dash/gap pattern (in local units, like SVG);
`stroke-dashoffset` shifts the pattern along the stroke and is animatable.

```css
#dashed {
  type: polygon;
  sides: 3;
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

Other stroke properties:

- `stroke-linejoin` — corner join: `miter` (default), `round`, or `bevel`.
- `stroke-miterlimit` — miter cap ratio, default `4` (SVG/Lottie, not Canvas's
  10); only affects miter joins.
- `paint-order: stroke` — draw the stroke *behind* the fill (so only its outer
  edge shows). Default `normal` is fill first, stroke on top.

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

The Lottie converter (`packages/popcorn-converters/src/lottie2popcorn.ts`) leans on this for **union-only
merge paths**: Lottie merge modes 1/2 (normal/add) become a single `nonzero`
path with one subpath per merged shape (a Canvas2D union of fills). Modes 3/4/5
(subtract/intersect/exclude) stay blocked. Fills union exactly; a **stroke** on a
merged path shows interior seams (subpath outlines aren't booleaned away).

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

Animation shorthand: `name duration timing-function iteration-count direction fill-mode delay`
(tokens are matched by type, so order is flexible; of two time values the first
is duration and the second is delay). Duration defaults to `1s`. A **bare
number** in the shorthand is read as iteration-count only when it's a positive
integer below 100 — for any other count use the `animation-iteration-count`
longhand. Multiple animations can be comma-separated in one declaration
(`animation: spin 2s linear infinite, fade 1s ease`).

```css
#shape {
  animation: spin 2s linear infinite;
  animation: pulse 1s ease-in-out infinite alternate;
  animation: fadeIn 0.5s ease-out 1 normal 0.2s;
}
```

`animation-direction` is `normal` (default), `reverse`, `alternate`, or
`alternate-reverse`.

**Fill mode.** `animation-fill-mode` is `none`, `forwards`, `backwards`, or
`both`, and it **defaults to `forwards`** (unlike CSS's `none`) so a finished
animation holds its final frame rather than snapping back to base.
`backwards`/`both` also hold the first keyframe during the start `delay`.

**Composition.** `animation-composition` is `replace` (default), `add`, or
`accumulate`. With `add`/`accumulate`, numeric channels are *added* onto what
base + bindings + earlier animations already wrote this frame (an omitted
property contributes 0, not the base value); color/gradient/path channels always
replace. It is a longhand only — the `animation` shorthand resets it to
`replace`.

Timing functions: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`,
`cubic-bezier(x1, y1, x2, y2)`, `steps(n, <position>)`, `linear(<stops>)`,
`step-start`, and `step-end` — a step/hold that keeps the departing keyframe's
value until the next keyframe, then jumps. `steps()` positions are
`jump-start`/`start`, `jump-end`/`end` (default), `jump-none`, and `jump-both`.
`linear()` (CSS Easing L2) is *not* clamped, so control points above 1 give
spring/overshoot curves.
Any of these works as the shorthand default easing or per-keyframe via
`animation-timing-function`:

```css
@keyframes blink {
  0%   { opacity: 1; animation-timing-function: step-end; }
  50%  { opacity: 0; animation-timing-function: step-end; }
  100% { opacity: 1; }
}
```

Keyframe blocks need not be authored in ascending order (they're sorted), and a
property holds flat outside the range it defines — below the first keyframe or
above the last, its value is that boundary keyframe (no extrapolation).

A path's `d` is animatable — **path morphing**. The two keyframe paths must be
*compatible*: the same command sequence (same letters in the same order, same
counts) after parsing, so their numeric arguments interpolate pairwise.
Incompatible sequences step (hold the departing path) instead of morphing.
Arc (`A`) boolean flags don't interpolate — they step to the departing value.
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

### Time Scoping

`time-offset` and `time-scale` retime a node **and its whole subtree** — the
node's own animations plus every descendant's. They rewrite the local timeline
to `(t - time-offset) * time-scale`, so all timing downstream (delays,
iterations, fill modes, motion-path distance) just follows along.

```css
#slow-mo {
  type: group;
  time-scale: 0.5;        /* this subtree runs at half speed */
  time-offset: 2s;        /* ...and starts 2s later on the parent timeline */
  > #a { type: circle; r: 10px; animation: pulse 1s ease-in-out infinite; }
}
```

- `time-offset: <time>` — delay the subtree's timeline (`s` / `ms`), default `0`.
- `time-scale: <number>` — playback rate; `0.5` is half speed, `2` is double.
  Must be `> 0` (invalid values warn and fall back to `1`), default `1`.

Both are static (not animatable). Nested scopes compose — each applies to the
local time it inherits — which is how imported compositions (Lottie precomps,
with per-instance start time and stretch) keep independent clocks.

`time-remap` maps inherited time through an explicit curve instead of a linear
offset/scale (Lottie `tm` — the converter emits it for precomp time remapping).
It's a comma list of stops, each `<input-time> <output-time> [easing]` (times in
`s`/`ms`, easing governs the segment to the next stop); outside the input domain
the endpoints hold. When present it **replaces** `time-offset`/`time-scale`.

```css
#clip {
  type: group;
  time-remap: 0s 0s, 1s 2s ease-out, 2s 0s;   /* play forward then rewind */
}
```

### Layering & Visibility

By default siblings paint in document order (first child behind, last in front).
`z-index` overrides that: siblings paint in **ascending** z-index, with document
order breaking ties, and hit-testing uses the same order. Negative values are
valid — and the main use — for painting a nested child *behind* its parent's
other children. Groups have no geometry of their own, so parent-vs-child
layering reduces to sibling ordering. Static, integer, default `0`.

`visible-from` / `visible-until` window a node (and its subtree) to a time range
(`s` / `ms`), evaluated against the time the node *inherits* — i.e. the
containing (parent) scope's timeline, before the node's own `time-offset` /
`time-scale` apply — so visibility lives in the parent comp's clock, matching
Lottie layer `ip`/`op`. Outside `[from, until)` the node is
skipped by both the render walk and hit-testing — nothing to paint, nothing to
hover. This is how imported layers with a shorter life than the composition
(sticker exports that swap a layer in per time slice) appear and disappear
without an opacity hack. Static; defaults are "always visible".

```css
#torso {
  type: group;
  > #chest { type: path; d: '...'; }
  > #back-arm { type: path; d: '...'; z-index: -1; }   /* behind the chest */
  > #spark  { type: circle; r: 4px; visible-from: 2s; visible-until: 4s; }
}
```

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

Available inputs (mouse only — no touch, despite the `cursor` name):
- `cursor.x`, `cursor.y` - Pointer position in **scene coordinates** (mapped back
  through the inverse viewport, so bindings stay correct under any fit/DPR)
- `cursor.isDown` - Mouse button state (1 or 0)
- `scroll.x`, `scroll.y` - Scroll position (`window.scrollX`/`scrollY`)
- `time` - Monotonic clock timestamp in milliseconds (`performance.now()`)

Notes on bindings:

- Live `input()`/`var()` bindings drive **numeric** properties only. Color,
  gradient, and path (`d`, `clip-path`) bindings resolve once statically — a
  color can't be wired to a live input.
- An unknown `var(--x)` or `input()` path resolves to `0` (no error). Custom
  properties can reference other custom properties (resolved recursively).
- The CSS `var(--x, fallback)` two-argument form is **not** parsed — give the
  fallback by defining the variable in `:root` instead.

### States, Transitions & Hit-Testing

Nodes respond to pointer state with `&:hover` / `&:active` blocks inside the
rule body (also valid in an `@define`). A state block restyles the node while
it's in that state, and may contain `> #child { … }` rules that restyle a direct
descendant while the *parent* is in the state. State blocks can't nest further
states.

```css
#button {
  type: rect;
  x: 0; y: 0; width: 160px; height: 48px; rx: 8px;
  fill: #4ecdc4;
  transition: fill 0.2s ease-out;   /* tween into/out of the state */

  &:hover { fill: #60a5fa; }
  &:active {
    fill: #a855f7;
    > #label { fill: #ffffff; }      /* restyle a child while pressed */
  }
}
```

- State blocks only set a fixed subset: `fill`, `stroke`, `stroke-width`,
  `opacity`, `transform` (and the individual `translate`/`rotate`/`scale`).
- The parser accepts any `&:<ident>`, but only `hover` and `active` are driven;
  other state names parse but never activate.

**Transitions** tween a node between values when it changes state. Shorthand:
`transition: <property> <duration> [easing] [delay]`, where `<property>` is one
of `all` (default), `fill`, `stroke`, `stroke-width`, `opacity`, `transform`. A
zero-duration transition is an instant change. A transition declared *inside* a
state block overrides the node-level transition when entering that state
(asymmetric enter/exit timing).

**Hit-testing** decides what a pointer hits (for `&:hover`/`&:active`):

- Testing uses the **fill region** (`fill-rule` respected), so a `fill: none`
  stroke-only shape is still hittable across the area it encloses. Text and
  image nodes hit-test as their bounding box.
- Hits bubble like the DOM: an interactive group is hit whenever any descendant
  contains the point; the nearest interactive ancestor-or-self is credited, so a
  directly-interactive child still wins inside its own geometry.
- Groups have no geometry of their own — a group only becomes a target via a
  bubbled descendant hit. A node's `clip-path` also clips hit-testing, and mask
  sources aren't hittable.
- `pointer-events: none` removes a node **and its whole subtree** from
  hit-testing; unlike CSS, a descendant can't opt back in.

### State Machines

`&:hover`/`&:active` restyle a node while a pointer is on it; a `@machine` adds
named states that **outlive the pointer** and can start animations — toggles,
"intro once then loop", tap-driven reactions, app-state-driven styling. Multiple
`@machine` blocks run concurrently and independently.

A scene with a `@machine` has **no duration**: it never ends or loops as a clip
(the player's `loop` attribute is inert, the clock runs forward monotonically),
because machine state lives off the timeline. Per-state animations either loop
(`infinite`) or run once and hold their final frame while the state stays active
— so a `:state()` animation defaults to `animation-fill-mode: both` (hold the
start frame before its delay, the end frame after completion) instead of the
node-level `forwards`; write an explicit fill mode to override.

```css
@machine cat {
  initial: idle;                            /* required starting state */

  state idle {
    to: excited on click(#hitbox);
    to: hyper when style(--energy > 80);
  }
  state excited {
    to: idle on complete;                   /* this state's animations finished */
  }
  state hyper {
    to: idle when style(--energy <= 80);
    emit: overheat;                         /* event out to host, fired on entry */
  }
  state * {                                 /* any-state: checked before current */
    to: idle on event(reset);
  }
}
```

**Transitions** — one or more `to:` per state:

```
to: <state> [on <trigger>] [when <guard> [and <guard>]*];
```

Declaration order is priority: the first `to:` whose trigger and guards all pass
fires. `on` and `when` may combine (event AND condition); guards chain with `and`
only.

**Triggers (`on …`):**

| Trigger | Meaning |
|---|---|
| `click(#id)` `pointerdown(#id)` `pointerup(#id)` `hoverstart(#id)` `hoverend(#id)` | pointer event on a named node (the existing hit-tester) |
| `click(:root)` etc. | same events on the whole scene (tap anywhere) |
| `complete` | the current state's animations finished (non-infinite) |
| `event(name)` | a named external event fired by the host — see host API |

Pointer and `complete` triggers need zero host code. `event()` is the escape
hatch for signals the player can't see itself (app logic, sensors).

**Guards (`when …`):** container-style-query syntax with range comparisons, over
custom properties and `input()` paths:

```css
when style(--energy > 80)
when style(--mood: happy)              /* equality, CSS style() form */
when style(input(cursor.x) < 400)
when style(state-time > 2s)            /* time in current state → timeouts */
```

`state-time` is a reserved per-machine input measuring time in the current state.

`mix <duration> [<easing>]` parses on a `to:` but currently applies as a **hard
cut** (tweened state cross-fade is not yet wired). Environment `media.*` inputs
(`media.prefers-reduced-motion`, `media.hover`, `media.width`, `media.height`)
work in guards and anywhere `input()` is read.

**State styling: `:state()`** — while machine `M` is in state `S`, `#node:state(S)`
matches (namespace as `:state(M.S)` when two machines share a state name). These
are full rules — crucially including `animation:`, which **(re)starts from the
state's entry time on entry** — and may carry `> #child { … }` rules that restyle
a direct descendant. `:hover`/`:active` keep working and still apply last.

```css
#cat:state(idle)    { animation: breathe 2s ease-in-out infinite; }
#cat:state(excited) { animation: jump 600ms ease-out; }   /* restarts on entry */
#cat:state(hyper)   { animation: vibrate 100ms infinite; fill: #f44;
                      > #eyes { fill: #fff; } }
```

**Trigger variables.** A custom property initialized to the keyword `trigger` is a
momentary event input that auto-resets after one evaluation:

```css
:root {
  --energy: 0;         /* number  */
  --pressed: false;    /* boolean */
  --tap: trigger;      /* momentary; fire() then it clears */
}
```

**Host API** on `<popcorn-player>`:

```js
player.setVariable('--energy', 80);   // number/boolean author-declared vars
player.getVariable('--energy');
player.fire('--tap');                 // pulse a trigger variable
player.fire('reset');                 // deliver an `on event(reset)` trigger
```

The player dispatches two `CustomEvent`s: `statechange` on every transition
(`detail: {machine, from, to}`) and `machine-event` when a state's `emit:` fires
(`detail: {machine, name}`).

```js
player.addEventListener('statechange', (e) => console.log(e.detail.from, '→', e.detail.to));
player.addEventListener('machine-event', (e) => console.log(e.detail.name));
```

### Scrubbing (`animation-timeline`)

`animation-timeline` scrubs an animation to a 0..1 value source instead of playing
it on the clock. It accepts the same `var()`/`input()` vocabulary used everywhere
else:

```css
#progress-bar {
  animation: fill-up 1s linear;
  animation-timeline: var(--progress);          /* host-fed 0..1 */
}
#hero {
  animation: reveal 1s ease-out;
  animation-timeline: input(scroll.progress);   /* page scroll, normalized 0..1 */
}
```

`scroll.progress` is a built-in input: scroll position normalized to 0..1 by the
scrollable range (the raw offset stays available as `scroll.y`).

## Importing SVG

Alongside the Lottie converter, `packages/popcorn-converters/src/svg2popcorn.ts` (CLI:
`packages/popcorn-converters/src/cli.ts`, or the demo's **Import** button) turns a static SVG
into a Popcorn scene. The mapping is the natural one:

- `<rect>`/`<circle>`/`<ellipse>`/`<line>`/`<polyline>`/`<polygon>`/`<path>` →
  the matching Popcorn shapes; `<g>` → a group.
- `fill`/`stroke`/`stroke-width`/`stroke-linecap`/`stroke-linejoin`/
  `stroke-dasharray`/`fill-rule`/`opacity` → their Popcorn equivalents.
- `<linearGradient>`/`<radialGradient>` (incl. `objectBoundingBox` units,
  `gradientTransform`, and `stop-opacity`) → Popcorn gradient fills.
- `transform` (`matrix`/`translate`/`rotate(a cx cy)`/`scale`/`skewX`/`skewY`)
  is decomposed onto each node's `transform`; shear bakes into geometry.
- `<clipPath>` and luminance `<mask>` → Popcorn clip/mask.

**Animation imports too** — CSS `@keyframes` from `<style>` blocks and basic
SMIL `<animate>`/`<animateTransform>` map into Popcorn `@keyframes` +
`animation-*` (opacity/fill/stroke/transform/dash channels). Unmappable cases
degrade to a warning: `@media`-wrapped keyframes, gradient keyframes, `<set>`,
`<animateMotion>`, event/sync-base begins, additive/accumulate, and skew.
Deliberately skipped, matching the Lottie skips: `<pattern>`, `<marker>`,
`<foreignObject>`, and `<textPath>`.
