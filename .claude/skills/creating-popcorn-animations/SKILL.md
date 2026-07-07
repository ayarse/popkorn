---
name: creating-popcorn-animations
description: Use when authoring or editing a Popcorn scene (.css DSL for @popcorn/player) — writing shapes, keyframe animations, symbols, motion paths, masks/mattes, or interactive scenes in this repo's CSS-subset animation language.
---

# Creating Popcorn Animations

## Overview

Popcorn is a **CSS-subset DSL** that compiles to a 2D scene graph and plays on Canvas.
It looks like CSS but is NOT CSS — the parser accepts any `property: value`, and meaning
is assigned at build time. **Unknown properties parse fine and are silently ignored.** So
the danger isn't syntax errors; it's authoring valid-looking declarations that do nothing.

Pipeline: `source → parse() → StyleSheet AST → buildSceneGraph() → RenderLoop → Canvas2D`.

**Full spec: [reference.md](reference.md). Read it before using any feature not shown below.**

## Workflow

1. Start with `:canvas { width; height; background }` (only hex colors register here).
2. Give every node an `#id` and a `type:` declaration. **No `type:` → it's a `group`.**
3. Set geometry (props are type-gated: `r` only on circle, `cx/cy` on circle/ellipse/star/polygon…).
4. Set paint: `fill` and `stroke` **both default to `none`** — a shape with only `stroke-width` shows nothing.
5. Animate via `@keyframes name {…}` + the `animation:` shorthand. Longhands are no-ops (except `animation-fill-mode`).
6. Verify by parsing (see below) — the parser won't catch dead properties, so cross-check names against reference.md.

## Quick reference

| Need | Syntax |
|---|---|
| Stage | `:canvas { width: 800px; height: 600px; background: #0f0f23; }` |
| Shapes | `type:` `rect`(x,y,width,height,rx,ry) · `circle`(cx,cy,r) · `ellipse`(cx,cy,rx,ry) · `path`(d) · `star`/`polygon`(points,outer-radius,inner-radius) · `text` · `image` · `group` |
| Paint | `fill`/`stroke` (hex, `rgb()`, `linear-gradient()`, named color, `none`); `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, `fill-rule`, `opacity` |
| Transform | `transform: translate(x,y) rotate(45deg) scale(1.2)` · `transform-origin: center` (**no skew**) |
| Animate | `animation: <name> <dur> <easing> <count> <dir> <delay>` e.g. `pulse 1.5s ease-in-out infinite` |
| Keyframes | `@keyframes n { 0% {…} 50% {…} 100% {…} }` (`transform:` decomposes & merges) |
| Per-kf easing / hold | `animation-timing-function: ease-out` (or `step-end`/`hold`) **inside** a keyframe block — eases the segment *from that keyframe to the next* |
| Easings | `linear ease ease-in ease-out ease-in-out step-end/hold cubic-bezier(…)` (**no `steps()`**) |
| Symbols | `@define name {…}` then `#x { use: name; cx: …; fill: … }` (use-site overrides) |
| Nesting | `> #child { … }` inside a rule body |
| Interactivity | `:root { --cx: input(cursor.x) }` + `cx: var(--cx)` (numbers only); `&:hover {…}` `&:active {…}` |
| Motion path | `offset-path: path('…'); offset-distance: 50%; offset-rotate: auto` (animate `offset-distance`) |
| Mask / matte | `clip-path: circle(80 at 200 200)` · `matte: #layer alpha` |
| Gradient/path animation | animate `fill: linear-gradient(…)` (same type + stop count) or `d: 'M…'` (same command sequence) in `@keyframes`; incompatible endpoints step |
| Retime subtree | `time-offset: 2s; time-scale: 0.5` on a group — shifts + scales that node and all descendants (precomp-style; static) |
| Group opacity | cascades: `opacity` on a group dims its whole subtree |
| Paint order | siblings paint in document order; override with `z-index: <int>` (negatives allowed; also sets hit-test priority) |
| Visibility window | `visible-from: 1s; visible-until: 3s` — show node + subtree only in that scene-local window |
| Embed options | `<popcorn-player loop controls autoplay fit="contain">` (`fit`: contain/cover/fill/none) |

## Common mistakes

- **Shape invisible** → `fill` defaults to `none`. Set a fill (or stroke *color*, not just width).
- **`type:` forgotten** → node becomes a `group` (nothing draws). Always declare `type:`.
- **Property does nothing** → it's likely unsupported (`skew`, `mix-blend-mode`, `steps()`, `object-fit`, `text-align`, `href`, `sides`, `line-height`). Parses silently, no effect. Check reference.md §17.
- **Wrong geometry prop for the type** → silently ignored (`r` on a rect, `x` on a circle).
- **`.5` or `//` comments** → invalid. Write `0.5`; use `/* */` only.
- **Animating a color via `var()`** → not supported; `var()`/`input()` bind numeric props only. (Solid colors, gradient stops, and path `d` *do* animate in `@keyframes` — gradients/paths only between compatible endpoints; see reference.md §12.)
- **fill-mode surprise** → Popcorn defaults to `forwards` (holds final frame), unlike CSS's `none`.

## Verify a scene parses

```bash
bun --filter @popcorn/parser test        # AST contract tests
# Or parse ad-hoc: import { parse } from '@popcorn/parser'; parse(source)
```

Live-preview a scene by loading it into a `<popcorn-player>` element (see reference.md §15) via `bun run dev`.
