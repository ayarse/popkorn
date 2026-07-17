# Popkorn Format Reference

<!-- repo-only -->

Source-verified against `packages/popkorn-parser/src/parser.ts` (parser),
`packages/popkorn-player/src/scene/builder.ts` (semantics), the animation/runtime
modules, and `examples/*.css`.

<!-- /repo-only -->

The parser is **generic** — it accepts any `property: value`. Meaning is assigned
downstream by the scene builder, so an unrecognized property parses fine and is
**silently ignored** at build time.

<!-- repo-only -->

Pipeline: `source → parse() → StyleSheet AST → buildSceneGraph() → SceneNode tree → RenderLoop → Canvas2DRenderer`.

<!-- /repo-only -->

---

## 1. Top-level structure

A document is a flat list of three constructs, in any order:

- `@keyframes name { … }` — animation timelines
- `@define name { … }` — reusable symbol definitions
- Rules — `selector { … }`, where one selector is special/hoisted: `:root` (stage config + globals)

### Stage config & root variables

```css
:root {
  width: 800px; /* default 800 — numeric value only, unit ignored */
  height: 600px; /* default 600 */
  background: #0f0f23; /* only a hex/color VALUE is captured here */
  overflow: hidden; /* default — crop content to the stage box */
  --brand: #e94560; /* custom properties live here too */
  --cursor-x: input(cursor.x);
}
```

`:root` holds both stage config (`width`/`height`/`background`/`overflow`) and global custom properties.
Defaults `800×600`, no background. Only a color-typed value sets `background`. If `:root` declares
no `width`/`height`, `<popkorn-player>` falls back to its own `width`/`height` attributes (defaults
400×300). Only `--`-prefixed declarations become global variables (see §10, §14).

**Artboard clipping.** Content is cropped to the `width`×`height` box by default (`overflow: hidden`,
like an AE comp / Lottie player) — draws past the edge are clipped and pointers outside the box miss.
Use `overflow: visible` for scenes whose content is meant to sit _outside_ the stage at rest (content
merely flying in/out from off-stage during an animation does NOT need it — the clip only crops the
resting frame). Clipping is skipped when the scene has no declared `width`/`height`.

---

## 2. Selectors, nesting, grouping

| Syntax       | Meaning                                     |
| ------------ | ------------------------------------------- |
| `#id { }`    | Node with id (`node.id`)                    |
| `.class { }` | Node with class (`node.className`; id auto) |
| `:root { }`  | Stage config + global variables (hoisted)   |

**No element/type selectors, no combinators.** A node's shape is set by a `type:` _declaration_, not the selector.

**Nesting** uses `>` as a prefix inside a rule body, followed by a full child rule:

```css
#group {
  type: group;
  transform: translate(400px, 300px);
  > #child {
    type: rect;
    width: 100px;
    height: 100px;
    fill: #4ecdc4;
  }
}
```

**Pseudo-states** use `&:` inside a rule body (only `hover`/`active` are meaningful — see §14):

```css
#btn {
  type: circle;
  r: 30px;
  fill: #e94560;
  &:hover {
    fill: #ff6b8a;
    transform: scale(1.2);
  }
  &:active {
    fill: #c73e54;
    transform: scale(0.9);
  }
}
```

---

## 3. Value types, units, colors

### Value forms

Values are lengths (`10px`), plain numbers (`0.5`), colors (`#e94560`),
keywords (`red`, `center`), strings (`"Hello"`), functions (`rgb(…)`,
`cubic-bezier(…)`, `input(…)`), and `var(--x)` references. Space-separated
values in one declaration form a **list** (e.g. `pulse 1.5s ease-in-out
infinite`); a single value is used directly. Numeric values also take `calc()`
and CSS math functions — comparison `min()`, `max()`, `clamp(MIN, VAL, MAX)`;
stepped/sign `round([<strategy>,] VAL[, STEP])` (strategy is `nearest`
(default), `up`, `down`, or `to-zero`; step defaults to `1`), `mod(A, B)`
(sign of `B`), `rem(A, B)` (sign of `A`), `abs(X)`, `sign(X)`; trig `sin()`,
`cos()`, `tan()`, `asin()`, `acos()`, `atan()`, `atan2(Y, X)`; exponential
`pow(BASE, EXP)`, `sqrt()`, `hypot(...)`, `log(X[, BASE])`, `exp()` — each arg
is a full `calc()` expr, they nest with `calc()`, and reactive operands
(`var()`/`input()`) re-evaluate per frame.

### `var()` is typed; `input()` is numeric-only

A `:root` custom property carries **whatever type its value is** — number,
color, or string — and `var(--x)` re-resolves that live at render time
wherever it's used, not just on numeric props:

```css
:root {
  --brand: #e94560; /* color */
  --label: "Score"; /* string */
  --radius: 30px; /* number */
}
#chip { fill: var(--brand); }
#title { content: var(--label); }
#dot { r: var(--radius); }
```

- Numeric `var()` **interpolates** through `@keyframes` like any other number.
- Color `var()` **snaps** (no in-between blend) since the binding re-resolves
  outside the color-lerp path.
- String `var()` (driving `content`, `font-family`, and other keyword props)
  is **discrete** — it swaps, never interpolates — and re-resolves whenever
  the host calls `setVariable`.
- `input(...)` stays **numeric only** (`cursor.x`, `scroll.progress`, etc.) —
  there's no color/string input source.
- A `:root` var used in a **structural** prop (`d`, `offset-path`,
  `clip-path`, `mask`) is folded to its literal value once at build time
  instead of staying a live binding — those props need real geometry to
  build the scene graph, not a per-frame swap.

### `random()` — fixed random constants

`random()` (CSS Values 5) draws a value once and **freezes it** — it is a random
*constant*, not a live noise source. It is rolled at build time and baked into
the node's base snapshot, so it never re-evaluates per frame and the timeline
stays pure (`seek(t)` twice is identical). Use it to scatter particles, jitter
start phases, or vary sizes without hand-writing every value.

Grammar (adopt it verbatim — nothing else to learn):

```
random( [ per-element || <dashed-ident> ]? , <min> , <max> [ , by <step> ]? )
```

```css
#a  { r: random(10px, 100px); }                      /* one roll, carries px       */
#p  { cx: random(per-element, -1, 1); }              /* each element rolls its own  */
#q  { rotate: random(--k, 0deg, 360deg); }           /* ident: correlate by key     */
#g  { x: random(per-element, 0px, 100px, by 20px); } /* quantized: 0/20/…/100       */
```

