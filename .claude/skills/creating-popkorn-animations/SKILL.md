---
name: creating-popkorn-animations
description: Use when authoring or editing a Popkorn scene (.css DSL for @popkorn/player) — writing shapes, keyframe animations, symbols, motion paths, masks, or interactive scenes in this repo's CSS-subset animation language.
---

# Creating Popkorn Animations

## Overview

Popkorn is a **CSS-subset DSL** that compiles to a 2D scene graph and plays on Canvas.
It looks like CSS but is NOT CSS — the parser accepts any `property: value`, and meaning
is assigned at build time. **Unknown properties parse fine and are silently ignored.** So
the danger isn't syntax errors; it's authoring valid-looking declarations that do nothing.

Pipeline: `source → parse() → StyleSheet AST → buildSceneGraph() → RenderLoop → Canvas2D`.

<!-- repo-only -->
**Full spec: [reference.md](reference.md). Read it before using any feature not shown below.**
<!-- /repo-only -->

**No box model, ever** — permanent, not a gap. No `position`/`margin`/
`padding`/flex/grid, and no `::before`/`::after`. Workarounds:

- `left`/`top` → `x`/`y` (or `cx`/`cy`) — literal coordinates, not flow.
- `margin`/`padding` → arithmetic on the child's own coordinates (e.g. a
  "16px padding" is just `x: 16px; y: 16px` on the inner shape).
- Centering → compute it: `(parentWidth - childWidth) / 2`, no `auto`.
- Rows/columns → fixed-stride positions per child (`x: i * stridePx`), or
  give a `group` a `transform: translate(...)` per row/column and keep each
  child's geometry local to `(0,0)`.
- Stacking → document order (later sibling paints on top), override with
  `z-index: <int>` (negatives allowed).
- Pseudo-elements (`::before`/`::after`) → a named `> #child` shape instead
  of a pseudo-selector.
- Repeated decoration (the CSS `box-shadow`-stamping trick) → `@define` the
  shape once, then multiple `use:` instances, each overriding only what
  differs (position, fill, etc.) — real, independently animatable copies.

## Workflow

1. Start with `:root { width; height }` (custom `--props` live here too). Leave `background` off — the stage is transparent by default, which is what embeds want; add one (a color value) only when the design needs a backdrop.
2. Give every node an `#id` and a `type:` declaration. **No `type:` → it's a `group`.**
3. Set geometry (props are type-gated: `r` only on circle, `cx/cy` on circle/ellipse/star/polygon…).
4. Set paint: `fill` and `stroke` **both default to `none`** — a shape with only `stroke-width` shows nothing.
5. Animate via `@keyframes name {…}` + the `animation:` shorthand (or the `animation-*` longhands, which compose per CSS: later declarations win per sub-property).
6. Verify by parsing (see below) — the parser won't catch dead properties, so cross-check names against reference.md.
7. Look at it: render the key poses (rest, each motion extreme, any reveal) and fix what you see — gaps between parts that should meet, wrong paint order, clipped or lopsided composition, stiff poses. Parsing clean says nothing about how it looks.

## Quick reference

