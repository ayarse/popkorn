# @popkorn/player

## 0.2.1

### Patch Changes

- 5c6252b: Add the css-values-4 math functions to `calc()` — `sin`, `cos`, `tan`, `asin`,
  `acos`, `atan`, `atan2`, `hypot`, `sqrt`, `pow`, `mod`, `rem`, `abs`, `sign`,
  `round` (with strategies), `log`, `exp`, and the `e`/`pi` constants — with CSS
  semantics (angle units `deg`/`grad`/`rad`/`turn`, divisor/dividend sign rules
  for `mod`/`rem`). Works in static folding and per-frame reactive expressions.

  Make `display` and `z-index` drivable per frame: `display: none` (or a
  `var()`/`calc()` binding, 0 → hidden) removes a node and its subtree from both
  rendering and hit-testing; `z-index` accepts `var()`/`calc()` bindings and
  `@keyframes` (integer-rounded), with paint order and reversed hit-test order
  staying in lockstep.

- 55d11fc: Add `object-view-box` source cropping to image nodes (sprite sheets).

  `object-view-box: xywh(<x> <y> <w> <h>)` crops an image's source to a sub-rect
  (in image pixels) before it scales into the node's box — the CSS property for
  cropping a replaced element. It's the missing piece for sprite-sheet animation:
  one bitmap, N frames, `steps(N)` @keyframes paging the crop's `x` one frame per
  step. The four components are animatable (each interpolates, so `steps()` pages
  discrete frames) and bindable via `var()`/`input()`/`calc()`, so a host can drive
  the frame with `setVariable('--frame', n)`. `none` (default) draws the whole
  bitmap; a zero/negative crop draws nothing; only the `xywh()` form is supported.

  Realized across all three backends: Canvas2D 9-arg `drawImage`, Skia
  `drawImageRect`, and SVG via a nested `<svg viewBox>` crop. The crop geometry
  lives in the shared render walk; the `Renderer.drawImage` primitive gains
  optional `sx/sy/sw/sh` source-rect args.

- Updated dependencies [5c6252b]
- Updated dependencies [55d11fc]
- Updated dependencies [c5625eb]
  - @popkorn/parser@0.2.1

## 0.2.0

### Minor Changes

- 0c68292: Make `time-remap` animatable, and report unbounded scenes honestly.

  `time-remap` can now be driven by keyframes, so a state machine can play a
  segment of a subtree's timeline. Alongside it, a scene with no honest end — a
  state machine, or one whose animations all loop `infinite` — now free-runs its
  clock instead of wrapping at a nominal duration, and `RenderLoop.duration`
  reports `Infinity` for it rather than a finite total that playback ignores.

  Breaking: `duration` can now be `Infinity`. A host reading it (to size a
  scrubber, say) must handle that; the bundled controls hide the seeker.

- 0c68292: Namespace player DOM events under `popkorn:` and add pointer interactivity.

  Events now dispatch as `popkorn:click`, `popkorn:load`, `popkorn:complete` and
  friends instead of their bare names, so a host page can tell a player event from
  a native one. Click resolution walks the full tree rather than only top-level
  nodes, and the new `cursor: pointer` property lets a node advertise itself as
  clickable.

  Breaking: listeners bound to the old un-namespaced event names must be renamed.

### Patch Changes

- 0c68292: Parse compact path data written by svgo and Illustrator.

  Runs of numbers packed without separators (`1.5.5`, `10-20`) now tokenize
  correctly, and arc flags packed against their following number (`a5 5 0 015 5`)
  are read as flags rather than swallowed into it. Both shapes are what real
  optimized SVG exports contain; they previously produced wrong geometry.

- Updated dependencies [0c68292]
  - @popkorn/parser@0.2.0

## 0.1.1

### Patch Changes

- 38bde24: Add repository/homepage/bugs metadata so npm pages link back to the source repo.
- Updated dependencies [38bde24]
  - @popkorn/parser@0.1.1
