# Popkorn Export (Figma plugin)

Exports the current Figma selection — static geometry **and** Figma Motion
keyframe timelines — to a Popkorn `.css` scene. All mapping lives in
`@popkorn/converters` (`figma2popkorn`); this package is only the plugin shell
(sandbox capture + UI download), kept `private` and out of the publish pipeline.

## Status: WIP

The shell works end-to-end (verified on a live Motion file and a real FIFA26
community intro), but it is not done:

- **`figma2popkorn` (the converter core in `@popkorn/converters`) is not
  committed yet** — this package does not build without it.
- The second fidelity wave (per-corner radius tracks, image fills → data-URI
  `type: image` with dedupe, mask mapping instead of flattening, `clipsContent`
  → `clip-path`, preview-truncation label + "Save bundle" button) is
  implemented but **unreviewed**: its regression tests are missing and the
  converter batch gates haven't been re-run over it.
- Image-fill, mask, and clip output have not been verified inside Figma against
  a real file (only the wave-1 features were visually verified against Figma's
  own MP4 render).
- Named spring presets (Gentle/Quick/Bouncy/Slow) read back without parameters;
  their bounce values are a guessed table pending tuning against reference
  exports.
- Text baseline placement is approximated (one font-size below the box top).
- Smart Animate prototype `reactions`, Figma Sites/Make/Buzz, and shader/effect
  keyframes are deliberate v1 skips.

## Build

```sh
bun install
bun --filter @popkorn/figma-plugin build   # -> dist/main.js + dist/ui.html
```

## Install in Figma (local dev, 3 steps)

1. Build (above) so `dist/` exists.
2. In the Figma desktop app: **Plugins → Development → Import plugin from
   manifest…**
3. Pick `packages/popkorn-figma-plugin/manifest.json`.

Run it from **Plugins → Development → Popkorn Export**. Select frames/shapes and
click **Export selection** (nothing selected exports the whole page), review the
warnings/blocked ledger, then **Download .css**.

## What converts

- **Nodes:** frames/groups → groups; rectangles, ellipses (circle when square),
  vectors/stars/polygons/booleans (via `vectorPaths`) → paths; text.
- **Paint:** solid + linear/radial gradients. Angular/diamond gradients and
  image fills warn and drop.
- **Transforms:** `relativeTransform` decomposes to translate/rotate/scale; skew
  warns and is dropped.
- **Motion:** `manualKeyframeTracks` → `@keyframes` + `animation-*`. Translation/
  rotation/scale/opacity/stroke-weight/corner-radius/dimensions/path-trim and
  fill/stroke color tracks map; per-keyframe easing (named curves,
  `cubic-bezier`, `HOLD`) maps directly, springs sample into a `linear()` curve.

## Beta API note

The `figma.motion` namespace and node `manualKeyframeTracks` / `timelines`
shipped in **Plugin API v1 update 127 (2026-06-23)** and are **Beta** — shapes
may still change. `main.ts` reads them defensively, so a document without Motion
data still exports its static tree. If Figma changes the Motion shapes, the fix
is isolated to `src/main.ts` (capture) and `figma2popkorn.ts` (mapping); the
capture-bundle contract between them stays stable.
