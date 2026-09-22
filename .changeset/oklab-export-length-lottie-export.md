---
"@popkorn/parser": patch
"@popkorn/player": patch
"@popkorn/converters": patch
---

- `oklab()`/`oklch()` colors, with Oklab interpolation for animated colors.
- `input(time)` follows timeline time, so seek, pause and export drive it; `sceneExportLength()` reports the frame range an offline export should cover, with a suggested length for open-ended (perpetual, state-machine, `input(time)`-driven) scenes.
- `popkorn2lottie`: a sampled Popkorn → Lottie JSON exporter in `@popkorn/converters`.
