# Popcorn DSL — Complete Reference

Source-verified against `packages/popcorn-parser/src/parser.ts` (parser),
`packages/popcorn-player/src/scene/builder.ts` (semantics), the animation/runtime
modules, and `examples/*.css`. The parser is **generic** — it accepts any
`property: value`. Meaning is assigned downstream by the scene builder, so an
unrecognized property parses fine and is **silently ignored** at build time.

Pipeline: `source → parse() → StyleSheet AST → buildSceneGraph() → SceneNode tree → RenderLoop → Canvas2DRenderer`.

---

## 1. Top-level structure

A document is a flat list of three constructs, in any order:

- `@keyframes name { … }` — animation timelines
- `@define name { … }` — reusable symbol definitions
- Rules — `selector { … }`, where one selector is special/hoisted: `:root` (stage config + globals)

### Stage config & root variables

```css
:root {
  width: 800px;        /* default 800 — numeric value only, unit ignored */
  height: 600px;       /* default 600 */
  background: #0f0f23; /* only a hex/color VALUE is captured here */
  --brand: #e94560;    /* custom properties live here too */
  --cursor-x: input(cursor.x);
}
```

`:root` holds both stage config (`width`/`height`/`background`) and global custom properties.
Defaults `800×600`, no background. Only a color-typed value sets `background`. If `:root` declares
no `width`/`height`, `<popcorn-player>` falls back to its own `width`/`height` attributes (defaults
400×300). Only `--`-prefixed declarations become global variables (see §10, §14).

---

## 2. Selectors, nesting, grouping

| Syntax | Meaning |
|---|---|
| `#id { }` | Node with id (`node.id`) |
| `.class { }` | Node with class (`node.className`; id auto) |
| `:root { }` | Stage config + global variables (hoisted) |

**No element/type selectors, no combinators.** A node's shape is set by a `type:` *declaration*, not the selector.

**Nesting** uses `>` as a prefix inside a rule body, followed by a full child rule:

```css
#group {
  type: group;
  transform: translate(400px, 300px);
  > #child { type: rect; width: 100px; height: 100px; fill: #4ecdc4; }
}
```

**Pseudo-states** use `&:` inside a rule body (only `hover`/`active` are meaningful — see §14):

```css
#btn {
  type: circle; r: 30px; fill: #e94560;
  &:hover  { fill: #ff6b8a; transform: scale(1.2); }
  &:active { fill: #c73e54; transform: scale(0.9); }
}
```

---

## 3. Value types, units, colors

### Value tagged union (8 variants)

| `type` | Example | Fields |
|---|---|---|
| `length` | `10px`, `45deg`, `50%`, `1.5s` | `value`, `unit` |
| `number` | `0.5`, `-3`, `700` | `value` |
| `color` | `#e94560`, `#fff`, `#rrggbbaa` | `value` (keeps `#`) |
| `keyword` | `red`, `center`, `infinite`, `cursor.x` | `value` |
| `string` | `"Hello"`, `'sans-serif'` | `value` |
| `function` | `rgb(…)`, `cubic-bezier(…)`, `input(…)` | `name`, `args[]` |
| `variable` | `var(--x)` | `name` |
| `list` | `pulse 1.5s ease-in-out infinite` | `values[]` |

Space-separated values in one declaration → a `list`. A single value is used directly.

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

| `type:` | Geometry props | Per-type defaults |
|---|---|---|
| `group` (default) | — | container only |
| `rect` | `x`, `y`, `width`, `height`, `rx`, `ry` | all `0` |
| `circle` | `cx`, `cy`, `r` | all `0` |
| `ellipse` | `cx`, `cy`, `rx`, `ry` | all `0` |
| `path` | `d` (SVG path) | `d: ''` |
| `star` | `sides`, `outer-radius`, `inner-radius`, `outer-roundness`, `inner-roundness`, `rotation`, `cx`, `cy` | `sides: 5`, radii/roundness `0`, `rotation: 0` |
| `polygon` | `sides`, `outer-radius`, `outer-roundness`, `rotation`, `cx`, `cy` | same |
| `text` | see §6 | |
| `image` | see §7 | |