- The result **carries the unit of `min`/`max`** (which must be compatible); a
  unitless range gives a plain number. `by <step>` snaps the result to
  `min + n·step`, clamped `≤ max`.
- It works **anywhere a number or `calc()` operand is accepted** (it is
  calc-compatible), but not as a color or string.

**Sharing — who shares a roll:**

- **Default** (no `per-element`, no ident): the SAME roll for every element the
  declaration applies to — e.g. 150 `use:` instances of one `@define` all get
  one value.
- **`per-element`**: each element/instance rolls independently (the
  particle-scatter knob). Keyed by the node `#id`, not tree position.
- **`<dashed-ident>`** (e.g. `--k`): calls sharing the same ident + range share
  the roll, so you can correlate two properties or share across selectors.
  Combines with `per-element` (`random(per-element --k, …)`) → shared per element.

**Deterministic, not wall-clock:** the roll is seeded from a hash of the source
plus a call-site key (and the node id for `per-element`). Re-parsing the
identical source yields the identical frame, so hot-reloading an unchanged file
never reshuffles. Editing an unrelated part of the file *may* reshuffle every
roll — that's expected; only same-source stability is guaranteed. (Crushing or
minifying counts as an edit here: it renames ids and rewrites the text, so
random rolls — `per-element` ones especially, since they key on the `#id` — can
land differently than in the un-crushed source.)

**Idiom — desynced motion with `sin()` + `random()`:** because the random is
frozen, adding it as a per-element phase offset gives each element its own,
stable phase while the animation still runs live:

```css
/* Each instance bobs on the same clock but out of phase with its neighbours. */
#bubble {
  translate: 0 calc(sin(var(--t) + random(per-element, 0, 6.3)) * 20px);
}
```

### Units

`px`, `deg`, `em`, `rem`, `ms`, `s`, `%` (longest-match: `ms` before `s`, `rem` before `em`).
**No `pt`, `vw`, `vh`, `turn`, `fr`.** A number with no unit is a `number`, not a `length`.
Number grammar `-?[0-9]+(\.[0-9]+)?` — **no exponents, no leading-dot** (`.5` invalid → `0.5`).

### Colors

- **Hex only** is a true color value: `#rgb`, `#rrggbb`, `#rrggbbaa`.
- `rgb()`/`rgba()`/`hsl()` parse as generic functions; the builder rebuilds `rgb()`/`rgba()` to CSS strings (unknown color fn → `#000000`).
- **Named colors** (`red`) parse as keywords, passed straight to canvas — any CSS named color works for fill/stroke.
- `#name` (non-hex) → keyword keeping `#`, used for node refs like `mask: #layer alpha` (builder strips `#`).

### Comments & semicolons

`/* block */` only — **no `//` line comments.** Trailing semicolons optional.

---

## 4. Node / shape types

Set with `type: <keyword>`. Omitted → **`group`**. Read in a first pass, so declaration order doesn't matter.

| `type:`           | Geometry props                                                                                        | Per-type defaults                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `group` (default) | —                                                                                                     | container only                                 |
| `rect`            | `x`, `y`, `width`, `height`, `rx`, `ry`                                                               | all `0`                                        |
| `circle`          | `cx`, `cy`, `r`                                                                                       | all `0`                                        |
| `ellipse`         | `cx`, `cy`, `rx`, `ry`                                                                                | all `0`                                        |
| `path`            | `d` (SVG path)                                                                                        | `d: ''`                                        |
| `star`            | `sides`, `outer-radius`, `inner-radius`, `outer-roundness`, `inner-roundness`, `rotation`, `cx`, `cy` | `sides: 5`, radii/roundness `0`, `rotation: 0` |
| `polygon`         | `sides`, `outer-radius`, `outer-roundness`, `rotation`, `cx`, `cy`                                    | same                                           |
| `text`            | see §6                                                                                                |                                                |
| `image`           | see §7                                                                                                |                                                |

- `rect` renders rounded corners when `rx>0` or `ry>0`.
- `path` commands: `M L H V C S Q T A Z` (absolute + relative).
- `star` vs `polygon`: polygon ignores `inner-radius`/`inner-roundness`. Vertex count is `sides` (**not `points`**), floored, min 2. Star vertices start at −90° + `rotation` (0 points up). `*-roundness` are percentages; 0 = straight edges.
- Geometry props are **type-gated**: mismatched props (`r` on a rect) are silently ignored.

**`border-radius` (rect only) — CSS 1–4 value shorthand:**

```css
#uniform { type: rect; width: 200px; height: 100px; border-radius: 12px; }        /* -> rx: 12px; ry: 12px */
#corners { type: rect; width: 200px; height: 100px; border-radius: 0 12px 24px 4px; } /* -> tl 0, tr 12px, br 24px, bl 4px */
```

- **1 value** → uniform `rx`/`ry` (back-compat with the native rounded-rect path).
- **2–4 values** → CSS corner order `[top-left, top-right, bottom-right, bottom-left]`, missing values fill from the CSS shorthand rule (2 → `[tl, tr, tl, tr]`, 3 → `[tl, tr, br, tr]`). Expands to the longhands `border-top-left-radius`/`border-top-right-radius`/`border-bottom-right-radius`/`border-bottom-left-radius`, each independently **animatable**.
- **No elliptical slash form** (`10px / 20px`) — corners are always circular; a slash value warns and is dropped (use `type: path` for a custom outline).

---

## 5. Visual / style properties

