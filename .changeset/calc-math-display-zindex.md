---
"@popkorn/parser": patch
"@popkorn/player": patch
---

Add the css-values-4 math functions to `calc()` — `sin`, `cos`, `tan`, `asin`,
`acos`, `atan`, `atan2`, `hypot`, `sqrt`, `pow`, `mod`, `rem`, `abs`, `sign`,
`round` (with strategies), `log`, `exp`, and the `e`/`pi` constants — with CSS
semantics (angle units `deg`/`grad`/`rad`/`turn`, divisor/dividend sign rules
for `mod`/`rem`). Works in static folding and per-frame reactive expressions.

Make `display` and `z-index` drivable per frame: `display: none` (or a
`var()`/`calc()` binding, 0 → hidden) removes a node and its subtree from both
rendering and hit-testing; `z-index` accepts `var()`/`calc()` bindings and
`@keyframes` (integer-rounded), with paint order and reversed hit-test order
staying in lockstep.
