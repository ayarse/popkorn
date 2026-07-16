---
"@popkorn/parser": patch
"@popkorn/player": patch
"@popkorn/react-native": patch
---

Add `object-view-box` source cropping to image nodes (sprite sheets).

`object-view-box: xywh(<x> <y> <w> <h>)` crops an image's source to a sub-rect
(in image pixels) before it scales into the node's box — the CSS property for
cropping a replaced element. It's the missing piece for sprite-sheet animation:
one bitmap, N frames, `steps(N)` @keyframes paging the crop's `x` one frame per
step. The four components are animatable (each interpolates, so `steps()` pages
discrete frames) and bindable via `var()`/`input()`/`calc()`, so a host can drive
the frame with `setVariable('--frame', n)`. `none` (default) draws the whole
bitmap; a zero/negative crop draws nothing; only the `xywh()` form is supported.

Realized across all three backends: Canvas2D 9-arg `drawImage`, Skia
`drawImageRect`, and SVG via a nested `<svg viewBox>` crop. The crop geometry
lives in the shared render walk; the `Renderer.drawImage` primitive gains
optional `sx/sy/sw/sh` source-rect args.