| Property                                  | Values                                                                               | Default                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| `fill`                                    | hex, `rgb()`/`rgba()`, `linear-gradient()`, `radial-gradient()`, named color, `none` | `none`                                    |
| `stroke`                                  | same as fill                                                                         | `none`                                    |
| `stroke-width`                            | number                                                                               | `1`                                       |
| `stroke-linecap`                          | `butt` \| `round` \| `square`                                                        | `butt`                                    |
| `stroke-linejoin`                         | `miter` \| `round` \| `bevel`                                                        | `miter`                                   |
| `stroke-miterlimit`                       | number (only used when join is `miter`)                                              | `4` (SVG/Lottie default, not Canvas's 10) |
| `stroke-dasharray`                        | space-separated lengths                                                              | `[]` (solid)                              |
| `stroke-dashoffset`                       | number                                                                               | `0`                                       |
| `fill-rule`                               | `nonzero` \| `evenodd`                                                               | `nonzero`                                 |
| `opacity`                                 | fraction                                                                             | `1`                                       |
| `trim-start` / `trim-end` / `trim-offset` | `%`→fraction, clamped 0..1                                                           | `0` / `1` / `0`                           |
| `box-shadow`                              | `[inset] <dx> <dy> [<blur>] [<spread>] [<color>]`, comma-separated                   | none                                      |

### `box-shadow`

```css
#card { box-shadow: 4px 6px 8px rgba(0, 0, 0, 0.4); }              /* outer, blurred */
#card { box-shadow: 0 0 0 4px #fff, 4px 6px 8px rgba(0, 0, 0, 0.4); } /* multi-shadow, first paints on top */
#well { box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5); }            /* inset ring */
```

- Full CSS syntax: `[inset] dx dy [blur] [spread] [color]` (dx/dy required; blur/spread default `0`; color defaults black). Comma-separated for a shadow stack — the **first** listed shadow paints on top, matching CSS.
- Rides the same `filter`/drop-shadow pipeline, so every field is **animatable** in `@keyframes`.
- **Ceiling: `spread` only inflates `rect`/`circle`/`ellipse`** (their outline offsets exactly). On `path`/`star`/`polygon` the shadow falls back to a plain blurred silhouette and `spread` is ignored.
- Inset shadows clip to the shape's real outline (rounded corners included), not just its bounding box.

Gotchas:

- **A stroke only paints if a stroke color is set** — default `stroke-width: 1` alone paints nothing.
- Gradient overrides solid color if both set; a gradient with no stops → no paint.
- Trim affects only the **stroke** (fill always draws full). When a trim window is active, `stroke-dasharray` is ignored. Empty trim window → nothing strokes.
- **`opacity` cascades**: a group's opacity multiplies down onto every descendant (child effective alpha = ancestors' opacities × own). So `opacity` on a group dims the whole subtree. (Caveat: it multiplies per-node, not an offscreen group composite — overlapping children in a translucent group show through each other.)
- Unrecognized enum keywords drop to the default.

### Gradients

```css
fill: linear-gradient(45deg, #e94560, #4ecdc4 60%, #ffe66d);
fill: radial-gradient(#fff, #000 100%);
```

- Linear: optional leading angle (**default 180 = to-bottom**; render convention `0deg = up, 90deg = right`). Stops `color [offset%]`; omitted offsets evenly distributed.
- Radial: centered on bounding box, radius = half box diagonal.