- `rect` renders rounded corners when `rx>0` or `ry>0`.
- `path` commands: `M L H V C S Q T A Z` (absolute + relative).
- `star` vs `polygon`: polygon ignores `inner-radius`/`inner-roundness`. Vertex count is `sides` (**not `points`**), floored, min 2. Star vertices start at −90° + `rotation` (0 points up). `*-roundness` are percentages; 0 = straight edges.
- Geometry props are **type-gated**: mismatched props (`r` on a rect) are silently ignored.

---

## 5. Visual / style properties

| Property | Values | Default |
|---|---|---|
| `fill` | hex, `rgb()`/`rgba()`, `linear-gradient()`, `radial-gradient()`, named color, `none` | `none` |
| `stroke` | same as fill | `none` |
| `stroke-width` | number | `1` |
| `stroke-linecap` | `butt` \| `round` \| `square` | `butt` |
| `stroke-linejoin` | `miter` \| `round` \| `bevel` | `miter` |
| `stroke-miterlimit` | number (only used when join is `miter`) | `4` (SVG/Lottie default, not Canvas's 10) |
| `stroke-dasharray` | space-separated lengths | `[]` (solid) |
| `stroke-dashoffset` | number | `0` |
| `fill-rule` | `nonzero` \| `evenodd` | `nonzero` |
| `opacity` | fraction | `1` |
| `trim-start` / `trim-end` / `trim-offset` | `%`→fraction, clamped 0..1 | `0` / `1` / `0` |

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
fill: radial-gradient(circle 40px at 150px 150px from 140px 140px, #fff 0%, #333 100%);
```

- Linear `from <x> <y> to <x> <y>` — exact endpoints instead of an angle.
- Radial `circle <r> at <cx> <cy>` — exact radius + center; optional `from <fx> <fy>` sets a **focal point** (offset inner-circle center, for off-axis highlights).
- Angle/bbox-centered forms remain the fallback when geometry is omitted.

- **Gradient fills/strokes ARE animatable** (§12) when the two keyframe endpoints are *compatible* — same gradient type and same stop count (stops pair index-for-index; colors, offsets, **and matching geometry fields** interpolate). Incompatible endpoints step (hold departing value).

### Blend modes

**Not supported** — no `mix-blend-mode`. Compositing is clip-path + masks only (§9).

---

## 6. Text nodes

```css
#label {
  type: text; content: "Hello Popcorn";
  x: 400px; y: 300px;
  font-size: 40px; font-family: sans-serif; font-weight: bold;
  text-anchor: middle; fill: #ffffff;
}
```

| Property | Value | Default |
|---|---|---|
| `content` | string | `''` |
| `x` / `y` | anchor x / alphabetic baseline y | `0` |
| `font-size` | number (animatable) | `16` |
| `font-family` | string | `sans-serif` |
| `font-weight` | keyword (`bold`) or number (`700`) | `normal` |
| `text-anchor` | `start` \| `middle` \| `end` | `start` |

Text color uses **`fill`** (and `stroke`), not `color`. Gradients work. **No `text-align`, `line-height`, `letter-spacing`.** Single line only.

---

## 7. Image nodes

```css
#photo {
  type: image;
  content: url("data:image/png;base64,…");   /* or url("https://…") */
  x: 100px; y: 100px; width: 200px; height: 150px;
}
```

| Property | Value | Default |
|---|---|---|
| `content` | `url('<URL or data: URI>')` | `''` |
| `x` / `y` | number | `0` |
| `width` / `height` | number | `0` |

Source property is **`content: url(...)`** (the CSS spelling — not `href`/`src`). **No `object-fit`.** `width`/`height` of `0` → natural size. Nothing paints until the image decodes.

---

## 8. Symbols / reusable components

```css
@define star {
  type: circle; r: 10px; fill: #fbbf24;
  transform-origin: center;
  animation: twinkle 2s ease-in-out infinite;
}

