---
"@popkorn/parser": patch
"@popkorn/player": patch
"@popkorn/converters": patch
"@popkorn/react-native": patch
---

Reactive `calc()` now compiles to a postfix VM with per-frame variable memoization
and batched multi-lane runs for structurally identical programs. Adds the CSS
Values 5 `random()` primitive, optional `round()` step, `sibling-index()`/
`sibling-count()`, and a `repeat` property that expands into sibling nodes.
Fixes sparse per-property keyframe interpolation, zero-length moveto gaps in
motion paths, and `calc()` percent folding inside fractions. Adds a work-in-progress
Figma motion export path to the converters.