**Explicit geometry** (leading keyword args, before the stops; coordinates in the shape's **local space**, `px`):

```css
fill: linear-gradient(from 0px 0px to 100px 100px, #ff6b6b 0%, #4ecdc4 100%);
fill: radial-gradient(circle 40px at 150px 150px, #fff 0%, #333 100%);
fill: radial-gradient(
  circle 40px at 150px 150px from 140px 140px,
  #fff 0%,
  #333 100%
);
```

- Linear `from <x> <y> to <x> <y>` — exact endpoints instead of an angle.
- Radial `circle <r> at <cx> <cy>` — exact radius + center; optional `from <fx> <fy>` sets a **focal point** (offset inner-circle center, for off-axis highlights).
- Angle/bbox-centered forms remain the fallback when geometry is omitted.

- **Gradient fills/strokes ARE animatable** (§12) when the two keyframe endpoints are _compatible_ — same gradient type and same stop count (stops pair index-for-index; colors, offsets, **and matching geometry fields** interpolate). Incompatible endpoints step (hold departing value).

### Blend modes

```css
#highlight { mix-blend-mode: multiply; }
```

`mix-blend-mode` takes any of the 16 CSS keywords — `normal`, `multiply`, `screen`,
`overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`,
`soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`,
`luminosity` — and maps to all three backends (Canvas2D `globalCompositeOperation`,
SVG `mix-blend-mode` style, Skia paint `BlendMode`), so nothing silently drops.
Blending is **per-shape**, against the whole backdrop already painted — there's
no group isolation (`isolation: isolate`) to scope it to sibling content only.
Static (not animatable). Unrecognized keywords fall back to `normal`.

---

## 6. Text nodes

```css
#label {
  type: text;
  content: "Hello Popkorn";
  x: 400px;
  y: 300px;
  font-size: 40px;
  font-family: sans-serif;
  font-weight: bold;
  text-anchor: middle;
  fill: #ffffff;
}
```

| Property         | Value                                   | Default      |
| ---------------- | ---------------------------------------- | ------------ |
| `content`        | string (`\n`/`\r`/`\t`/`\"`/`\\` unescape) | `''`         |
| `x` / `y`        | anchor x / alphabetic baseline y (of the first line) | `0`          |
| `font-size`      | number (animatable)                     | `16`         |
| `font-family`    | string                                   | `sans-serif` |
| `font-weight`    | keyword (`bold`) or number (`700`)       | `normal`     |
| `text-anchor`    | `start` \| `middle` \| `end`             | `start`      |
| `text-align`     | `left`/`start`, `center`, `right`/`end`  | maps to `text-anchor` |
| `letter-spacing` | number, px (animatable)                  | `0`          |
| `line-height`    | number (× font-size), `px`, or `%`       | font-size    |

Text color uses **`fill`** (and `stroke`), not `color`.  Gradients work.

- `text-align` is sugar for `text-anchor` (`left`/`start` → `start`, `center` → `middle`, `right`/`end` → `end`) — set either one, not both.
- `letter-spacing` is realized on Canvas2D (`ctx.letterSpacing`) and SVG; **it's a no-op on the RN/Skia backend** (pinned divergence).
- `line-height` resolves once against the `font-size` present at that point in the declarations — it doesn't re-resolve if `font-size` animates later.
- **Multi-line**: a `\n` inside a `content` string splits it into multiple lines (each laid out per `line-height`); `\r`, `\t`, `\"`, and `\\` also unescape now.

```css
#caption {
  type: text;
  content: "Line one\nLine two";
  text-align: center;
  letter-spacing: 2px;
  line-height: 1.4;
}
```

---

## 7. Image nodes

```css
#photo {
  type: image;
  content: url("data:image/png;base64,…"); /* or url("https://…") */
  x: 100px;
  y: 100px;
  width: 200px;
  height: 150px;
}
```

| Property           | Value                       | Default |
| ------------------ | --------------------------- | ------- |
| `content`          | `url('<URL or data: URI>')` | `''`    |
| `x` / `y`          | number                      | `0`     |
| `width` / `height` | number                      | `0`     |

Source property is **`content: url(...)`** (the CSS spelling — not `href`/`src`). **No `object-fit`.** `width`/`height` of `0` → natural size. Nothing paints until the image decodes.

---

## 8. Symbols / reusable components

```css
@define star {
  type: circle;
  r: 10px;
  fill: #fbbf24;
  transform-origin: center;
  animation: twinkle 2s ease-in-out infinite;
}

#star1 {
  use: star;
  cx: 250px;
  cy: 320px;
}
#star2 {
  use: star;
  cx: 400px;
  cy: 320px;
  fill: #60a5fa;
} /* fill overrides */
```

- `use:` is a merge directive resolved before build (not a node type).
- **Merge order:** definition declarations first, then use-site (use-site wins on conflicts).
- **Children:** definition children (deep-cloned, ids namespaced `<instance>.<child>`) first, then use-site children.
- A use-site `&:hover`/`&:active` block replaces the definition's for that pseudo.
- Definitions may `use:` other definitions (recursive). Cycles throw `cyclic symbol definition`. Unknown name throws `unknown symbol '…' referenced by use:`.

---

## 9. Compositing — clip-path & masks

### clip-path

```css
clip-path: circle(80 at 200 200);
clip-path: inset(10 20 10 20); /* CSS shorthand: 1/2/4 values */
clip-path: path("M0 0 L100 0 L50 100 Z");
clip-path: path("M…Z") path("M…Z"); /* multi-shape mask: union (nonzero) */
```

`circle(r at x y)`, `inset(t [r b l])` (resolved against bounding box), `path('…')`. A space-separated list of `path()` values unions into one clip region (Lottie mask add-mode). Applied with the node's `fill-rule`. Default: no clip.

### Masks

```css
mask: #maskLayer alpha; /* alpha | alpha-invert | luminance | luminance-invert */
```

- References another node by id (`#id`, `#` stripped). Default mode `alpha`.
- The source node becomes mask-only (never painted on its own).
- Luminance modes convert alpha to luminance (`0.2126R + 0.7152G + 0.0722B`); `*-invert` uses `destination-out` vs `destination-in`.
- Unknown source id throws `mask on '…' references unknown node '#…'`.

### Filters

```css
#glow {
  filter: blur(12px);
}
#card {
  filter: blur(2px) drop-shadow(4px 6px 8px rgba(0, 0, 0, 0.4));
}
```

- Two functions only: `blur(<len>)` and `drop-shadow(<dx> <dy> <blur> <color>)`; applies to the node **and its whole subtree** (a group filters its composited output).
- The blur **radius is animatable** in `@keyframes` (`filter: blur(...)`); drop-shadow is static.
- Renderers without filter support (old Safari) skip filters and draw unfiltered (warned once). Maps to the AE blur/drop-shadow effects the converter emits.

---

## 10. Transforms & motion paths

### transform

```css
transform: translate(400px, 300px) rotate(45deg) scale(1.2);
```

Supported: `translate(x[,y])`, `translateX`, `translateY`, `rotate(deg)`, `scale(s)` or `scale(sx,sy)`, `scaleX`, `scaleY`.
**`skew`/`skewX`/`skewY` NOT supported** (silently ignored).

Composition: translate → motion-path offset → transform-origin sandwich (`T(origin)·R·S·T(-origin)`). Rotation is a plain numeric lerp — **no shortest-arc**, so `rotate(0deg)→rotate(360deg)` spins a full turn. World matrix = parentWorld × local.

### Individual transform properties

The CSS individual transform properties are also accepted as standalone
declarations — in a rule body, in `@keyframes`, and in `&:hover`/`&:active`:

```css
translate: 40px 10px; /* <x> [<y>]  (y defaults to 0) */
rotate: 45deg; /* <angle> */
scale: 1.2; /* <n> [<n>]  (single value = uniform) */
```

NOTE: unlike CSS, these are **not** a separate transform layer — they write
the **same** channels (`translateX/translateY/rotate/scaleX/scaleY`) as
`transform:`. So mixing `transform:` and `translate:`/`rotate:`/`scale:` on one
node is **last-declaration-wins per channel**, not additive layering.

### transform-origin

```css
transform-origin: center; /* both axes 50% */
transform-origin: 50% 100%; /* x then y */
transform-origin: left top;
```

Keywords `left/right/top/bottom/center`; `%` resolves against the bounding box. Groups/paths have no intrinsic box → `%` origins resolve to 0. Default `0 0`. `transform-origin` **is** the anchor (no separate `anchor` property).

### Shape replacement gotcha

Three facts above combine into a trap when reshaping a node: geometry props
are type-gated (§4), so swapping `type: rect` → `path` silently drops `x`/`y`
and the node jumps to the origin; if `@keyframes` animate `transform`, each
frame replaces the **whole** transform, wiping any placement added via
`transform: translate(...)` (or the equivalent `translate:` property — same
channels, per above); and keyword/`%` `transform-origin` resolves to `(0, 0)`
on paths/groups, not their visual center. The safe pattern: put static
placement on an **outer group** (`transform: translate(...)`), and put the
animated `transform`/keyframes on an **inner shape** authored in local
coordinates with its pivot at the origin (or a numeric px `transform-origin`).

### Motion paths

```css
offset-path: path("M0 0 C50 -80 150 -80 200 0");
offset-distance: 50%; /* animatable; normalized 0..1 */
offset-rotate: auto; /* auto | <deg> | auto <deg> */
```

Animate `offset-distance` to move along the path (positioned by arc length). At `offset-distance: 0` the node sits at the path's **first point** (per CSS), not at its bare anchor — so a node whose `offset-distance` animation hasn't started yet still rides the path start. `offset-rotate: auto` follows the tangent; a fixed angle orients rigidly; `auto <deg>` = tangent + offset.

### Time scoping (precomps)

`time-offset` and `time-scale` retime a node **and its whole subtree** — its own
animations plus every descendant's. The local timeline is rewritten to
`(t − time-offset) · time-scale`, so all downstream timing (delays, iterations,
fill modes, motion-path distance) follows along.

```css
#slow-mo {
  type: group;
  time-offset: 2s; /* subtree starts 2s later on the parent timeline */
  time-scale: 0.5; /* ...and runs at half speed (2 = double, must be > 0) */
  > #a {
    type: circle;
    r: 10px;
    fill: #e94560;
    animation: pulse 1s ease-in-out infinite;
  }
}
```

- `time-offset: <time>` — `s`/`ms` (bare number = ms). Default `0`.
- `time-scale: <number>` — playback rate. Must be `> 0` (else warns, falls back to `1`). Default `1`.
- Both are **static** (not animatable). Nested scopes compose — each applies to the local time it inherits. This is how imported compositions (Lottie precomps, with per-instance start time and stretch) keep independent clocks.

### Paint order — `z-index`

By default siblings paint in **document order** (later = on top). `z-index: <int>`
overrides this: siblings paint in ascending z-index, document order breaking ties.

```css
#shadow { type: ellipse; …; z-index: -1; }   /* behind its siblings */
#hat    { type: path;    …; z-index: 10; }    /* in front */
```

- Static integer; **negatives are valid** (the common case — push a node behind its siblings).
- Default `0`. Only orders **within one parent's children** (not across the whole tree).
- The same order drives **hit-testing**, so painted stacking and click priority always agree.

### Visibility window — `visible-from` / `visible-until`

Show a node (and its whole subtree) only during a time window, in **scene-local ms**
(the same scoped time the scheduler samples — so it respects `time-offset`/`time-scale`).

```css
#flash { type: circle; …; visible-from: 1s; visible-until: 3s; }  /* on screen 1s–3s only */
```

- `s`/`ms` (bare number = ms). Outside `[visible-from, visible-until)` the node + subtree are skipped by **both** render and hit-testing.
- Defaults `-Infinity` / `+Infinity` (always visible). Static (not animatable).

---

## 11. Animation

Set with the `animation:` shorthand and/or the `animation-*` longhands
(`-name`, `-duration`, `-timing-function`, `-iteration-count`, `-direction`,
`-delay`, `-fill-mode`), composing per standard CSS: source order wins per
sub-property; the shorthand resets the whole list, a longhand overrides only
its own sub-property; comma-separated longhands match positionally (shorter
lists cycle).

```css
animation: pulse 1.5s ease-in-out infinite;
animation: spin 3s linear infinite;
animation: slide 1s cubic-bezier(0.42, 0, 0.58, 1) 2 reverse 0.5s;

/* longhands, alone or refining a shorthand */
animation-name: pulse;
animation-duration: 1.5s;
animation: fade 1s;
animation-duration: 2s; /* duration → 2s (later wins) */
```

### Shorthand tokens (parsed by type, order-independent except time values)

| Token                                                                      | Effect            | Default    |
| -------------------------------------------------------------------------- | ----------------- | ---------- |
| keyword matching a `@keyframes` name                                       | animation `name`  | required   |
| `linear`/`ease`/`ease-in`/`ease-out`/`ease-in-out`/`step-start`/`step-end` | timing fn         | `ease`     |
| `cubic-bezier(x1,y1,x2,y2)` / `steps(n, pos)` / `linear(stops)`            | timing fn         |            |
| `infinite`                                                                 | iteration count ∞ | `1`        |
| bare integer `0 < n < 100`                                                 | iteration count   | `1`        |
| `normal`/`reverse`/`alternate`/`alternate-reverse`                         | direction         | `normal`   |
| `none`/`forwards`/`backwards`/`both`                                       | fill mode         | `forwards` |
| first `s`/`ms` value                                                       | duration          | `1000ms`   |
| second `s`/`ms` value                                                      | delay             | `0`        |

**Time-value order rule:** first time value is always duration, second always delay, regardless of magnitude. `s` × 1000; `ms` as-is.

### fill-mode (deliberate CSS divergence)

Defaults to **`forwards`** (CSS defaults to `none`) so scenes hold their final frame. The longhand composes by source order like any other sub-property — put it after the shorthand to override the shorthand's fill mode:

```css
#node {
  animation: fade 1s ease;
  animation-fill-mode: both;
} /* → both */
```

### animation-composition

`animation-composition: replace | add | accumulate` — how an animation's sampled
value composites with what earlier layers already wrote this frame (base +
`var()`/`input()` bindings + earlier animations). **Longhand only — NOT part of
the `animation` shorthand** (which resets it to `replace`), and matched
positionally against the animation list like the other longhands.

```css
#node {
  animation: shake 0.4s linear infinite;
  animation-composition: add;
}
```

- `add` / `accumulate` — numeric channels (`translateX/Y`, `rotate`, `scaleX/Y`,
  `opacity`, `stroke-width`, geometry, trim, …) are **added** onto the underlying
  value, so an `add` animation reads as a delta on top of the base pose. For
  plain `<number>`/`<length>` the two are identical (Popkorn doesn't model
  cross-iteration accumulation). A keyframe that omits an additive property
  contributes `0` (the additive identity), never the base.
- `replace` (default) — overwrite, the classic behaviour.
- **Color / gradient / path** properties fall back to `replace` under `add`/
  `accumulate` (no meaningful numeric sum).

### No duration sentinel

`1000ms` is a real, author-reachable duration — not an "unset" marker. The builder tracks assignment with a `durationSet` boolean, so `animation: spin 1s linear 1 2s` → duration `1000`, delay `2000`. `iterationCount = Infinity` is the genuine value for `infinite`.

### Negative delay

Supported (standard CSS seek-forward). `animation: slide 1s linear -0.5s` starts already 500ms in.

---

## 12. @keyframes

```css
@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.3);
    opacity: 0.7;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes twinkle {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.6);
    opacity: 0.5;
  }
}
```

- Selectors: `from` (=0), `to` (=100), or `<n>%`, normalized to a 0–1 timeline. A multi-selector block takes its first selector's offset.
- **`transform:` in a keyframe is decomposed** into `translateX/translateY/rotate/scaleX/scaleY` so it merges with (not replaces) the base transform.
- A property omitted from a keyframe falls back to the node's authored base value.

### Animatable properties

Numeric (lerp): `translateX`, `translateY`, `rotate`, `scaleX`, `scaleY`, `opacity`, `stroke-width`, `x`, `y`, `width`, `height`, `rx`, `ry`, `cx`, `cy`, `r`, `outer-radius`, `inner-radius`, `rotation`, `stroke-dashoffset`, `trim-start`, `trim-end`, `trim-offset`, `offset-distance`, `font-size`, `border-top-left-radius`, `border-top-right-radius`, `border-bottom-right-radius`, `border-bottom-left-radius` (the `border-radius` per-corner longhands), `letter-spacing`, `line-height`.
Color (rgb/rgba lerp): `fill`, `stroke` (solid colors).
Gradient paint: `fill`, `stroke` — interpolated when endpoints are **compatible** (same gradient type + stop count); otherwise step.
Path shape: **`d` morphs** — interpolated when both keyframe paths have the **same command sequence** (same letters, same order/counts); otherwise step. Trim, fill-rule, hit-testing keep working on the morphing path.
Filter/shadow: `box-shadow` — each shadow's `dx`/`dy`/`blur`/`spread`/color animates through the same object-endpoint path as `filter`.
**Not animatable:** `sides` (star/polygon vertex count), `time-offset`, `time-scale`, `mix-blend-mode` (static).

```css
@keyframes recolor {
  /* gradient stop animation (compatible endpoints) */
  0% {
    fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%);
  }
  100% {
    fill: linear-gradient(45deg, #ffe66d 0%, #a855f7 100%);
  }
}
@keyframes blob {
  /* path morph — identical command sequence */
  0% {
    d: "M 400 150 C 483 150 550 217 550 300 C 550 383 483 450 400 450 Z";
  }
  100% {
    d: "M 400 130 C 520 180 580 240 560 320 C 540 400 460 470 380 460 Z";
  }
}
```

### Per-keyframe easing & step-end (hold) keyframes

Put `animation-timing-function:` **inside** a keyframe block — controls the transition **from that keyframe to the next**:

```css
@keyframes move {
  0% {
    transform: translateX(0);
    animation-timing-function: ease-out;
  }
  50% {
    transform: translateX(100px);
    animation-timing-function: step-end;
  } /* HOLD */
  100% {
    transform: translateX(200px);
  }
}
```

`step-end` holds the _from_ value and jumps at the next keyframe. No easing → falls back to the animation-level timing function.

---

## 13. Easing functions

The standard CSS named easings — `linear`, `ease`, `ease-in`, `ease-out`,
`ease-in-out` — all work as in CSS. Beyond those:

| Name                        | Curve                                             |
| --------------------------- | ------------------------------------------------- |
| `step-start`                | jump to 1 at t=0, hold (= `steps(1, jump-start)`) |
| `step-end`                  | hold 0 until t=1, then 1 (= `steps(1, jump-end)`) |
| `cubic-bezier(x1,y1,x2,y2)` | custom (Newton-Raphson solve)                     |
| `steps(<n>, <position>?)`   | staircase of `n` intervals                        |
| `linear(<stop-list>)`       | piecewise-linear (springs/bounces)                |

**`steps(<n>, <position>?)`** — CSS Easing L1 step function. `position` is one of
`jump-start`/`jump-end` (default)/`jump-none`/`jump-both`, plus the aliases
`start` (= jump-start) and `end` (= jump-end). `step-start`/`step-end` are the
one-step shorthands.

**`linear(<stop-list>)`** — CSS Easing L2 piecewise-linear curve. Comma-separated
control points, each `<number>` (the output) with optional 1–2 `<percentage>`
input positions; two percentages make a flat segment. Missing input positions
distribute evenly between neighbours. Outputs may exceed 1 to overshoot, so
linear() is the way to approximate a spring or bounce with two plain keyframes,
e.g. `animation-timing-function: linear(0, 1 33%, 0.55 46%, 1 62%, 0.78 74%, 1)`.

All easings work in the `animation` shorthand, the `animation-timing-function`
longhand, and per-keyframe (inside a keyframe block).

Direction semantics: `normal` → progress; `reverse` → 1−progress; `alternate` → forward on even iterations, back on odd; `alternate-reverse` → opposite parity. The held final frame under `forwards`/`both` accounts for direction and iteration parity.

---

## 14. Interactivity

### Runtime inputs via `input(...)` + `var(...)`

```css
:root {
  --cursor-x: input(cursor.x);
  --cursor-y: input(cursor.y);
}
#follower {
  type: circle;
  r: 30px;
  fill: #e94560;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
}
```

Input paths: `cursor.x`, `cursor.y` (canvas-local px), `cursor.isDown` (1/0), `scroll.x`, `scroll.y`, `time` (ms). Unknown → `0`.
**`input()` is numeric only** — `cursor`/`scroll`/`time` feed numbers, no color/string input source. `var()` is typed (see §3): it can carry a number, a color, or a string, and re-resolves live wherever it's used. Any value containing `var()`/`input()` is deferred to render-time (except structural props, folded at build time — see §3).

### Pseudo-states

```css
#btn {
  type: circle;
  r: 30px;
  fill: #e94560;
  &:hover {
    fill: #ff6b8a;
    transform: scale(1.2);
  }
  &:active {
    fill: #c73e54;
    transform: scale(0.9);
  }
}
```

- Hit-testing uses the inverse world matrix (regions match paint exactly), respects clip regions, returns the topmost interactive node.
- State override consumes only `fill`, `stroke`, `stroke-width`, `opacity`, `transform`.
- `active` falls back to `hover` styles if no `&:active` block.
- **Transform overrides layer on top of running animations:** `translate`/`rotate` additive, `scale` multiplicative.

**Hit-testing bubbles like the DOM.** Any shape whose _geometry_ contains the
pointer credits its **nearest interactive ancestor-or-self**:

- A `&:hover`/`&:active` on a `type: group` now works — hovering **any**
  descendant shape flips the group's state (groups have no geometry of their own,
  so this is the only way they get hit).
