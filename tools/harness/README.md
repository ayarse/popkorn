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
