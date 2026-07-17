---
"@popkorn/parser": patch
---

Warn (`unit-has-no-effect`) when a declaration value uses `em`/`rem` — Popkorn
lengths are unitless scene coordinates, not font-relative, so these units
parse and round-trip but were silently implying behavior that doesn't exist.