- An interactive shape's hover region **includes descendant geometry that pokes
  outside its own outline** (e.g. a leaf overhanging its stem group).
- **Nearest wins:** a directly-interactive child still beats an interactive
  ancestor inside the child's own geometry; topmost paint depth breaks ties, so
  hit priority stays "paint order, reversed" (matches `z-index`).
- Hit-testing is **geometry-only** — an unpainted shape (`fill: none`, no stroke)
  still hits, and now bubbles to its interactive ancestor too. Give a purely
  decorative-but-invisible child `pointer-events: none` if you don't want it
  enlarging the parent's hit region.

**`pointer-events: none | auto`** (default `auto`) removes a node **and its whole
subtree** from hit-testing: its geometry neither hits it nor bubbles to an
ancestor. Simplification vs. CSS: we do **not** support re-enabling — a
`pointer-events: auto` on a descendant of a `none` node is ignored. Static
property: not animatable, not overridable inside a `&:hover`/`&:active` block.
Mask sources are likewise never hit-testable (skipped whole, same as `none`).

**Styling a child on the parent's state** — put a `> #child` rule inside the
state block (the DSL spelling of CSS `#card:hover > #icon { … }`):

```css
#card {
  type: rect;
  width: 200px;
  height: 120px;
  fill: #1a1a2e;
  > #icon {
    type: circle;
    cx: 100px;
    cy: 60px;
    r: 20px;
    fill: #888;
  }
  &:hover {
    fill: #2a2a4a; /* the card itself */
    > #icon {
      fill: #fff;
      transform: rotate(15deg);
    } /* that child */
  }
}
```

