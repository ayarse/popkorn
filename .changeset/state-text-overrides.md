---
"@popkorn/player": patch
---

- `:state()`/`:hover`/`:active` blocks can override `content`, `font-family`, `font-weight` and `text-anchor`/`text-align` (instant snap, reverted on exit).
- Text bounds re-measure when content or font changes, so hit areas and filter regions no longer go stale.
