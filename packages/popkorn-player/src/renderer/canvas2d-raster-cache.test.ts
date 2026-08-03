import { expect, test } from "bun:test";
import type { DeviceRect } from "../scene/bounds";
import { Canvas2DRenderer } from "./canvas2d";

// Storage side of the raster cache: admission, blit geometry, LRU eviction and
// the guards that refuse to store a raster that isn't final. The shared walk's
// half (what a signature is made of) lives in runtime/raster-cache.test.ts.

interface Blit {
  src: string;
  dst: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

interface Log {
  blits: Blit[];
  clears: string[];
}

function recCtx(width: number, height: number, tag: string, log: Log) {
  // biome-ignore lint/suspicious/noExplicitAny: minimal 2D context stand-in
  const ctx: any = {
    canvas: { width, height, tag },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    setTransform() {},
    clearRect() {
      log.clears.push(tag);
    },
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    arc() {},
    clip() {},
    fill() {},
    stroke() {},
    measureText: () => ({ width: 10 }),
    fillText() {},
    strokeText() {},
    setLineDash() {},
    drawImage(
      // biome-ignore lint/suspicious/noExplicitAny: canvas or bitmap source
      src: any,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) {
      log.blits.push({
        src: src?.tag ?? "?",
        dst: tag,
        sx,
        sy,
        sw,
        sh,
        dx,
        dy,
        dw,
        dh,
      });
    },
  };
  return ctx;
}

function newRenderer(w: number, h: number) {
  const log: Log = { blits: [], clears: [] };
  const main = {
    getContext: () => recCtx(w, h, "main", log),
    // biome-ignore lint/suspicious/noExplicitAny: canvas stand-in
  } as any;
  const r = new Canvas2DRenderer(main);
  let n = 0;
  const rasters: string[] = [];
  // Real buffer allocation returns null under bun (no document/OffscreenCanvas).
  // biome-ignore lint/suspicious/noExplicitAny: reaching a private seam
  (r as any).newRaster = (bw: number, bh: number) => {
    const tag = `raster${n++}`;
    rasters.push(tag);
    return recCtx(bw, bh, tag, log);
  };
  return { r, log, rasters };
}

const REGION: DeviceRect = { x: 10, y: 20, width: 60, height: 40 };

test("admission: a composite is only captured once its signature repeats", () => {
  const { r, rasters } = newRenderer(200, 200);
  let drawn = 0;
  const draw = () => {
    drawn++;
  };

  r.cacheComposite!("a", "sig1", REGION, draw); // first sighting: pass through
  expect(rasters.length).toBe(0);
  expect(drawn).toBe(1);

  r.cacheComposite!("a", "sig1", REGION, draw); // repeat: capture
  expect(rasters.length).toBe(1);
  expect(drawn).toBe(2);

  r.cacheComposite!("a", "sig1", REGION, draw); // hit: no draw at all
  expect(drawn).toBe(2);
});

test("a hit blits the raster's corner to the region's device position", () => {
  const { r, log } = newRenderer(200, 200);
  const draw = () => {};
  r.cacheComposite!("a", "sig1", REGION, draw);
  r.cacheComposite!("a", "sig1", REGION, draw);
  log.blits.length = 0;
  r.cacheComposite!("a", "sig1", REGION, draw);

  expect(log.blits).toEqual([
    {
      src: "raster0",
      dst: "main",
      sx: 0,
      sy: 0,
      sw: 60,
      sh: 40,
      dx: 10,
      dy: 20,
      dw: 60,
      dh: 40,
    },
  ]);
});

test("a changed signature re-captures instead of serving the stale raster", () => {
  const { r } = newRenderer(200, 200);
  let drawn = 0;
  const draw = () => {
    drawn++;
  };
  r.cacheComposite!("a", "sig1", REGION, draw);
  r.cacheComposite!("a", "sig1", REGION, draw);
  expect(drawn).toBe(2);
  r.cacheComposite!("a", "sig2", REGION, draw); // new state: pass through
  r.cacheComposite!("a", "sig2", REGION, draw); // repeat: re-capture
  r.cacheComposite!("a", "sig2", REGION, draw); // hit on the NEW raster
  expect(drawn).toBe(4);
});

test("LRU evicts by pixel area once the pool passes 4x the main buffer", () => {
  // Main buffer 128x128 => budget 65536 px. Each raster grid-rounds to 128x128
  // (16384 px), so the fifth insertion evicts the oldest.
  const { r } = newRenderer(128, 128);
  const region: DeviceRect = { x: 0, y: 0, width: 100, height: 100 };
  const draw = () => {};
  const admitAndCapture = (key: string) => {
    r.cacheComposite!(key, "s", region, draw);
    r.cacheComposite!(key, "s", region, draw);
  };
  for (const key of ["a", "b", "c", "d"]) admitAndCapture(key);

  let drawn = 0;
  const probe = (key: string) =>
    r.cacheComposite!(key, "s", region, () => {
      drawn++;
    });
  probe("a");
  expect(drawn).toBe(0); // still cached at the budget — and now the youngest

  admitAndCapture("f"); // over budget: evicts "b", now the least recently used
  probe("a");
  expect(drawn).toBe(0);
  probe("b");
  expect(drawn).toBe(1);
});

test("resize drops every cached raster (all were captured in the old device space)", () => {
  const { r } = newRenderer(200, 200);
  let drawn = 0;
  const draw = () => {
    drawn++;
  };
  r.cacheComposite!("a", "sig1", REGION, draw);
  r.cacheComposite!("a", "sig1", REGION, draw);
  expect(drawn).toBe(2);

  r.resize(300, 300);
  r.cacheComposite!("a", "sig1", REGION, draw);
  r.cacheComposite!("a", "sig1", REGION, draw);
  expect(drawn).toBe(4); // admission started over, nothing was served stale
});

test("a raster drawn while an image is still decoding is blitted but not stored", () => {
  const { r } = newRenderer(200, 200);
  // No Image/createImageBitmap under bun: loadImage returns null and the node is
  // inert, so drive the pending state through the cache directly.
  // biome-ignore lint/suspicious/noExplicitAny: seeding the private image cache
  (r as any).images.set("pending.png", {
    img: null,
    loaded: false,
    errored: false,
  });
  let drawn = 0;
  const draw = () => {
    drawn++;
    r.drawImage("pending.png", 0, 0, 10, 10);
  };
  r.cacheComposite!("a", "sig1", REGION, draw);
  r.cacheComposite!("a", "sig1", REGION, draw); // captures, but refuses to store
  r.cacheComposite!("a", "sig1", REGION, draw);
  expect(drawn).toBe(3); // every call still drew
});