- Targets a **direct child** by `#id`/`.class`; consumes the same subset as any
  state block (`fill`, `stroke`, `stroke-width`, `opacity`, `transform`, plus
  standalone `translate`/`rotate`/`scale`). Overrides apply/unapply exactly when
  the parent's own do (same frame-walk point, same additive/multiplicative
  transform composition), and `&:active` falls back to `&:hover` for children too.
- Being targeted does **not** make the child hit-testable — only the parent
  reacts to the pointer; the child rides the parent's state.
- **Transition fallback for a targeted child:** its own node-level `transition:`
  (declared in its normal `> #child` body) wins; else the `transition:` declared
  inside the parent's state block governs the children it lists; else the change
  snaps. Either way the tween is anchored on the _parent's_ state flip.
- One level is the supported depth: a child driven this way does not re-cascade
  its own state-child rules.

### Transitions

`transition` makes a state flip **tween** its overridable properties (`fill`,
`stroke`, `stroke-width`, `opacity`, `transform`) from the currently displayed
value to the target instead of snapping — on both enter and exit.

```css
#btn {
  type: circle;
  r: 30px;
  fill: #e94560;
  transition:
    fill 0.3s ease,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  &:hover {
    fill: #ff6b8a;
    transform: scale(1.2);
  }
}
```

