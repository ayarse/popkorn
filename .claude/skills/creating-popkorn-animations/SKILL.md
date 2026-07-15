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

**Full spec: [reference.md](reference.md). Read it before using any feature not shown below.**

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

1. Start with `:root { width; height; background }` (only hex colors register here; custom `--props` live here too).
2. Give every node an `#id` and a `type:` declaration. **No `type:` → it's a `group`.**
3. Set geometry (props are type-gated: `r` only on circle, `cx/cy` on circle/ellipse/star/polygon…).
4. Set paint: `fill` and `stroke` **both default to `none`** — a shape with only `stroke-width` shows nothing.
5. Animate via `@keyframes name {…}` + the `animation:` shorthand (or the `animation-*` longhands, which compose per CSS: later declarations win per sub-property).
6. Verify by parsing (see below) — the parser won't catch dead properties, so cross-check names against reference.md.

## Quick reference

| Need | Syntax |
|---|---|
| Stage | `:root { width: 800px; height: 600px; background: #0f0f23; }` |
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
| Nesting | `> #child { … }` inside a rule body |
| Interactivity | `:root { --cx: input(cursor.x) }` + `cx: var(--cx)`; `&:hover {…}` `&:active {…}`; `cursor: pointer` (pointer cursor on hover); clicks emit a `popkorn:click` DOM event (`detail.{id,path,x,y}`, no opt-in) |
| Typed `var()` | `--brand: #e94560` / `--label: "Score"` / `--n: 30px` then `fill: var(--brand)` / `content: var(--label)` / `r: var(--n)` — numeric interpolates, color/string snap (discrete); `input()` stays numeric-only |
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

## Common mistakes

- **Shape invisible** → `fill` defaults to `none`. Set a fill (or stroke *color*, not just width).
- **`type:` forgotten** → node becomes a `group` (nothing draws). Always declare `type:`.
- **Property does nothing** → it's likely unsupported (`skew`, `object-fit`, `href`, `points`). Parses silently, no effect. Check reference.md §17. (`mix-blend-mode`, `text-align`, `line-height`, `letter-spacing`, `border-radius`, `box-shadow` all **do** work now.)
- **Wrong geometry prop for the type** → silently ignored (`r` on a rect, `x` on a circle).
- **`.5` or `//` comments** → invalid. Write `0.5`; use `/* */` only.
- **A color bound via `var()` doesn't tween** → it snaps instead of interpolating (the color-binding path re-resolves rather than lerping); numeric `var()`/`input()` still interpolate normally. (Solid colors, gradient stops, and path `d` *do* animate in `@keyframes` — gradients/paths only between compatible endpoints; see reference.md §12.)
- **`letter-spacing` looks fine on web but does nothing on RN/Skia** — pinned backend divergence, not a bug.
- **fill-mode surprise** → Popkorn defaults to `forwards` (holds final frame), unlike CSS's `none`.

## Verify a scene parses

```bash
bun --filter @popkorn/parser test        # AST contract tests
# Or parse ad-hoc: import { parse } from '@popkorn/parser'; parse(source)
```

Live-preview a scene by loading it into a `<popkorn-player>` element (see reference.md §15) via `bun run dev`.
