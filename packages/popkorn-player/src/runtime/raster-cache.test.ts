import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@popkorn/parser";
import type { DeviceRect } from "../scene/bounds";
import { buildSceneGraph } from "../scene/builder";
import { RenderLoop } from "./loop";

/**
 * Raster cache, driven through the shared walk.
 *
 * The renderer below implements `cacheComposite` over its own command log
 * instead of pixels: a captured composite is the list of draw commands it
 * emitted, and a cache hit replays that list. That makes the cache's promise
 * directly assertable — with `verify` on, every hit ALSO re-runs the composite
 * and fails if the freshly drawn commands differ from the replayed ones, so a
 * stale hit (the failure mode this design fears) is caught on any scene, and
 * cache-on vs cache-off command streams can be compared frame for frame.
 */

interface CacheRenderer {
  log: string[];
  hits: number;
  misses: number;
  frames: number;
  entries(): number;
}

function createCacheRenderer(
  opts: { cache?: boolean; verify?: boolean } = {},
): // biome-ignore lint/suspicious/noExplicitAny: structural recorder, not a typed backend
any & CacheRenderer {
  const cache = opts.cache ?? true;
  const verify = opts.verify ?? true;
  const log: string[] = [];
  let sink = log;
  const store = new Map<
    string,
    { signature: string; region: string; cmds: string[] }
  >();
  const admit = new Map<string, string>();

  const rec =
    (name: string) =>
    // biome-ignore lint/suspicious/noExplicitAny: variadic recorder
    (...args: any[]) => {
      sink.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    };

  function capture(draw: () => void): string[] {
    const outer = sink;
    const cmds: string[] = [];
    sink = cmds;
    try {
      draw();
    } finally {
      sink = outer;
    }
    return cmds;
  }

  const r = {
    log,
    hits: 0,
    misses: 0,
    frames: 0,
    entries: () => store.size,
    clear: rec("clear"),
    beginFrame() {
      r.frames++;
      sink.push("beginFrame()");
    },
    endFrame: rec("endFrame"),
    drawRect: rec("drawRect"),
    drawCircle: rec("drawCircle"),
    drawEllipse: rec("drawEllipse"),
    drawPath: rec("drawPath"),
    drawText: rec("drawText"),
    drawImage: rec("drawImage"),
    clip: rec("clip"),
    setFill: rec("setFill"),
    setFillGradient: rec("setFillGradient"),
    setStroke: rec("setStroke"),
    setStrokeGradient: rec("setStrokeGradient"),
    setStrokeLineCap: rec("setStrokeLineCap"),
    setStrokeLineJoin: rec("setStrokeLineJoin"),
    setStrokeMiterLimit: rec("setStrokeMiterLimit"),
    setTrim: rec("setTrim"),
    setDash: rec("setDash"),
    setFillRule: rec("setFillRule"),
    setPaintOrder: rec("setPaintOrder"),
    setBlendMode: rec("setBlendMode"),
    setOpacity: rec("setOpacity"),
    save: rec("save"),
    restore: rec("restore"),
    transform: rec("transform"),
    setTransform: rec("setTransform"),
    getWidth: () => 400,
    getHeight: () => 300,
    resize() {},
    supportsFilter: () => true,
    compositeFilter(
      filter: string,
      drawContent: () => void,
      region?: DeviceRect,
    ) {
      sink.push(`compositeFilter(${filter},${JSON.stringify(region)})`);
      drawContent();
    },
    compositeMask(
      mode: string,
      drawContent: () => void,
      drawMask: () => void,
      region?: DeviceRect,
    ) {
      sink.push(`compositeMask(${mode},${JSON.stringify(region)})`);
      drawContent();
      drawMask();
    },
    supportsRasterCache: () => cache,
    cacheComposite(
      key: string,
      signature: string,
      region: DeviceRect,
      draw: () => void,
    ) {
      const rk = JSON.stringify(region);
      const hit = store.get(key);
      if (hit && hit.signature === signature && hit.region === rk) {
        r.hits++;
        if (verify) {
          const fresh = capture(draw);
          expect(fresh).toEqual(hit.cmds);
        }
        for (const c of hit.cmds) sink.push(c);
        return;
      }
      r.misses++;
      if (admit.get(key) !== signature) {
        admit.set(key, signature);
        draw();
        return;
      }
      const cmds = capture(draw);
      store.set(key, { signature, region: rk, cmds });
      for (const c of cmds) sink.push(c);
    },
  };
  return r;
}

function build(source: string) {
  return buildSceneGraph(parse(source));
}

// A blurred group that never changes, next to a sibling that animates: the
// blurred subtree's raster is the same every frame, and the whole point of the
// cache is that the moving sibling doesn't force it to be re-rasterized.
const STATIC_FILTER = `
:root { width: 400px; height: 300px; }
@keyframes slide { 0% { transform: translateX(0px); } 100% { transform: translateX(120px); } }
#glow {
  type: group;
  filter: blur(6px);
  > #glow-dot { type: circle; cx: 80px; cy: 80px; r: 30px; fill: #ffcc00; }
}
#runner { type: rect; x: 0px; y: 200px; width: 40px; height: 40px; fill: #ff0044;
  animation: slide 2s linear infinite; }
`;

