# Popcorn — Concept & Origin

> Historical design doc: the *why* behind Popcorn and the original
> proof-of-concept (v0.1, January 2025). For how the system works today see
> [ARCHITECTURE.md](ARCHITECTURE.md); for the language see [DSL.md](DSL.md).

## What we set out to build

A CSS-like declarative language for interactive, real-time motion graphics that
renders directly to screen — **"CSS Animations, but for a proper scene graph
with real-time interactivity."**

## The gap it fills

Existing options each miss something:

| Approach | Pros | Cons |
|----------|------|------|
| **Lottie** | Designer-friendly, wide ecosystem | Playback only, no real-time interaction; JSON is machine-generated and opaque |
| **Game engines** | Full interactivity, physics, constraints | Heavy, complex, overkill for UI motion |
| **CSS Animations** | Familiar syntax, declarative | Tied to the DOM, no scene graph |
| **Rive** | Interactive, cross-platform | Proprietary editor, closed format |

The gap: a lightweight, declarative solution with familiar CSS-like syntax, a
true scene graph with parent-child transforms, real-time input binding (cursor,
touch, scroll), and direct rendering — in a format a human (or an LLM) can
author, read, and diff.

## The original bet

Prove the concept with a minimal, dependency-free pipeline:

```
CSS-like source → Parser → AST → Scene Graph → Renderer → Canvas
```

Two design choices from day one still hold:

- **Canvas 2D, zero dependencies.** No WASM build step; works in any browser.
  The `Renderer` interface was kept deliberately abstract (a ThorVG-style shape
  API) so a cross-platform backend could slot in later without touching the
  scene graph.
- **Hand-rolled parser.** The DSL is a CSS subset, so `parse(source)` turns
  source straight into a typed AST synchronously — no parser framework.

## What it became

The PoC's three original phases — static rendering, `@keyframes` animation, and
cursor/`input()` bindings — all landed, and the format grew well past them:
vector paths, gradients, text, images, symbols, clipping and track mattes, trim
paths and dashes, path morphing, motion paths, per-subtree time scoping,
z-index layering and visibility windows, plus a Lottie importer. The old PoC
"not yet supported" list is entirely obsolete — see [DSL.md](DSL.md) for the
current surface and [ARCHITECTURE.md](ARCHITECTURE.md) for the pipeline.

## References

- [ThorVG](https://github.com/thorvg/thorvg) — renderer-interface style reference
- [Canvas 2D API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)
- [CSS Animations Spec](https://www.w3.org/TR/css-animations-1/)
- [Lottie Format](https://lottiefiles.github.io/lottie-docs/)
- [Rive](https://rive.app/)
