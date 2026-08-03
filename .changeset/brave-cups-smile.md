---
"@popkorn/parser": patch
"@popkorn/player": patch
"@popkorn/converters": patch
"@popkorn/react-native": patch
---

Fix four cases where the composite region under-reported what the render walk
paints, silently clipping or dropping content inside a filter or mask:

- Miter joins are padded by `miterLimit x width / 2`, not a flat stroke width —
  an ordinary sharp corner at the default limit reaches twice as far and was
  being chopped.
- A zero-area box with a stroke is kept instead of culled: a zero-length subpath
  with a round cap paints a full dot (a routine converted-Lottie idiom) and was
  being dropped entirely, not merely clipped.
- Filter lists compose sequentially, so their reaches accumulate. Taking the
  per-side maximum truncated `blur() drop-shadow()` chains with a hard edge once
  the node sat inside another composite's clip.
- An image sized by its `object-view-box` crop uses the crop's size; one whose
  natural size isn't known until the decode lands widens the region to the whole
  buffer rather than being culled.

Also guards `attributeChangedCallback` against no-op writes, so a framework
re-asserting the same attribute each render no longer rebuilds the scene and
discards state-machine and interaction state.