#star1 { use: star; cx: 250px; cy: 320px; }
#star2 { use: star; cx: 400px; cy: 320px; fill: #60a5fa; }  /* fill overrides */
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
clip-path: inset(10 20 10 20);          /* CSS shorthand: 1/2/4 values */
clip-path: path('M0 0 L100 0 L50 100 Z');
clip-path: path('M…Z') path('M…Z');     /* multi-shape mask: union (nonzero) */
```

`circle(r at x y)`, `inset(t [r b l])` (resolved against bounding box), `path('…')`. A space-separated list of `path()` values unions into one clip region (Lottie mask add-mode). Applied with the node's `fill-rule`. Default: no clip.

### Masks

```css
mask: #maskLayer alpha;   /* alpha | alpha-invert | luminance | luminance-invert */
```

- References another node by id (`#id`, `#` stripped). Default mode `alpha`.
- The source node becomes mask-only (never painted on its own).
- Luminance modes convert alpha to luminance (`0.2126R + 0.7152G + 0.0722B`); `*-invert` uses `destination-out` vs `destination-in`.
- Unknown source id throws `mask on '…' references unknown node '#…'`.

---

## 10. Transforms & motion paths

### transform

```css
transform: translate(400px, 300px) rotate(45deg) scale(1.2);
```

Supported: `translate(x[,y])`, `translateX`, `translateY`, `rotate(deg)`, `scale(s)` or `scale(sx,sy)`, `scaleX`, `scaleY`.
**`skew`/`skewX`/`skewY` NOT supported** (silently ignored).

Composition: translate → motion-path offset → transform-origin sandwich (`T(origin)·R·S·T(-origin)`). Rotation is a plain numeric lerp — **no shortest-arc**, so `rotate(0deg)→rotate(360deg)` spins a full turn. World matrix = parentWorld × local.

### transform-origin

```css
transform-origin: center;     /* both axes 50% */
transform-origin: 50% 100%;   /* x then y */
transform-origin: left top;
```

Keywords `left/right/top/bottom/center`; `%` resolves against the bounding box. Groups/paths have no intrinsic box → `%` origins resolve to 0. Default `0 0`. `transform-origin` **is** the anchor (no separate `anchor` property).

### Motion paths

```css
offset-path: path('M0 0 C50 -80 150 -80 200 0');
offset-distance: 50%;   /* animatable; normalized 0..1 */
offset-rotate: auto;    /* auto | <deg> | auto <deg> */
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
  time-offset: 2s;    /* subtree starts 2s later on the parent timeline */
  time-scale: 0.5;    /* ...and runs at half speed (2 = double, must be > 0) */
  > #a { type: circle; r: 10px; fill: #e94560; animation: pulse 1s ease-in-out infinite; }
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
`-delay`, `-fill-mode`). They compose per CSS: declarations apply in source
order and later ones win **per sub-property**; the shorthand resets the whole
list, a longhand overrides only its own sub-property. A comma-separated
longhand is matched positionally against the animation list (shorter lists
cycle).

```css
animation: pulse 1.5s ease-in-out infinite;
animation: spin 3s linear infinite;
animation: slide 1s cubic-bezier(0.42,0,0.58,1) 2 reverse 0.5s;