- Syntax: `transition: <property> <duration> [<easing>] [<delay>]`, comma-list;
  plus `transition-property` / `-duration` / `-timing-function` / `-delay`
  longhands composing positionally like the animation longhands. `all` is the
  default property; a zero-duration transition is instant (no tween).
- Declarable at node level (governs enter and exit) or inside a state block
  (governs entering that state — CSS asymmetric timing).
- Runtime only, driven by wall-clock in the interaction layer. The animation
  **timeline stays a pure function of time** — `seek(t)` twice is identical
  whenever no interaction state changes.
- Color tweens interpolate; a null↔color paint change snaps (nothing to lerp).

### State machines — `@machine` / `:state()`

For interaction a `:hover`/`:active` override **can't** express — a state that
outlives the pointer (toggles, "intro once then loop", timeouts, app-state
driven looks). `:hover`/`:active` still cover plain hover/press buttons; reach
for `@machine` only when a state must persist.

<!-- repo-only -->

**Full spec + rationale:
[docs/state-machines.md](../../../docs/state-machines.md); worked scenes:
`examples/popkorn/11-state-machine.css` and `12-toggle-lamp.css`.**

<!-- /repo-only -->

```css
:root {
  --energy: 0;
  --tap: trigger;
} /* inputs = custom props; trigger auto-resets */

@machine cat {
  initial: idle;
  state idle {
    to: excited on click(#hitbox);
    to: hyper when style(--energy > 80) mix 300ms ease-in-out;
  }
  state excited {
    to: idle on complete;
  } /* this state's animations finished */
  state hyper {
    to: idle when style(--energy <= 80);
    emit: overheat;
  }
  state * {
    to: idle on event(reset);
  } /* any-state, checked before current */
}

#cat:state(idle) {
  animation: breathe 2s ease-in-out infinite;
}
#cat:state(excited) {
  animation: jump 600ms ease-out;
} /* restarts on entry */
```

