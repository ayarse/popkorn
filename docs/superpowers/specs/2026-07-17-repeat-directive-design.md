# `repeat:` — instancing directive

Design spec, approved 2026-07-17. Companion features: `random()` (CSS Values 5
§9, in flight) and the calc math functions (`round`/`mod`/`rem`/`abs`/`sign`,
landed). Together these give Popkorn Lottie's generative core — Repeater +
random/index expressions — as declarative CSS.

## Decision summary

- **Scope: authoring-only.** `repeat:` is not a Lottie `rp` import target; `rp`
  stays deliberately blocked (shipping players skip it too). No accumulating
  `repeat-transform`, no opacity ramp, no composite-order syntax.
- **Variation lives outside the directive.** `repeat:` stamps identical
  copies; `sibling-index()` / `sibling-count()` (CSS Values 5 §10) and
  `random(per-element)` differentiate them via ordinary property formulas.
- **Copies are real nodes, expanded at build time, with derived targetable
  ids.**

## Syntax & semantics

```css
#field { use: dot; repeat: 150; }        /* with a symbol */
#tick  { type: rect; width: 2px; height: 8px; repeat: 60; }  /* or any node */
```

- `repeat: <positive-integer>` on any node rule. Not tied to `use:`; composes
  with it.
- The node is stamped N times as consecutive siblings at its declared position
  in document order.
- `repeat: 1` ≡ absent. `0`, negative, or non-integer → build diagnostic
  (hide with `display: none`, don't repeat zero times).
- The count is **structural**: folded at build time (like `use:` resolution).
  Literal `var()`/`calc()` allowed; reactive `input()` rejected with a
  diagnostic — node count cannot vary per frame (the render walk is a pure
  function of time over a fixed tree).
- `repeat:` inside `@define` → diagnostic. Count is instance context; the
  definition stays a pure template.

## Expansion model

Build-time, in `buildSceneGraph`, immediately after `use:` merge: one declared
rule → N real `SceneNode`s. The render loop, transform math, animation
sampling, and hit-testing are untouched — they see ordinary nodes. The entire
feature lives in the scene builder.

Nested repeats need no special casing: a `repeat:`ed node inside a
`repeat:`ed subtree expands multiplicatively as a natural consequence of
walking the expanded tree. (Covered by a test, not extra design.)

## Identity

Copies derive ids from the declared id: `#field` → `field-1` … `field-N`
(1-based, matching `sibling-index()`).

- `popkorn:click` on copy 37 reports `id: "field-37"` (path likewise uses the
  derived id).
- A rule `#field-3 { fill: red }` matches copy 3 and applies as an ordinary
  per-node override — same precedence as any use-site override, no new
  machinery.
- `random(per-element)` seeds off the derived id, so each copy rolls
  independently for free.
- **Descendants re-suffix too:** every id inside the stamped subtree gets the
  same copy suffix (`#field-2`'s child `#arm` becomes `#arm-2`), keeping child
  ids unique, per-copy child targeting possible, and `random(per-element)`
  seeds distinct throughout the subtree.
- An explicitly-declared node whose id collides with a derived id
  (`#field-3 { … }` declared as its own node while `#field` repeats ≥3) →
  build diagnostic. Same rule for descendant-derived ids.

## Variation idioms (documentation, not mechanism)

```css
/* row */      cx: calc(100px + sibling-index() * 50px);
/* ring */     cx: calc(400px + cos(sibling-index() / sibling-count() * 6.2832) * 180px);
/* grid */     cx: calc(mod(sibling-index() - 1, 10) * 40px);
               cy: calc(round(down, (sibling-index() - 1) / 10) * 40px);
/* stagger */  animation-delay: calc(sibling-index() * -0.15s);
/* jitter */   translate: random(per-element, -8px, 8px) random(per-element, -8px, 8px);
/* reverse stacking */ z-index: calc(0 - sibling-index());
```

`sibling-index()` counts **all** siblings (spec semantics), so the idiom is to
give a repeated family its own parent group. It resolves at build time —
structural, foldable into constants, valid in structural props.

## Paint order, hit-testing, animation

All existing semantics, no additions: copies are siblings in document order;
per-copy `z-index` participates in the stable sibling sort; hit-testing is the
existing reverse-paint-order walk; each copy independently carries the
declared rule's animations (stagger via the negative-delay idiom above).

## Limits & diagnostics

- Count cap 10 000 (diagnostic above it) — a typo'd count must not OOM.
- Diagnostics: bad count (0/negative/non-integer/reactive), derived-id
  collision, `repeat:` in `@define`, count over cap.

## Testing

Builder tests: expansion count and order; derived ids; `sibling-index()`
values in a mixed-sibling parent; per-copy override precedence; `use:` +
`repeat:` composition; nested repeat multiplicativity; `random(per-element)`
distinctness across copies; every diagnostic above. One gallery scene as the
living example (starfield, or the scene-21 particle rewrite).

## Out of scope

Lottie `rp` mapping and any future `repeat-transform` sugar; time-varying
count; `repeat` on `:root`.