| Need | Syntax |
|---|---|
| Stage | `:root { width: 800px; height: 600px; }` — transparent; `background: #0f0f23` only if a backdrop is wanted |
| Shapes | `type:` `rect`(x,y,width,height,rx,ry) · `circle`(cx,cy,r) · `ellipse`(cx,cy,rx,ry) · `path`(d) · `star`/`polygon`(sides,outer-radius,inner-radius) · `text` · `image` · `group` |
| Paint | `fill`/`stroke` (hex, `rgb()`, `linear-gradient()`, named color, `none`); `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, `fill-rule`, `opacity` |
| `border-radius` | 1 value → uniform `rx`/`ry`; 2–4 values → CSS corner shorthand, expands to animatable `border-top-left-radius` etc. (rect only; no elliptical `/` form) |
| `box-shadow` | `[inset] dx dy [blur] [spread] [color]`, comma-separated multi-shadow, animatable; `spread` only inflates `rect`/`circle`/`ellipse` (paths ignore it) |
| `mix-blend-mode` | all 16 CSS keywords, per-shape (no group isolation), static |
| Transform | `transform: translate(x,y) rotate(45deg) scale(1.2)` · `transform-origin: center` (**no skew**) |
| Individual transforms | `translate: 40px 10px` · `rotate: 45deg` · `scale: 1.2` (same channels as `transform:`, last-wins) |
| Animate | `animation: <name> <dur> <easing> <count> <dir> <delay>` e.g. `pulse 1.5s ease-in-out infinite` |
| Keyframes | `@keyframes n { 0% {…} 50% {…} 100% {…} }` (`transform:` decomposes & merges) |
| Per-kf easing / hold | `animation-timing-function: ease-out` (or `step-end`, `steps(3, jump-end)`) **inside** a keyframe block — eases the segment *from that keyframe to the next* |
| Composite | `animation-composition: add` (longhand only, not in shorthand) — adds numeric channels onto the base pose; color/path fall back to replace |
| Easings | `linear ease ease-in ease-out ease-in-out step-start step-end cubic-bezier(…) steps(<n>, <pos>) linear(<stops>)` |
| Spring/bounce | `linear(0, 1 33%, 0.55 46%, 1 62%, 0.78 74%, 1)` — overshoot control points fake physics with 2 keyframes |
| Symbols | `@define name {…}` then `#x { use: name; cx: …; fill: … }` (use-site overrides) |
| Repeat / instancing | `repeat: <int>` on any node stamps N sibling copies with derived ids `#field` → `field-1`…`field-N` (descendants re-suffix too); composes with `use:`, nests multiplicatively. Static count only (no `input()`); `repeat: 1` ≡ absent. Differentiate copies with `sibling-index()` / `sibling-count()` (1-based position / total among **all** siblings, so give a repeated family its own group) or `random(per-element)` — e.g. `cx: calc(sibling-index() * 40px)`, `animation-delay: calc(sibling-index() * -0.1s)`. See reference.md §Repeat & sibling math |
| Nesting | `> #child { … }` inside a rule body |
| Interactivity | `:root { --cx: input(cursor.x) }` + `cx: var(--cx)`; `&:hover {…}` `&:active {…}`; `cursor: pointer` (pointer cursor on hover); clicks emit a `popkorn:click` DOM event (`detail.{id,path,x,y}`, no opt-in) |
| Typed `var()` | `--brand: #e94560` / `--label: "Score"` / `--n: 30px` then `fill: var(--brand)` / `content: var(--label)` / `r: var(--n)` — numeric interpolates, color/string snap (discrete); `input()` stays numeric-only |
| Random constant | `random([per-element \|\| --ident]?, <min>, <max>[, by <step>])` — a **fixed** roll frozen at build (not live noise), any number/`calc()` operand; carries min/max unit. Default = one shared roll; `per-element` rolls per instance (particles); `--ident` correlates calls; deterministic from source. See reference.md §3 |
| Text | `text-align: center` (maps to `text-anchor`) · `letter-spacing: 2px` (animatable; no-op on RN/Skia) · `line-height: 1.4` (animatable) · `content: "a\nb"` for multi-line (`\n \r \t \" \\` unescape) |
| Transitions | `transition: fill 0.3s ease, transform 0.2s` — state flips tween (enter+exit) instead of snapping; runtime-only, timeline stays pure |
| State machines | `@machine m { initial: off; state off { to: on on click(#btn) } state on { to: off on click(#btn) } }` + `#btn:state(on) { animation: … }` — named states that outlive the pointer (toggles, sequences, timeouts); `:state()` can start `animation:` (the jump over `:hover`). See reference.md §14, examples 11/12 |
| Scrubbing | `animation-timeline: var(--progress)` or `input(scroll.progress)` — drive an animation by a 0..1 value instead of the clock |
| Filters | `filter: blur(12px)` (radius animatable in `@keyframes`) · `filter: blur(2px) drop-shadow(4px 6px 8px rgba(0,0,0,.4))` (drop-shadow static); applies to node + subtree |
| Motion path | `offset-path: path('…'); offset-distance: 50%; offset-rotate: auto` (animate `offset-distance`) |
| Mask | `clip-path: circle(80 at 200 200)` · `mask: #layer alpha` |
| Gradient/path animation | animate `fill: linear-gradient(…)` (same type + stop count) or `d: 'M…'` (same command sequence) in `@keyframes`; incompatible endpoints step |
| Retime subtree | `time-offset: 2s; time-scale: 0.5` on a group — shifts + scales that node and all descendants (precomp-style; static) |
| Group opacity | cascades: `opacity` on a group dims its whole subtree |
| Paint order | siblings paint in document order; override with `z-index: <int>` (negatives allowed; also sets hit-test priority) |
| Visibility window | `visible-from: 1s; visible-until: 3s` — show node + subtree only in that scene-local window |
| Embed options | `<popkorn-player loop controls autoplay fit="contain">` (`fit`: contain/cover/fill/none) |

