# @popkorn/converters

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
