---
"@popkorn/converters": minor
---

Convert style-carried filters, and tolerate real-world SVG quirks.

Filters declared via `style="filter: ..."` now convert, including Adobe's
multi-primitive drop-shadow chains, which collapse into a single Popkorn
`box-shadow`. The reader also accepts what optimizers and editors actually
emit: svgo-compacted numbers, CSS units on geometry, a leading BOM, and
`!important` on declarations.