- One `@machine` = one graph; **multiple blocks run concurrently** (a blink loop
  and button logic don't share a graph). Declare `initial:`.
- `to: <state> [on <trigger>] [when <guard> [and <guard>]*] [mix <dur> [<easing>]]`.
  **Declaration order = priority** (first passing transition wins). Guards ANDed
  only.
- **Triggers (`on …`), zero host code:** `click(#id)` `pointerdown/up(#id)`
  `hoverstart/end(#id)` (or `(:root)` for anywhere) · `complete` (state's
  animations done) · `event(name)` (host escape hatch — `player.fire('name')`).
- **Guards (`when style(…)`):** MQ-range comparisons over `--vars` and `input()`
  paths: `--energy > 80`, `--mood: happy` (equality), `input(cursor.x) < 400`,
  `state-time > 2s` (reserved per-machine timer → timeouts), plus `media.*`
  (`prefers-reduced-motion`, `hover`, `width`, `height`).
- **`:state(name)` is a full rule** — including `animation:`, which is the
  capability jump over `:hover` (a state can _start_ an animation, re-anchored at
  entry time). Namespace as `:state(cat.idle)` if two machines share a name.
- **Machine scenes are unbounded** (no loop-wrap / play-once clamp); a one-shot
  `:state()` animation holds its final frame — `:state()` animations default to
  `animation-fill-mode: both`, not the node-level `forwards`.
- **Host API:** `player.setVariable('--energy', 80)` / `player.fire('--tap')` /
  `player.getVariable(...)`; events out are `emit: name` (on entry) →
  `popkorn:machine-event` CustomEvent, plus `popkorn:statechange` on every
  transition. (All player DOM events are namespaced under `popkorn:`.)
- Seek stays pure as a function of `(time, machineState)` — machine state lives
  off the timeline (invariant 4 holds). `mix` currently hard-cuts (tween parses
  but isn't wired yet).

### Scrubbing — `animation-timeline`

Drive an animation by a **0..1 value** instead of the clock — the same
`var()`/`input()` vocabulary used everywhere else:

```css
#bar {
  animation: fill-up 1s linear;
  animation-timeline: var(--progress);
} /* host-fed 0..1 */
#hero {
  animation: reveal 1s ease-out;
  animation-timeline: input(scroll.progress);
}
```

- `scroll.progress` is scroll position normalized to 0..1 (raw offset stays
  `scroll.y`). Orthogonal to `@machine`; web scenes need zero host code, native
  hosts feed `var(--progress)`.

---

## 15. Embedding — `<popkorn-player>`

Auto-registered custom element wrapping a shadow-DOM canvas.

- **Attributes:** `src` (DSL string), `width` (400), `height` (300), `background`, `loop`, `controls`, `autoplay`, `fit`.
  - `loop` (boolean attr) — timeline loops instead of holding the last frame.
  - `controls` (boolean attr) — shows a play/pause + scrubber + time overlay.
  - `autoplay` (boolean attr) — start playing on load.
  - `fit` — how the scene scales into the element box: `contain` (default, letterbox), `cover` (crop to fill), `fill` (stretch per-axis), `none` (1:1, top-left, may clip).
- **JS props:** `source`, `width`, `height`, `background`, `loop`, `currentTime` (ms, read-only).
- **Methods:** `play()`, `stop()`, `reset()`, `pause()` (freezes timeline, keeps interaction), `resume()`, `seek(ms)`.
- **Events** (namespaced under `popkorn:`): `popkorn:ready`
  (`detail.sceneRoot`), `popkorn:error` (`detail.error`), `popkorn:complete`,
  `popkorn:timeupdate` (`detail.time/duration`), and `popkorn:click`
  (`detail.{id,path,x,y}` — fires with no opt-in when a press+release land on the
  same shape; `id`/`path` credit the nearest `cursor: pointer`/interactive
  ancestor).
- **`cursor: pointer`** on a node marks it interactive and shows a pointer cursor
  on hover (static, not animatable).

```js
const player = document.querySelector("popkorn-player");
player.source = myDslCode; // parse + build + play
```

---

## 16. Example scene

One scene exercising the shapes that make Popkorn _not_ plain CSS — `:root`
stage config, `type:` shapes, `>` nesting, `@define`/`use:` symbols, keyframe
wiring, a motion path, and `var(--…)`/`&:hover` interactivity:

```css
:root {
  width: 800px;
  height: 600px;
  background: #0a0a1a;
  --cursor-x: input(cursor.x);
}

@keyframes twinkle {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.6);
    opacity: 0.4;
  }
}
@keyframes travel {
  0% {
    offset-distance: 0%;
  }
  100% {
    offset-distance: 100%;
  }
}

@define star {
  /* reusable symbol */
  type: circle;
  r: 8px;
  fill: #fbbf24;
  transform-origin: center;
  animation: twinkle 2s ease-in-out infinite;
}

#star1 {
  use: star;
  cx: 200px;
  cy: 120px;
}
#star2 {
  use: star;
  cx: 400px;
  cy: 120px;
  fill: #60a5fa;
} /* fill overrides */

#comet {
  /* rides a motion path */
  type: circle;
  r: 12px;
  fill: #ffffff;
  offset-path: path("M0 400 C200 200 600 200 800 400");
  offset-rotate: auto;
  animation: travel 4s linear infinite;
}

#scene {
  /* group with a > nested, interactive child */
  type: group;
  transform: translate(400px, 300px);
  > #follower {
    type: circle;
    r: 30px;
    fill: #e94560;
    cx: var(--cursor-x);
    &:hover {
      fill: #ff6b8a;
      transform: scale(1.2);
    }
    &:active {
      fill: #c73e54;
      transform: scale(0.9);
    }
  }
}
```

<!-- repo-only -->

More worked scenes (static composition, keyframe groups, state machines) live in
`examples/popkorn/`.

<!-- /repo-only -->

---

## 17. Gotchas cheat-sheet

- **`type:` omitted → `group`.** Only the `type:` declaration picks a shape; no selector does.
- **`fill` and `stroke` default to `none`** — `stroke-width: 1` alone paints nothing.
- **fill-mode defaults to `forwards`**, not CSS's `none`.
- **1000ms duration is real**, not a sentinel; the second shorthand time value is always the delay.
- **`infinite` = ∞ iterations**.
- **Rotation lerps linearly** (no shortest-arc) — intentional for full-turn spins.
- **Unsupported (parse but do nothing):** `skew`, `object-fit`, `href`/`src` (use `content: url()`), `points` (use `sides`). (`steps()`/`linear()` easing **are** supported — see §13; `text-align`/`line-height`/`letter-spacing` and `mix-blend-mode` **are** supported — see §5/§6.)
- **`var()` is typed (number/color/string); `input()` stays numeric only** — see §3.
- **Gradients + path `d` ARE animatable** — but only between _compatible_ endpoints (same gradient type/stop count; identical path command sequence); incompatible pairs step instead of interpolate.
- **`opacity` cascades** to descendants (group opacity dims its whole subtree).
- **`time-scale`/`time-offset`** retime a node + its subtree (precomp-style); static, must be `> 0` for scale.
- **Paint order = document order**, override with `z-index` (negatives allowed); it also sets hit-test priority.
- **`visible-from`/`visible-until`** gate a node + subtree to a scene-local time window (skipped in render _and_ hit-test outside it).
- **Geometry props are type-gated** — `r` on a rect is ignored, etc.
- **`@machine` scenes are unbounded** — no loop-wrap/play-once clamp; `:state()` animations default to `fill-mode: both` (a one-shot holds its final frame), unlike the node-level `forwards`.
- **`filter`** supports only `blur()` (animatable) and `drop-shadow()` (static); anything else is dropped.
- **`border-radius` has no elliptical slash form** (`10px / 20px`) — corners are circular only; use `type: path` for an elliptical corner.
- **`box-shadow` `spread` only inflates `rect`/`circle`/`ellipse`** — on `path`/`star`/`polygon` it falls back to a plain `filter: drop-shadow()` and spread is ignored.
- **`letter-spacing` is a no-op on the RN/Skia backend** (pinned divergence) — Canvas2D and SVG both realize it.
- Unrecognized enum keywords silently fall back to the default.
- **No `//` comments, no `.5` numbers, no exponents** (`0.5`, not `.5`).

---

<!-- repo-only -->

## Source files

- Parser & AST: `packages/popkorn-parser/src/{parser,ast,parser.test}.ts`
- Scene builder & types: `packages/popkorn-player/src/scene/{builder,types,transform,polystar,clip,path-parser}.ts`
- Renderer: `packages/popkorn-player/src/renderer/{canvas2d,types,interface}.ts`
- Animation: `packages/popkorn-player/src/animation/{easing,keyframes,scheduler,registry}.ts`
- Runtime & component: `packages/popkorn-player/src/runtime/{loop,inputs,variables,interaction,hit-test,state-machine}.ts`, `component.ts`
- Examples: `examples/*.css`, `examples/lottie/*.css`
- Lottie converter: `packages/popkorn-converters/src/lottie2popkorn.ts`
<!-- /repo-only -->
