---
"@popkorn/converters": patch
---

Convert skew instead of dropping it: Lottie layer skew (`sk`/`sa`, static and animated) maps onto rotate/scale/skewX matching lottie-web's matrix, and SVG shear, `skewX`/`skewY` SMIL and `skew()`/`matrix()` keyframes map onto the node's skewX instead of baking geometry.
