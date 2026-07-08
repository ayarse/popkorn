# lottie-web / thorvg vs popcorn comparison harness

## Purpose

Frame-accurate visual truth. Screenshots (and pixel diffs) catch rendering
bugs that unit tests can't — several real Popcorn bugs were only visible on
canvas. This harness loads a Lottie JSON in real lottie-web (5.12.2), and
optionally in ThorVG's `@thorvg/lottie-player` (1.0.9, a second, independent
Lottie renderer), side by side with the equivalent converted `.css` scene in
`<popcorn-player>`, and steps all of them to the same paused frame so you can
compare pixels directly. popcorn is always the subject under test; lottie-web
and thorvg are the two reference renderers.

**Neither reference is the ceiling.** When popcorn disagrees with a
reference, don't assume the reference is right — judge the mismatch against
AE semantics (what a real Lottie/AE file is supposed to look like). Shipping
Lottie players themselves skip some rare shape modifiers; matching a
reference byte-for-byte is not the goal, matching intended AE motion is.
lottie-web and thorvg can also disagree with *each other* (see `__refDiff`)
— that's a signal the two references' own parity is soft in that region, not
proof either one is wrong.

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
   frame rate for frame↔second conversion — defaults to the loaded file's own
   `fr` field once it's loaded, so you normally don't need this; pass it to
   force a value, e.g. for a raw JSON string with no reliable `fr`), `bundle`
   (path to the built popcorn.js, default `./dist/popcorn.js`), `thorvg`
   (URL to a `@thorvg/lottie-player` build, default the unpkg CDN — see "Two
   vs three players" below).

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

   `seekBoth` calls lottie's `goToAndStop(sec * fps, true)`, popcorn's
   `pc.seek(sec * 1000)`, and (when available) thorvg's `seek(sec * fps)`, so
   all loaded players land on the same instant. `__diff` does a naive
   per-pixel RGB delta between popcorn and a reference canvas (default
   lottie-web; ignoring pixels transparent on both sides) — a quick numeric
   signal to point you at the frame/region worth screenshotting and
   eyeballing.

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
// screenshot the page — the inspector panel (lottie crop / [thorvg crop] /
// popcorn crop / amplified diff heatmap) renders below the players
```

**If a call hangs**, the tab is likely backgrounded — Chrome throttles or
freezes timers (`requestAnimationFrame`, even `setTimeout`) in tabs that
aren't focused, and this harness's `seekBoth`-then-settle steps depend on
timers to fire. Bring the tab to the foreground (e.g. a click) and retry.

**First paint can take several seconds** for a nontrivial scene (parsing +
first layout +, for thorvg, WASM init over the network) — poll `__ready()`
for 20–30s before concluding something is broken, especially in a
backgrounded/automated tab where throttled timers slow everything down
further.

**Serving scope:** `bun x serve tools/harness` restricts `fetch()` traversal
to that directory — requests like `?json=../../examples/lottie/...` will 404.
If your JSON/CSS fixtures live elsewhere in the repo, serve the **repo root**
instead and navigate to `http://localhost:3000/tools/harness/harness?json=../../examples/...&css=...`.

**Long async calls in browser-automation JS eval:** `await __scan()` and
other long-running calls can exceed the ~45s eval timeout, losing the result
even if the page completes fine. Pattern: fire the call without awaiting
(`__scan().then(r => window.__lastScan = r)`), then poll `window.__lastScan`
in short, separate evals until it's populated.

### `__ready()` → `boolean`

`true` once every *available* player has a loaded animation/scene and is
paused on a frame — lottie-web and popcorn always; thorvg too, but only if
it loaded successfully (see "Two vs three players" below). Poll this before
calling anything else.

### `__diff(ref = 'lottie')` → `{ ref, meanDelta, maxDelta, samples, worstPx }`

Whole-canvas per-pixel RGB delta between popcorn (always the subject) and
the reference named by `ref` — `'lottie'` (default) or `'thorvg'` — at the
current paused frame. `meanDelta` is a string (`.toFixed(2)`); everything
else here returns numbers. Throws if `ref='thorvg'` and thorvg is
unavailable (see "Two vs three players" below).

### `__gridDiff(cols = 8, rows = 8, ref = 'lottie')` → `{ ref, meanDelta, maxDelta, cells }`

Tiles the current paused frame into a `cols`×`rows` grid and diffs each cell
between popcorn and `ref`. `cells` is sorted worst-first (by `hashDist`
descending, then `meanDelta` descending) — `cells[0]` is where to look. Each
cell:

```
{ col, row, x, y, w, h, meanDelta, maxDelta, coverage, hashDist }
```

`hashDist` (0–64) is an average-hash bit distance — high values mean the
*content* of that cell differs (something's in the wrong place, wrong shape,
or missing), not just its brightness. `meanDelta`/`maxDelta` are per-cell RGB
deltas. `coverage` is the fraction of the cell's pixels that weren't
transparent on both sides (low coverage on a "worst" cell means the delta
comes from very few pixels — maybe a thin edge, not a real mismatch). Throws
under the same `ref='thorvg'`-unavailable condition as `__diff`.

### `__refDiff(cols = 8, rows = 8)` → `{ meanDelta, maxDelta, cells }`

Same grid-diff math as `__gridDiff`, but between the two *references*
(lottie-web vs thorvg) — popcorn isn't involved. A nonzero `__refDiff` means
the two ground-truth renderers themselves disagree in that region, so
popcorn matching one exactly there doesn't mean much — cross-check a
suspicious `__diff`/`__gridDiff` result against `__refDiff` before chasing
it. Requires thorvg; throws if unavailable.

### `__scan(n = 12, cols = 8, rows = 8)` → `{ duration, frames }`

Samples `n` evenly-spaced times across the lottie animation's full duration
(`totalFrames / frameRate`), running `seekBoth` + a grid diff at each, and
returns `frames` sorted worst-first. The per-frame shape depends on whether
thorvg is available:

```
// thorvg unavailable — unchanged from before thorvg support existed:
{ t, meanDelta, maxDelta, worstCells: [{ col, row, x, y, w, h, meanDelta, maxDelta, hashDist }, ...up to 3] }

// thorvg available — both refs, each independently vs popcorn:
{ t, lottie: { meanDelta, maxDelta, worstCells }, thorvg: { meanDelta, maxDelta, worstCells } }
```

`worstCells` only includes cells that actually disagree (`hashDist > 0` or
`meanDelta` above a small epsilon) — a clean frame reports `worstCells: []`.
This is the entry point for "where in time and space do these players
disagree" — run it first, then drill into `frames[0].t` and its `worstCells`
(and, if the two-ref shape looks suspicious, `__refDiff` at that frame).

### `__inspect(x, y, w, h, ref = 'lottie')` → `{ rect, ref, meanDelta, maxDelta, coverage, hashDist }`

Crops popcorn and `ref` to the given pixel rect and replaces the (single,
reused) inspector panel below the players: a lottie crop, a thorvg crop
(only when thorvg is available — shown regardless of which `ref` was
chosen, purely so you can eyeball all three), a popcorn crop, and a red
amplified (×8) diff heatmap of popcorn vs `ref`, all scaled up with
nearest-neighbor so a small cell is legible in a screenshot. Also logs and
returns the same compact stats `__gridDiff` cells carry, for this one rect.

### `__inspectCell(col, row, cols = 8, rows = 8, ref = 'lottie')` → same as `__inspect`

Convenience wrapper — maps a `__gridDiff`/`__scan` cell reference straight to
`__inspect`, so the typical flow is `__scan()` → pick a cell → `__inspectCell`
→ screenshot, with no manual rect math.

## Two vs three players

thorvg is a bonus reference, not a hard dependency — loading it is
best-effort and never blocks the lottie-web/popcorn flow:

1. If the `?thorvg=` CDN script fails to fetch, or the WASM engine it loads
   fails to initialize (bad `?thorvg=` override, offline, blocked CDN,
   corrupt/incompatible animation data), the harness logs a `warning: thorvg
   unavailable (...)` line via the on-page log, shows "thorvg unavailable
   (see log)" in its pane instead of a canvas, and continues in two-player
   mode. Nothing about the lottie-web/popcorn comparison changes.
2. `__ready()`, `seekBoth`, `__diff`, `__gridDiff`, `__inspect`, and
   `__inspectCell` all degrade transparently: with `ref` left at its default
   (`'lottie'`), or omitted, they behave exactly as they did before thorvg
   support existed.
3. Passing `ref='thorvg'` (or calling `__refDiff`) when thorvg is
   unavailable **throws** an `Error` with a one-line message — that's a
   caller mistake (asking for a reference that isn't there), not a soft
   `{ error }` return like "canvas not ready".
4. `__scan()`'s per-frame shape depends on availability too — see its docs
   above.

## Working offline

By default the page loads lottie-web from a CDN
(`cdnjs.cloudflare.com/.../bodymovin/5.12.2/lottie.min.js`) and thorvg from
`unpkg.com/@thorvg/lottie-player@1.0.9/dist/lottie-player.js`, so nothing
binary is committed to the repo. For offline use, drop local copies at
`tools/harness/vendor/lottie.min.js` / `tools/harness/vendor/lottie-player.js`
(gitignored via the repo's `dist/` pattern doesn't cover it — create the
files yourself, they won't be tracked unless you `git add` them) and pass
`?lottie=./vendor/lottie.min.js&thorvg=./vendor/lottie-player.js`. Note
thorvg's own WASM binary is fetched from a version-pinned unpkg URL baked
into its bundle at build time regardless of where you loaded the JS from —
true offline use needs thorvg's `wasmUrl` property pointed at a local
`thorvg.wasm` too (not currently wired up by this harness; two-player mode
works fully offline either way).

## Fixtures

This harness intentionally ships with no JSON/CSS fixtures of its own — pull
them from `examples/lottie/` (real-file smoke scenes) or the LottieFiles
conformance corpus referenced in the root `CLAUDE.md`, or use the file
pickers.
