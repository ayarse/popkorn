# @popkorn/converters

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
  - @popkorn/parser@0.2.3
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
  - @popkorn/parser@0.2.2
  - @popkorn/player@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [5c6252b]
- Updated dependencies [55d11fc]
- Updated dependencies [c5625eb]
  - @popkorn/parser@0.2.1
  - @popkorn/player@0.2.1

## 0.2.0

### Minor Changes

- 0c68292: Convert style-carried filters, and tolerate real-world SVG quirks.

  Filters declared via `style="filter: ..."` now convert, including Adobe's
  multi-primitive drop-shadow chains, which collapse into a single Popkorn
  `box-shadow`. The reader also accepts what optimizers and editors actually
  emit: svgo-compacted numbers, CSS units on geometry, a leading BOM, and
  `!important` on declarations.

### Patch Changes

- Updated dependencies [0c68292]
- Updated dependencies [0c68292]
- Updated dependencies [0c68292]
  - @popkorn/player@0.2.0
  - @popkorn/parser@0.2.0

## 0.1.1

### Patch Changes

- 38bde24: Add repository/homepage/bugs metadata so npm pages link back to the source repo.
- Updated dependencies [38bde24]
  - @popkorn/parser@0.1.1
  - @popkorn/player@0.1.1
