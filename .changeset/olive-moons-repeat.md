---
"@popkorn/parser": patch
"@popkorn/player": patch
"@popkorn/converters": patch
"@popkorn/react-native": patch
---

Canvas2D filter and mask composites now clear, clip and blit only the device
region their subtree can paint into, instead of the whole backing buffer. A new
`scene/bounds.ts` computes that region — mirroring the render walk's visibility
gating, folding in each node's own filter bleed so a blurred descendant widens
its ancestor, and padding for stroke, antialiasing and text ink. Mask regions
intersect content with the mask only for non-inverted modes, since an inverted
mask preserves content by being transparent.

Composite cost now scales with the element rather than the viewport, which
mainly helps browsers where canvas filters aren't GPU-backed: filter-heavy
scenes measure 1.4x-5x faster per frame in Firefox. Rendering is unchanged.
