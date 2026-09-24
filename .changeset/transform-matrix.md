---
"@popkorn/player": patch
---

Support `matrix(a, b, c, d, e, f)` in `transform`: it decomposes onto the translate/rotate/scale/skewX channels, so it animates like the other transform functions.