test("a static filtered subtree hits the raster cache while a sibling animates", () => {
  const r = createCacheRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(build(STATIC_FILTER));
  loop.pause();

  for (let t = 0; t <= 500; t += 100) loop.seek(t);

  // Frame 1 draws through (admission), frame 2 captures, the rest hit.
  expect(r.hits).toBeGreaterThanOrEqual(3);
  expect(r.entries()).toBe(1);
});

test("an animated filtered subtree never hits (its raster changes every frame)", () => {
  const r = createCacheRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(
    build(`
:root { width: 400px; height: 300px; }
@keyframes pulse { 0% { r: 10px; } 100% { r: 40px; } }
#glow {
  type: group;
  filter: blur(6px);
  > #glow-dot { type: circle; cx: 80px; cy: 80px; r: 10px; fill: #ffcc00;
    animation: pulse 2s linear infinite; }
}
`),
  );
  loop.pause();
  for (let t = 0; t <= 500; t += 100) loop.seek(t);

  expect(r.hits).toBe(0);
  expect(r.entries()).toBe(0);
});

test("an animated ancestor transform misses: the world matrix is in the key", () => {
  const r = createCacheRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(
    build(`
:root { width: 400px; height: 300px; }
@keyframes slide { 0% { transform: translateX(0px); } 100% { transform: translateX(120px); } }
#mover {
  type: group;
  animation: slide 2s linear infinite;
  > #glow {
    type: group;
    filter: blur(6px);
    > #glow-dot { type: circle; cx: 80px; cy: 80px; r: 30px; fill: #ffcc00; }
  }
}
`),
  );
  loop.pause();
  for (let t = 0; t <= 500; t += 100) loop.seek(t);

  expect(r.hits).toBe(0);
});

test("a masked subtree caches, and re-misses when the mask source moves", () => {
  const source = `
:root { width: 400px; height: 300px; }
@keyframes sweep { 0% { transform: translateX(0px); } 100% { transform: translateX(200px); } }
#card {
  type: rect; x: 40px; y: 40px; width: 200px; height: 120px; fill: #3355ff;
  mask: #wipe alpha;
}
#wipe { type: rect; x: 0px; y: 40px; width: 120px; height: 120px; fill: #ffffff; }
`;
  const stillR = createCacheRenderer();
  const still = new RenderLoop(stillR);
  still.setScene(build(source));
  still.pause();
  for (let t = 0; t <= 400; t += 100) still.seek(t);
  expect(stillR.hits).toBeGreaterThanOrEqual(3);

  const movingR = createCacheRenderer();
  const moving = new RenderLoop(movingR);
  moving.setScene(
    build(
      source.replace(
        "fill: #ffffff;",
        "fill: #ffffff; animation: sweep 2s linear infinite;",
      ),
    ),
  );
  moving.pause();
  for (let t = 0; t <= 400; t += 100) moving.seek(t);
  // The source subtree is part of the composite's content token, so its motion
  // invalidates the masked node's raster.
  expect(movingR.hits).toBe(0);
});

// Invariant 4: the timeline is a pure function of time. The cache keys on
// resolved state, so returning to t reproduces the frame — and (because the
// state at t is byte-identical to the first visit) it reproduces it FROM THE
// CACHE rather than re-rasterizing.
test("seek idempotence: the same time renders the same commands, cached or not", () => {
  const cached = createCacheRenderer();
  const plain = createCacheRenderer({ cache: false });
  const a = new RenderLoop(cached);
  const b = new RenderLoop(plain);
  a.setScene(build(STATIC_FILTER));
  b.setScene(build(STATIC_FILTER));
  a.pause();
  b.pause();

  const times = [0, 0, 700, 0, 1300, 0];
  const frames: string[][] = [];
  for (const t of times) {
    a.seek(t);
    b.seek(t);
    frames.push(cached.log.splice(0));
    expect(frames.at(-1)).toEqual(plain.log.splice(0));
  }
  // Every visit to t=0 produced the identical command stream.
  const atZero = [frames[0], frames[1], frames[3], frames[5]];
  for (const f of atZero) expect(f).toEqual(atZero[0]);
  expect(cached.hits).toBeGreaterThan(0);
});

test("hover state on a filtered node invalidates its cached raster", () => {
  const r = createCacheRenderer();
  const loop = new RenderLoop(r);
  const root = build(`
:root { width: 400px; height: 300px; }
#glow {
  type: group;
  filter: blur(6px);
  > #glow-dot { type: circle; cx: 80px; cy: 80px; r: 30px; fill: #ffcc00; }
}
`);
  loop.setScene(root);
  loop.pause();
  for (let t = 0; t <= 300; t += 100) loop.seek(t);
  const hitsBefore = r.hits;
  expect(hitsBefore).toBeGreaterThan(0);

  // Mutating the resolved fill directly stands in for any late-stage override
  // (hover, machine state): the content token must move with it.
  const dot = root.children[0].children[0];
  dot.base.fill = "#00ff00";
  loop.seek(400);
  loop.seek(500);
  expect(r.hits).toBe(hitsBefore); // the next two frames both missed
});