## Motion craft: make it feel designed

Stiff motion comes from defaults: one transform per element, evenly spaced
keyframes, `ease-in-out` everywhere, everything on one shared clock, rigid
shapes. Plan like an animator before writing keyframes:

1. **Beats, not one repeated move.** Split the cycle into anticipation →
   action → follow-through → settle → hold, each with its own time range.
   Land the main event around a quarter to a third in, and leave a short rest
   so the loop breathes. Everything else reacts to that event.
2. **Hierarchy and overlap.** The parent moves first. Children echo it later
   and smaller: the same keyframes with a 0.03–0.1s `animation-delay`, or their
   own lagging swing. Loose parts (ornaments, ears, tails, hair, bells) trail
   the parent and overshoot it: a small `rotate` spring around their attach
   point, or a tiny looping `offset-path`.
3. **Easing carries the physics.** Set `animation-timing-function` per
   keyframe: fast-out launches `cubic-bezier(0.2, 0, 0, 1)`, falls
   `cubic-bezier(0.5, 0, 1, 1)`, and overshoot or wind-up inside the curve
   (y outside 0–1: `cubic-bezier(0.34, 1.56, 0.64, 1)` overshoots,
   `cubic-bezier(0.36, -0.6, 0.7, 0)` winds up first) instead of extra
   keyframes. Space keyframes unevenly; a segment's length matches the move's
   size and weight.
4. **Squash and stretch keep volume**: `scale(1.12, 0.88)`, never
   `scale(1.12, 1)`. Pivot at the contact point (feet, base), not the center.
5. **Soft things deform.** Cloth, hems, blobs, mouths: animate `d` between
   poses drawn as copies of one path (same command list, moved points). A
   rigidly rotated soft shape reads as cardboard.
6. **Reveal with masks, not paint order.** Something peeking from behind a
   cover gets `mask: #cover alpha-invert` (or a `clip-path`), so it is hidden
   exactly where the cover is at every angle.
7. **No two alike.** Vary amplitude, delay and period per element
   (`random(per-element, …)`, `sibling-index()` staggers, co-prime idle
   periods like 3s and 3.7s). Synchronized identical motion reads mechanical.
8. **Accents on the beat.** Secondary motion punctuates the main event: a
   blink, a mouth change, a squash on landing, sparkles popping
   (scale 0 → 1 → 0 with a spin, 0.5–0.7s, staggered).
9. **Faces act.** Blink by collapsing eye height, keep pupils inside the eye
   with `mask`, morph the mouth between expressions, glance at the action.

Drawing like an illustrator:

- Silhouettes are custom `path`s with tapered, slightly asymmetric Béziers.
  Keep `rect`/`circle` for things that really are geometric.
- One light direction: gradients with explicit `from … to`, balls with an
  offset highlight (`radial-gradient(circle 30px at 0px 0px from -10px -10px,
  #fff6b0, #e3cb00 90%)`), a cast shadow where one part overlaps another.
- Compose, don't center: overlap objects, vary sizes, let supporting pieces
  crop off the stage edge, give the focal element room.
- Patterns (stripes, dots) are shapes clipped to their container with
  `clip-path: path('…')` in the container's local coordinates.

The core moves in one piece (a hop with wind-up, squash on landing, a
lagging hat, and a mouth that morphs):

