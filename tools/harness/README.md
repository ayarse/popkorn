# lottie-web vs popcorn comparison harness

## Purpose

Frame-accurate visual truth. Screenshots (and pixel diffs) catch rendering
bugs that unit tests can't — several real Popcorn bugs were only visible on
canvas. This harness loads a Lottie JSON in real lottie-web (5.12.2) side by
side with the equivalent converted `.css` scene in `<popcorn-player>`, and
steps both to the same paused frame so you can compare pixels directly.

**lottie-web is the parity floor, not the ceiling.** When the two sides
disagree, don't assume lottie-web is right — judge the mismatch against AE
semantics (what a real Lottie/AE file is supposed to look like). Shipping
Lottie players themselves skip some rare shape modifiers; matching lottie-web
byte-for-byte is not the goal, matching intended AE motion is.

## Usage

1. Build the popcorn-player bundle this page imports (not committed — build
   it locally):

   ```sh
   bun build packages/popcorn-player/src/index.ts \
     --outfile=tools/harness/dist/popcorn.js \
     --format=esm --target=browser
   ```

2. Serve `tools/harness/` (it needs a real origin for `fetch`/ES module
   imports — `file://` won't work):

   ```sh
   bun x serve tools/harness
   ```

3. Open `harness.html` and either:
   - pass `?json=./cat.json&css=./cat.css` (paths resolved relative to the
     harness page) to load fixtures already sitting next to it, or
   - use the file pickers at the top of the page to load a Lottie JSON and a
     converted Popcorn `.css` from anywhere on disk.

   Other query params: `w`, `h` (canvas size, default 500), `fps` (Lottie
   frame rate for frame↔second conversion, default 30), `bundle` (path to the
   built popcorn.js, default `./dist/popcorn.js`).

   **Gotcha:** `serve`'s "clean URLs" redirect turns `/harness.html?...` into
   a 301 to `/harness` — and drops the query string in the process, so your
   `?json=...` params silently vanish. Request the extensionless path
   directly, `http://localhost:3000/harness?json=...`, to skip the redirect
   and keep your params.

4. Compare at paused frames. In the page or via a devtools/console driver:

   ```js
   seekBoth(1.25);     // pauses both players at t = 1.25s
   __diff();           // { meanDelta, maxDelta, worstPx, samples }
   ```

   `seekBoth` calls lottie's `goToAndStop(sec * fps, true)` and popcorn's
   `pc.seek(sec * 1000)` so both land on the same instant. `__diff` does a
   naive per-pixel RGB delta between the two canvases (ignoring pixels
   transparent on both sides) — a quick numeric signal to point you at the
   frame/region worth screenshotting and eyeballing.

## Driving with an agent

All `window.__*` APIs return plain JSON — small, flat, and rounded to 2
decimals — designed to fit in a small-context agent turn without dumping raw
pixel buffers. The protocol:

```sh
bun x serve tools/harness
```

```
http://localhost:3000/harness?json=./cat.json&css=./cat.css&w=300&h=300
```

(extensionless path — see the "Gotcha" above; `.html` will 301 and drop your
query params). Then, via browser-automation JS evaluation against that tab:

```js
__ready()                    // wait for this to be true before anything else
await __scan()                // find the worst-disagreeing frame
seekBoth(worstFrame.t)        // land on it
__inspectCell(cell.col, cell.row, cols, rows)   // zoom into the worst cell
// screenshot the page — the inspector panel (lottie crop / popcorn crop /
// amplified diff heatmap) renders below the two players
```

**If a call hangs**, the tab is likely backgrounded — Chrome throttles or
freezes timers (`requestAnimationFrame`, even `setTimeout`) in tabs that
aren't focused, and this harness's `seekBoth`-then-settle steps depend on
timers to fire. Bring the tab to the foreground (e.g. a click) and retry.

### `__ready()` → `boolean`

`true` once both players have a loaded animation/scene and are paused on a
frame. Poll this before calling anything else.

### `__diff()` → `{ meanDelta, maxDelta, samples, worstPx }`

Unchanged. Whole-canvas per-pixel RGB delta at the current paused frame.
`meanDelta` is a string (`.toFixed(2)`); everything else here returns numbers.

### `__gridDiff(cols = 8, rows = 8)` → `{ meanDelta, maxDelta, cells }`

Tiles the current paused frame into a `cols`×`rows` grid and diffs each cell.
`cells` is sorted worst-first (by `hashDist` descending, then `meanDelta`
descending) — `cells[0]` is where to look. Each cell:

```
{ col, row, x, y, w, h, meanDelta, maxDelta, coverage, hashDist }
```

`hashDist` (0–64) is an average-hash bit distance — high values mean the
*content* of that cell differs (something's in the wrong place, wrong shape,
or missing), not just its brightness. `meanDelta`/`maxDelta` are per-cell RGB
deltas. `coverage` is the fraction of the cell's pixels that weren't
transparent on both sides (low coverage on a "worst" cell means the delta
comes from very few pixels — maybe a thin edge, not a real mismatch).

### `__scan(n = 12, cols = 8, rows = 8)` → `{ duration, frames }`

Samples `n` evenly-spaced times across the lottie animation's full duration
(`totalFrames / frameRate`), running `seekBoth` + `__gridDiff` at each, and
returns `frames` sorted worst-first by `meanDelta`:

```
{ t, meanDelta, maxDelta, worstCells: [{ col, row, x, y, w, h, meanDelta, maxDelta, hashDist }, ...up to 3] }
```

`worstCells` only includes cells that actually disagree (`hashDist > 0` or
`meanDelta` above a small epsilon) — a clean frame reports `worstCells: []`.
This is the entry point for "where in time and space do these two players
disagree" — run it first, then drill into `frames[0].t` and its `worstCells`.

### `__inspect(x, y, w, h)` → `{ rect, meanDelta, maxDelta, coverage, hashDist }`

Crops both canvases to the given pixel rect and appends (or updates) a
labelled inspector panel below the two players: lottie crop, popcorn crop,
and a red amplified (×8) diff heatmap, all scaled up with nearest-neighbor so
a small cell is legible in a screenshot. Also logs and returns the same
compact stats `__gridDiff` cells carry, for this one rect.

### `__inspectCell(col, row, cols = 8, rows = 8)` → same as `__inspect`

Convenience wrapper — maps a `__gridDiff`/`__scan` cell reference straight to
`__inspect`, so the typical flow is `__scan()` → pick a cell → `__inspectCell`
→ screenshot, with no manual rect math.

## Working offline

By default the page loads lottie-web from a CDN
(`cdnjs.cloudflare.com/.../bodymovin/5.12.2/lottie.min.js`) so nothing binary
is committed to the repo. For offline use, drop a local copy at
`tools/harness/vendor/lottie.min.js` (gitignored via the repo's `dist/`
pattern doesn't cover it — create the file yourself, it won't be tracked
unless you `git add` it) and pass `?lottie=./vendor/lottie.min.js`.

## Fixtures

This harness intentionally ships with no JSON/CSS fixtures of its own — pull
them from `examples/lottie/` (real-file smoke scenes) or the LottieFiles
conformance corpus referenced in the root `CLAUDE.md`, or use the file
pickers.
