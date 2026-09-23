---
"@popkorn/parser": patch
"@popkorn/player": patch
"@popkorn/converters": patch
"@popkorn/react-native": patch
---

- Breaking (API cleanup): about 60 unused exports removed from `@popkorn/player` (internal factories, matrix helpers, scene-node helpers and many internal types) and a few from `@popkorn/parser` (`minify`/`format`/`crushSource`; use `serialize(sheet, { minify, crush })`). `Renderer.clear()` and `supportsRasterCache()` are gone from the renderer interface, and `RenderLoop` now takes `(renderer, scheduler?)`.
- Crush output is much smaller: identical `@keyframes` merge, path data is written as compact relative commands, and single-use path variables are inlined.
- Truncated path data renders up to the error instead of throwing; after `Z`, the next command starts from the subpath start in Canvas2D and Skia, as in SVG. Odd-length dash arrays render the same on all backends.
- `random()` operands now resolve static `var()`s, fold `sibling-index()` and keep `round()`'s rounding mode; crush renames variables used inside `random()`.
- Malformed `var()`, keyframe selectors and state-machine triggers report a positioned parse error instead of producing NaN or a null name.
- All 148 CSS named colors are recognized everywhere, with no false unknown-color warnings; `rgb()`/`hsl()` parsing follows CSS Color 4 (percent channels, space syntax, bare-number saturation/lightness).
- State-machine scenes hit-test once per frame instead of twice.
- Lottie import: 3D layers flatten like lottie-web instead of losing their rotation; parented layers stack in exact Lottie order and stay visible outside their parent's in/out window; animation segments cut by the comp's in/out points keep their easing.
- SVG import recognizes every CSS named color.
