---
"@popkorn/parser": patch
"@popkorn/player": patch
"@popkorn/converters": patch
"@popkorn/react-native": patch
---

Fix `renderer="svg"` being silently ignored. The component held its live backend
in a private field named `renderer`, which shadowed the public attribute name —
so an embedder assigning `el.renderer = "svg"` (how React passes props to custom
elements) had it overwritten at init, and the backend never switched. The field
is now `backend`, `renderer` is a reflecting property, and it is an observed
attribute, so swapping backends at runtime re-initializes and restores the
timeline position and play state instead of being read once at startup.