/* longhands, alone or refining a shorthand */
animation-name: pulse;
animation-duration: 1.5s;
animation: fade 1s;  animation-duration: 2s;   /* duration → 2s (later wins) */
```

### Shorthand tokens (parsed by type, order-independent except time values)

| Token | Effect | Default |
|---|---|---|
| keyword matching a `@keyframes` name | animation `name` | required |
| `linear`/`ease`/`ease-in`/`ease-out`/`ease-in-out`/`step-end` | timing fn | `ease` |
| `cubic-bezier(x1,y1,x2,y2)` | timing fn | |
| `infinite` | iteration count ∞ | `1` |
| bare integer `0 < n < 100` | iteration count | `1` |
| `normal`/`reverse`/`alternate`/`alternate-reverse` | direction | `normal` |
| `none`/`forwards`/`backwards`/`both` | fill mode | `forwards` |
| first `s`/`ms` value | duration | `1000ms` |
| second `s`/`ms` value | delay | `0` |

**Time-value order rule:** first time value is always duration, second always delay, regardless of magnitude. `s` × 1000; `ms` as-is.

### fill-mode (deliberate CSS divergence)

Defaults to **`forwards`** (CSS defaults to `none`) so scenes hold their final frame. The longhand composes by source order like any other sub-property — put it after the shorthand to override the shorthand's fill mode:

```css
#node { animation: fade 1s ease; animation-fill-mode: both; }  /* → both */
```

### No duration sentinel

`1000ms` is a real, author-reachable duration — not an "unset" marker. The builder tracks assignment with a `durationSet` boolean, so `animation: spin 1s linear 1 2s` → duration `1000`, delay `2000`. `iterationCount = Infinity` is the genuine value for `infinite`.

### Negative delay

Supported (standard CSS seek-forward). `animation: slide 1s linear -0.5s` starts already 500ms in.

---

## 12. @keyframes

```css
@keyframes pulse {
  0%   { transform: scale(1);   opacity: 1;   }
  50%  { transform: scale(1.3); opacity: 0.7; }
  100% { transform: scale(1);   opacity: 1;   }
}

