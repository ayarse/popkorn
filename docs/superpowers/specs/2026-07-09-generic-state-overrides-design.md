# Generic state-block overrides (registry-backed :hover/:active/:state())

**Date:** 2026-07-09
**Status:** approved

## Problem

State blocks (`:hover`/`:active`/`:state()`) and `transition` can only touch a
hardcoded set of 6 properties (`fill`, `stroke`, `stroke-width`, `opacity`,
`transform`), while `@keyframes` animates the full `PROPERTY_REGISTRY` set
(~26 props). The gap is a parallel hand-maintained list in `StateStyles` /
`buildStateStyles` / `LiveValues`. CSS has one shared "animatable" notion for
both keyframes and transitions; Popcorn should too, with the registry as the
single source of truth.

## Design

Two stages, shipped separately so the delicate tween refactor never rides in
the same diff as the parser change.

### Stage 1 — generic instant overrides

- `StateStyles` keeps its existing fields **untouched** and gains
  `overrides?: Record<string, PropValue>` for everything else. (The 6 legacy
  fields migrate into the map in stage 2, not now — keeps the tween path
  untouched so stage 1 cannot regress it.)
- `buildStateStyles` default case: `getPropHandler(prop)` found → parse the
  value the same way keyframes do (reuse/factor `buildKeyframeProperties`'s
  per-property switch, builder.ts ~1450) and store in `overrides`. Not found →
  keep the "unknown property" warning. The "`animates via @keyframes but is
  not overridable`" warning is **deleted** — that gap is what this closes.
- `applyStateStyles` ends with: for each override entry,
  `getPropHandler(key).apply(node, value)`. Registry handlers already set
  dirty flags (outline length, polystar, text bounds) — invariant #3 keeps
  caches correct for free.
- Overrides re-apply every frame after base-reset (resolution-order invariant
  #2), so releasing hover snaps back automatically. No new state.
- Composition: `overrides` **replace** (CSS semantics, same as fill today);
  `transform` stays the existing **delta** model (deliberate divergence,
  unchanged).
- A handler that no-ops on the node's shape (e.g. `r` on a group) is inert,
  same as keyframes — acceptable; no per-node warning.
- Interim: `transition: r 200ms` snaps in stage 1 (tween doesn't read the map
  yet).

### Stage 2 — generic transitions

- Replace the fixed `LiveValues` snapshot in `runtime/interaction.ts` with a
  registry-driven one: numeric props captured via `readLive`, tweened with
  `interpolateProp`. Migrate the 6 legacy fields into the same mechanism and
  delete the parallel struct.
- Object-valued props (gradient, path/`d`) that can't blend: flip at **eased
  progress ≥ 0.5** (CSS discrete-transition rule) instead of holding to the
  end. This also upgrades today's gradient snap-at-settle.
- Compatible paths/gradients: if smooth tween via `interpolateProp` falls out
  naturally, take it; otherwise midpoint-flip ships and smooth object tween is
  a named follow-up.
- `matchSpec`'s `TRANSITION_GROUPS` extends to arbitrary registry property
  names (`transition: r 200ms`, `transition: all ...` covers them).
- Tween state stays wall-clock-driven and lives only in InteractionManager
  (timeline purity, invariant #4).

## CSS alignment

Moves toward CSS: one animatable set shared by keyframes+transitions, replace
semantics, transition-from-current-displayed-value (incl. mid-tween reversal),
50% discrete flip. Retained deliberate divergences: transform-as-delta,
hover-applies-after-animation, transitions trigger only on interaction state
flips.

## Testing

- Stage 1: builder test (override parsed into map; unknown prop still warns),
  apply test (`:hover { r }` changes live `r`, reverts on state exit, sets
  `polystarDirty`/`outlineLengthDirty`).
- Stage 2: numeric prop eases over the spec duration; object prop flips at
  midpoint; mid-tween reversal starts from displayed value; legacy 6 props
  behave identically to before the migration.
- Repo bar: `bun run test` + `bun run build` green; browser eyeball of an
  interactive demo scene; corpus batch (converter untouched, expect
  unchanged).

## Implementation plan

- **Wave 1 (parallel, disjoint files)**
  - **Task A (popcorn-engineer):** Stage 1 — `scene/types.ts`,
    `scene/builder.ts`, `runtime/interaction.ts` (`applyStateStyles` only),
    `scene/builder.test.ts`.
  - **Task B (popcorn-hand):** demo gallery scene
    `examples/popcorn/NN-hover-geometry.css` exercising hover geometry +
    dash offset (the browser-eyeball scene for both stages).
- **Wave 2 (after A lands)**
  - **Task C (popcorn-engineer):** Stage 2 — `runtime/interaction.ts` tween
    refactor + tests; run the corpus batch once as the player-change gate.