// The gallery is the smoke corpus for staleness: every scene, every frame, with
// `verify` on — each cache hit is checked against a freshly drawn composite, so
// any resolved state the content token fails to cover (a machine state, a
// visibility window, a time-remapped subtree, an animated gradient or clip)
// surfaces here as a mismatch rather than as a frozen sublayer on canvas.
// The gallery test above renders every scene passively along the timeline —
// no scene ever undergoes a state-MACHINE transition mid-run, so a stale
// composite that only a transition would expose (a frozen sublayer after a
// click) can't surface there. This test forces one: click the volume
// machine's Increase button between two renders of the same wall-times and
// checks the masked/filtered composites under #master actually change.
test("a machine transition invalidates cached composites (no frozen sublayer after a click)", () => {
  const dir = join(import.meta.dir, "../../../../examples/popkorn");
  const source = readFileSync(
    join(dir, "13-lottie--interactive-volume.css"),
    "utf8",
  );
  const r = createCacheRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(build(source));

  const times = [0, 137, 274, 411];

  // Render pre-click frames (state "l1") and admit their composites.
  loop.pause();
  const before = times.map((t) => {
    loop.seek(t);
    return r.log.splice(0);
  });
  // Re-render the same times: this must be all hits, proving the harness (and
  // this scene) caches at all before we go anywhere near a transition.
  const repeat = times.map((t) => {
    loop.seek(t);
    return r.log.splice(0);
  });
  for (let i = 0; i < times.length; i++) expect(repeat[i]).toEqual(before[i]);
  const hitsBeforeClick = r.hits;
  expect(hitsBeforeClick).toBeGreaterThan(0);

  expect(loop.getStateMachineRunner().currentState("vol")).toBe("l1");

  // Force the machine transition the way the input layer actually reports a
  // tap: a live rAF tick sees cursor.isDown/pressed, not seek() (seek() stays
  // a pure function of time and never evaluates machines — see loop.ts).
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const prevRaf = g.requestAnimationFrame;
  const prevCancel = g.cancelAnimationFrame;
  const q: ((t: number) => void)[] = [];
  g.requestAnimationFrame = (cb) => q.push(cb);
  g.cancelAnimationFrame = () => {};
  try {
    loop.start(); // live frame 0, schedules frame 1

    // #Increase-button sits directly under :root at translate(751.38, 860.79)
    // with a 67.74px ellipse at its local origin — click dead center.
    const cursor = loop.getInputTracker().getState().cursor;
    cursor.x = 751.38;
    cursor.y = 860.79;
    cursor.isDown = true;
    cursor.pressed = true; // set by InputTracker.handleMouseDown / RN onTouch
    cursor.isDown = false; // release before the next frame samples

    q.shift()?.(16); // live frame 1 — detects the latched tap
    loop.stop();
  } finally {
    g.requestAnimationFrame = prevRaf;
    g.cancelAnimationFrame = prevCancel;
  }

  expect(loop.getStateMachineRunner().currentState("vol")).toBe("up2");

  // Same wall-times, new machine state: nothing may replay the pre-click
  // composites. `verify` (on by default) already fails loudly if a hit ever
  // replays commands a fresh draw wouldn't reproduce — this asserts the
  // stronger, more specific claim that the command streams actually moved.
  loop.pause();
  r.log.splice(0); // drop the click's own live-frame draws, not part of this comparison
  const missesBeforeAfter = r.misses;
  const after = times.map((t) => {
    loop.seek(t);
    return r.log.splice(0);
  });
  for (let i = 0; i < times.length; i++)
    expect(after[i]).not.toEqual(before[i]);
  expect(r.misses).toBeGreaterThan(missesBeforeAfter);

  // And the inverse: once settled in the new state, revisiting a time still
  // hits from the cache rather than missing forever. `after` above was each
  // key's first post-transition sighting (admission only, per the harness's
  // admit-then-cache miss protocol — see cacheComposite above); one more pass
  // admits the new composites into the store, and only the pass after that is
  // eligible to hit.
  for (const t of times) loop.seek(t);
  const hitsBeforeSettle = r.hits;
  for (const t of times) loop.seek(t);
  expect(r.hits).toBeGreaterThan(hitsBeforeSettle);
});

test("gallery: no cached composite ever differs from a freshly drawn one", () => {
  const dir = join(import.meta.dir, "../../../../examples/popkorn");
  const files = [...new Bun.Glob("*.css").scanSync({ cwd: dir })].sort();
  let hits = 0;
  for (const f of files) {
    const r = createCacheRenderer();
    const loop = new RenderLoop(r);
    loop.setScene(build(readFileSync(join(dir, f), "utf8")));
    loop.pause();
    for (let i = 0; i < 24; i++) loop.seek(i * 137);
    // Revisit earlier times: the cache must serve them from state, not sequence.
    for (let i = 0; i < 8; i++) loop.seek(i * 137);
    hits += r.hits;
  }
  expect(files.length).toBeGreaterThan(0);
  expect(hits).toBeGreaterThan(0);
});
