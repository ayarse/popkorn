# Popkorn Export (Figma plugin)

Popkorn Export turns a Figma selection into a Popkorn `.css` scene. It carries
the static design (frames, shapes, text, paints, images) and, where the file
uses Figma Motion, the keyframe timelines too, so an animated frame exports as
a playing scene.

The plugin itself is a thin shell. Its sandbox side reads the live document and
flattens it into a plain-JSON capture bundle; its UI converts that bundle with
`figma2popkorn` from `@popkorn/converters`, shows the result, and lets you
download it. All mapping logic lives in the converter, which runs under bun
with fixture bundles and needs no Figma runtime. The package is `private` and
stays out of the npm publish pipeline. It is in very early stages, and the
supported surface is growing.

## Build and install

```sh
bun install
bun --filter @popkorn/figma-plugin build   # -> dist/main.js + dist/ui.html
```

Then, in the Figma desktop app, choose **Plugins → Development → Import plugin
from manifest…** and pick `packages/popkorn-figma-plugin/manifest.json`.

Run it from **Plugins → Development → Popkorn Export**. Select frames or shapes
(with nothing selected, the whole page exports) and click **Export selection**.
The panel lists warnings and blocked features, and previews the CSS; a large
scene previews its first few KB and says so. **Download .css** saves the full
scene. **Save bundle** saves the raw capture as `.figma.json`, which the
converter CLI also accepts:

```sh
bun packages/popkorn-converters/src/cli.ts scene.figma.json -o scene.css --validate
```

## What converts

Frames, groups, components and instances become groups. A frame's own fill
becomes a background shape behind its content, and `clipsContent` becomes a
`clip-path` on the group. Rectangles map to `rect` (with corner radii),
ellipses to `circle` or `ellipse`, and vectors, stars, polygons, lines and
boolean operations to `path` through their `vectorPaths`. A star or polygon
without path data falls back to a native `star`/`polygon` sized from its box.
Text maps to `text` with its font family, weight, size and alignment.

Paints cover solid colors and linear and radial gradients. An image fill
becomes a `type: image` node holding the bitmap as a data URI, with repeated
images deduplicated; images over 4 MB are left out and reported. Masks map to a
`clip-path` on the parent in the simple case (one plain shape mask as the first
child), and to per-sibling `mask: #id alpha|luminance` track mattes otherwise.

Each node's `relativeTransform` decomposes into translate, rotate and scale.
Motion keyframe tracks become one `@keyframes` block per animated channel,
joined into the node's `animation` list. The mapped channels are position,
rotation, scale, opacity, stroke weight, width and height, uniform and
per-corner radius, path trim start and end, and fill and stroke color. Easing
maps per keyframe: named curves, `cubic-bezier`, and holds translate directly,
and springs are sampled into a `linear()` curve.

## Approximations and gaps

The converter reports each of these in the panel's warnings or blocked list:

- Skew is dropped, since it isn't carried through the transform decomposition.
- Angular and diamond gradients fall back to their first stop; video fills are
  dropped. When a node has several visible paints, the topmost one is used.
- Image `CROP` and `TILE` scale modes stretch to the node's box.
- Named spring presets (Gentle, Quick, Bouncy, Slow) come back from the API
  without physical parameters, so their bounce is estimated.
- Text baseline is placed one font-size below the top of the text box, and
  justified text is start-aligned.
- Per-corner radii are not carried into a frame's clip shape (the clip is
  square).

Prototype interactions (Smart Animate `reactions`), Figma Sites, Make and Buzz
content, and shader or effect keyframes are outside the plugin's scope.

## Figma Motion API

The `figma.motion` namespace and the node properties `manualKeyframeTracks` and
`timelines` arrived in Plugin API v1 update 127 (2026-06-23) and are marked
Beta, so their shapes may still change. `src/main.ts` reads them defensively: a
document without Motion data still exports its static tree. If Figma changes
those shapes, the fix stays within `src/main.ts` (capture) and
`figma2popkorn.ts` (mapping), and the capture-bundle contract between them
holds.
