# @popkorn/react-native

## 0.2.4

### Patch Changes

- 9b3430e: Fix `renderer="svg"` being silently ignored. The component held its live backend
  in a private field named `renderer`, which shadowed the public attribute name —
  so an embedder assigning `el.renderer = "svg"` (how React passes props to custom
  elements) had it overwritten at init, and the backend never switched. The field
  is now `backend`, `renderer` is a reflecting property, and it is an observed
  attribute, so swapping backends at runtime re-initializes and restores the
  timeline position and play state instead of being read once at startup.
- Updated dependencies [9b3430e]
  - @popkorn/player@0.2.4

## 0.2.3

### Patch Changes

- b003544: Canvas2D filter and mask composites now clear, clip and blit only the device
  region their subtree can paint into, instead of the whole backing buffer. A new
  `scene/bounds.ts` computes that region — mirroring the render walk's visibility
  gating, folding in each node's own filter bleed so a blurred descendant widens
  its ancestor, and padding for stroke, antialiasing and text ink. Mask regions
  intersect content with the mask only for non-inverted modes, since an inverted
  mask preserves content by being transparent.

  Composite cost now scales with the element rather than the viewport, which
  mainly helps browsers where canvas filters aren't GPU-backed: filter-heavy
  scenes measure 1.4x-5x faster per frame in Firefox. Rendering is unchanged.

- Updated dependencies [b003544]
  - @popkorn/player@0.2.3

## 0.2.2

### Patch Changes

- ae3646f: Reactive `calc()` now compiles to a postfix VM with per-frame variable memoization
  and batched multi-lane runs for structurally identical programs. Adds the CSS
  Values 5 `random()` primitive, optional `round()` step, `sibling-index()`/
  `sibling-count()`, and a `repeat` property that expands into sibling nodes.
  Fixes sparse per-property keyframe interpolation, zero-length moveto gaps in
  motion paths, and `calc()` percent folding inside fractions. Adds a work-in-progress
  Figma motion export path to the converters.
- Updated dependencies [ae3646f]
  - @popkorn/player@0.2.2

## 0.2.1

### Patch Changes

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
  - @popkorn/player@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [0c68292]
- Updated dependencies [0c68292]
- Updated dependencies [0c68292]
  - @popkorn/player@0.2.0

## 0.1.1

### Patch Changes

- 38bde24: Add repository/homepage/bugs metadata so npm pages link back to the source repo.
- Updated dependencies [38bde24]
  - @popkorn/player@0.1.1