@keyframes twinkle {
  0%, 100% { transform: scale(1);   opacity: 1;   }
  50%      { transform: scale(1.6); opacity: 0.5; }
}
```

- Selectors: `from` (=0), `to` (=100), or `<n>%`, normalized to a 0–1 timeline. A multi-selector block takes its first selector's offset.
- **`transform:` in a keyframe is decomposed** into `translateX/translateY/rotate/scaleX/scaleY` so it merges with (not replaces) the base transform.
- A property omitted from a keyframe falls back to the node's authored base value.

### Animatable properties

Numeric (lerp): `translateX`, `translateY`, `rotate`, `scaleX`, `scaleY`, `opacity`, `stroke-width`, `x`, `y`, `width`, `height`, `rx`, `ry`, `cx`, `cy`, `r`, `outer-radius`, `inner-radius`, `rotation`, `stroke-dashoffset`, `trim-start`, `trim-end`, `trim-offset`, `offset-distance`, `font-size`.
Color (rgb/rgba lerp): `fill`, `stroke` (solid colors).
Gradient paint: `fill`, `stroke` — interpolated when endpoints are **compatible** (same gradient type + stop count); otherwise step.
Path shape: **`d` morphs** — interpolated when both keyframe paths have the **same command sequence** (same letters, same order/counts); otherwise step. Trim, fill-rule, hit-testing keep working on the morphing path.
**Not animatable:** `sides` (star/polygon vertex count), `time-offset`, `time-scale`.

```css
@keyframes recolor {          /* gradient stop animation (compatible endpoints) */
  0%   { fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%); }
  100% { fill: linear-gradient(45deg, #ffe66d 0%, #a855f7 100%); }
}
@keyframes blob {             /* path morph — identical command sequence */
  0%   { d: 'M 400 150 C 483 150 550 217 550 300 C 550 383 483 450 400 450 Z'; }
  100% { d: 'M 400 130 C 520 180 580 240 560 320 C 540 400 460 470 380 460 Z'; }
}
```

### Per-keyframe easing & step-end (hold) keyframes

Put `animation-timing-function:` **inside** a keyframe block — controls the transition **from that keyframe to the next**:

```css
@keyframes move {
  0%   { transform: translateX(0);     animation-timing-function: ease-out; }
  50%  { transform: translateX(100px); animation-timing-function: step-end; } /* HOLD */
  100% { transform: translateX(200px); }
}
```

`step-end` holds the *from* value and jumps at the next keyframe. No easing → falls back to the animation-level timing function.

---

## 13. Easing functions

| Name | Curve |
|---|---|
| `linear` | identity |
| `ease` | cubic-bezier(0.25, 0.1, 0.25, 1.0) |
| `ease-in` | cubic-bezier(0.42, 0, 1, 1) |
| `ease-out` | cubic-bezier(0, 0, 0.58, 1) |
| `ease-in-out` | cubic-bezier(0.42, 0, 0.58, 1) |
| `step-end` | hold 0 until t=1, then 1 |
| `cubic-bezier(x1,y1,x2,y2)` | custom (Newton-Raphson solve) |

**`steps()` NOT supported** — only `step-end`.

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
  type: circle; r: 30px; fill: #e94560;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
}
```

Input paths: `cursor.x`, `cursor.y` (canvas-local px), `cursor.isDown` (1/0), `scroll.x`, `scroll.y`, `time` (ms). Unknown → `0`.
**Constraint:** runtime bindings drive **numeric** props only — you cannot bind a color via `var()`/`input()`. Any value containing `var()`/`input()` is deferred to render-time.

### Pseudo-states

```css
#btn {
  type: circle; r: 30px; fill: #e94560;
  &:hover  { fill: #ff6b8a; transform: scale(1.2); }
  &:active { fill: #c73e54; transform: scale(0.9); }
}
```

- Hit-testing uses the inverse world matrix (regions match paint exactly), respects clip regions, returns the topmost interactive node. Groups and mask sources aren't hit-testable.
- State override consumes only `fill`, `stroke`, `stroke-width`, `opacity`, `transform`.
- `active` falls back to `hover` styles if no `&:active` block.
- **Transform overrides layer on top of running animations:** `translate`/`rotate` additive, `scale` multiplicative.

---

## 15. Embedding — `<popcorn-player>`

Auto-registered custom element wrapping a shadow-DOM canvas.

- **Attributes:** `src` (DSL string), `width` (400), `height` (300), `background`, `loop`, `controls`, `autoplay`, `fit`.
  - `loop` (boolean attr) — timeline loops instead of holding the last frame.
  - `controls` (boolean attr) — shows a play/pause + scrubber + time overlay.
  - `autoplay` (boolean attr) — start playing on load.
  - `fit` — how the scene scales into the element box: `contain` (default, letterbox), `cover` (crop to fill), `fill` (stretch per-axis), `none` (1:1, top-left, may clip).
- **JS props:** `source`, `width`, `height`, `background`, `loop`, `currentTime` (ms, read-only).
- **Methods:** `play()`, `stop()`, `reset()`, `pause()` (freezes timeline, keeps interaction), `resume()`, `seek(ms)`.
- **Events:** `ready` (`detail.sceneRoot`), `error` (`detail.error`).

```js
const player = document.querySelector('popcorn-player');
player.source = myDslCode;   // parse + build + play
```

---

## 16. Example scenes

### A. Static composition

```css
:root { width: 800px; height: 600px; background: #0f0f23; }

#redCircle     { type: circle;  cx: 200px; cy: 300px; r: 80px; fill: #e94560; }
#blueRect      { type: rect;    x: 400px; y: 200px; width: 150px; height: 200px;
                 rx: 20px; ry: 20px; fill: #4ecdc4; }
#yellowEllipse { type: ellipse; cx: 650px; cy: 300px; rx: 60px; ry: 100px; fill: #ffe66d; }
#label         { type: text;    content: "Popcorn"; x: 400px; y: 500px;
                 font-size: 48px; font-family: sans-serif; font-weight: bold;
                 text-anchor: middle; fill: #ffffff; }
```

### B. Animated group with keyframes

```css
:root { width: 800px; height: 600px; background: #101020; }

@keyframes pulse {
  0%   { transform: scale(1);   opacity: 1;   }
  50%  { transform: scale(1.3); opacity: 0.7; }
  100% { transform: scale(1);   opacity: 1;   }
}
@keyframes spin {
  0%   { transform: rotate(0deg);   }
  100% { transform: rotate(360deg); }
}

#pulser {
  type: circle; cx: 200px; cy: 300px; r: 60px; fill: #e94560;
  animation: pulse 1.5s ease-in-out infinite;
}
#spinner {
  type: group;
  transform: translate(600px, 300px);
  animation: spin 3s linear infinite;
  > #blade {
    type: rect; x: -50px; y: -10px; width: 100px; height: 20px;
    fill: #4ecdc4; transform-origin: center;
  }
}
```

### C. Symbols, motion path, and interactivity

```css
:root {
  width: 800px; height: 600px; background: #0a0a1a;
  --cursor-x: input(cursor.x);
  --cursor-y: input(cursor.y);
}

@keyframes twinkle {
  0%, 100% { transform: scale(1);   opacity: 1;   }
  50%      { transform: scale(1.6); opacity: 0.4; }
}
@keyframes travel {
  0%   { offset-distance: 0%;   animation-timing-function: ease-in-out; }
  100% { offset-distance: 100%; }
}

@define star {
  type: circle; r: 8px; fill: #fbbf24;
  transform-origin: center;
  animation: twinkle 2s ease-in-out infinite;
}

#star1 { use: star; cx: 200px; cy: 120px; }
#star2 { use: star; cx: 400px; cy: 120px; fill: #60a5fa; }
#star3 { use: star; cx: 600px; cy: 120px; fill: #f472b6; }

#comet {
  type: circle; r: 12px; fill: #ffffff;
  offset-path: path('M0 400 C200 200 600 200 800 400');
  offset-rotate: auto;
  animation: travel 4s linear infinite;
}

#follower {
  type: circle; r: 30px; fill: #e94560;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
  &:hover  { fill: #ff6b8a; transform: scale(1.2); }
  &:active { fill: #c73e54; transform: scale(0.9); }
}
```

---

## 17. Gotchas cheat-sheet

- **`type:` omitted → `group`.** Only the `type:` declaration picks a shape; no selector does.
- **`fill` and `stroke` default to `none`** — `stroke-width: 1` alone paints nothing.
- **fill-mode defaults to `forwards`**, not CSS's `none`.
- **1000ms duration is real**, not a sentinel; the second shorthand time value is always the delay.
- **`infinite` = ∞ iterations**.
- **Rotation lerps linearly** (no shortest-arc) — intentional for full-turn spins.
- **Unsupported (parse but do nothing):** `skew`, blend modes, `steps()`, `object-fit`, `text-align`/`line-height`/`letter-spacing`, `href`/`src` (use `content: url()`), `points` (use `sides`).
- **`var()`/`input()` bind numbers only** — colors can't be bound at runtime.
- **Gradients + path `d` ARE animatable** — but only between *compatible* endpoints (same gradient type/stop count; identical path command sequence); incompatible pairs step instead of interpolate.
- **`opacity` cascades** to descendants (group opacity dims its whole subtree).
- **`time-scale`/`time-offset`** retime a node + its subtree (precomp-style); static, must be `> 0` for scale.
- **Paint order = document order**, override with `z-index` (negatives allowed); it also sets hit-test priority.
- **`visible-from`/`visible-until`** gate a node + subtree to a scene-local time window (skipped in render *and* hit-test outside it).
- **Geometry props are type-gated** — `r` on a rect is ignored, etc.
- Unrecognized enum keywords silently fall back to the default.
- **No `//` comments, no `.5` numbers, no exponents** (`0.5`, not `.5`).

---

## Source files

- Parser & AST: `packages/popcorn-parser/src/{parser,ast,parser.test}.ts`
- Scene builder & types: `packages/popcorn-player/src/scene/{builder,types,transform,polystar,clip,path-parser}.ts`
- Renderer: `packages/popcorn-player/src/renderer/{canvas2d,types,interface}.ts`
- Animation: `packages/popcorn-player/src/animation/{easing,keyframes,scheduler,registry}.ts`
- Runtime & component: `packages/popcorn-player/src/runtime/{loop,inputs,variables,interaction,hit-test}.ts`, `component.ts`
- Examples: `examples/*.css`, `examples/lottie/*.css`
- Lottie converter: `tools/lottie2popcorn.ts`