```css
@keyframes hop {
  0% { transform: translate(0px, 0px) scale(1, 1); animation-timing-function: cubic-bezier(0.36, -0.6, 0.7, 0); }
  18% { transform: translate(0px, 0px) scale(1.14, 0.86); animation-timing-function: cubic-bezier(0.2, 0, 0, 1); }
  42% { transform: translate(0px, -110px) scale(0.9, 1.12); animation-timing-function: cubic-bezier(0.5, 0, 1, 1); }
  60% { transform: translate(0px, 0px) scale(1.2, 0.8); animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }
  76% { transform: translate(0px, 0px) scale(1, 1); }
  100% { transform: translate(0px, 0px) scale(1, 1); }
}
@keyframes hat-lag {
  0% { transform: rotate(0deg); }
  20% { transform: rotate(0deg); }
  34% { transform: rotate(-16deg); }
  50% { transform: rotate(10deg); }
  66% { transform: rotate(-12deg); }
  82% { transform: rotate(4deg); }
  100% { transform: rotate(0deg); }
}
@keyframes grin {
  0% { d: 'M -14 0 Q 0 8 14 0'; }
  30% { d: 'M -14 0 Q 0 8 14 0'; }
  45% { d: 'M -18 -2 Q 0 20 18 -2'; }
  70% { d: 'M -18 -2 Q 0 20 18 -2'; }
  90% { d: 'M -14 0 Q 0 8 14 0'; }
  100% { d: 'M -14 0 Q 0 8 14 0'; }
}
#blob {
  transform: translate(240px, 320px);
  > #blob-hop {
    animation: hop 2.4s infinite;
    > #body { type: path; d: 'M -60 0 C -64 -58 -34 -96 0 -96 C 36 -96 62 -56 58 0 Z'; fill: linear-gradient(from -40px -90px to 40px 0px, #7ee0c3, #1f9b86); }
    > #mouth { type: path; d: 'M -14 0 Q 0 8 14 0'; transform: translate(0px, -34px); fill: none; stroke: #173a33; stroke-width: 4; stroke-linecap: round; animation: grin 2.4s infinite; }
    > #hat {
      transform: translate(4px, -94px);
      > #hat-swing {
        animation: hat-lag 2.4s ease-out infinite;
        animation-delay: 0.05s;
        > #hat-shape { type: path; d: 'M -26 0 L 22 0 L 2 -54 Z'; fill: #ff5a3c; }
      }
    }
  }
}
```

## Common mistakes

- **Shape invisible** → `fill` defaults to `none`. Set a fill (or stroke *color*, not just width).
- **`type:` forgotten** → node becomes a `group` (nothing draws). Always declare `type:`.
- **Property does nothing** → it's likely unsupported (`skew`, `object-fit`, `href`, `points`). Parses silently, no effect. Check reference.md §17.
- **Wrong geometry prop for the type** → silently ignored (`r` on a rect, `x` on a circle).
- **`.5` or `//` comments** → invalid. Write `0.5`; use `/* */` only.
- **A color bound via `var()` doesn't tween** → it snaps instead of interpolating (the color-binding path re-resolves rather than lerping); numeric `var()`/`input()` still interpolate normally. (Solid colors, gradient stops, and path `d` *do* animate in `@keyframes` — gradients/paths only between compatible endpoints; see reference.md §12.)
- **`letter-spacing` looks fine on web but does nothing on RN/Skia** — pinned backend divergence, not a bug.
- **fill-mode surprise** → Popkorn defaults to `forwards` (holds final frame), unlike CSS's `none`.
- **A pose drifts through a keyframe it should hold** → each transform channel (`translateX/Y`, `rotate`, `scaleX/Y`) animates off only the keyframes that set it, so `0% { transform: translate(0px, 0px) }  20% { transform: scale(1.2, 0.8) }  40% { transform: translate(0px, -100px) }` starts rising at 0%, not 20%. Restate every channel a keyframe must pin (`translate(0px, 0px) scale(1.2, 0.8)`).
- **`0%, 20% { … }` holds nothing** → unlike CSS, a multi-selector keyframe block takes only its first offset. Write the hold as two blocks with the same values.

<!-- repo-only -->
## Verify a scene parses

```bash
bun --filter @popkorn/parser test        # AST contract tests
# Or parse ad-hoc: import { parse } from '@popkorn/parser'; parse(source)
```

Live-preview a scene by loading it into a `<popkorn-player>` element (see reference.md §15) via `bun run dev`.
<!-- /repo-only -->
