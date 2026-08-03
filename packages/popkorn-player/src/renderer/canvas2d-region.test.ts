import { afterEach, expect, test } from "bun:test";
import { Canvas2DRenderer } from "./canvas2d.js";
import type { Matrix3x3 } from "./types.js";

// Composite buffers are region-sized: a buffer's pixel (0, 0) is its region's
// device origin. These tests pin the coordinate translation that convention
// forces — source rects, blit destinations, the mask combine, the luminance
// readback, and the device-space transforms the content closures set.

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
  gco: string;
  filter: string;
}

interface Log {
  blits: Blit[];
  transforms: { tag: string; e: number; f: number }[];
  clears: { tag: string; x: number; y: number; w: number; h: number }[];
  lumas: { tag: string; x: number; y: number; w: number; h: number }[];
}

function newLog(): Log {
  return { blits: [], transforms: [], clears: [], lumas: [] };
}

function recCtx(width: number, height: number, tag: string, log: Log) {
  const ctx: any = {
    canvas: { width, height, tag },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    setTransform(_a: number, _b: number, _c: number, _d: number, e = 0, f = 0) {
      log.transforms.push({ tag, e, f });
    },
    clearRect(x: number, y: number, w: number, h: number) {
      log.clears.push({ tag, x, y, w, h });
    },
    getImageData(x: number, y: number, w: number, h: number) {
      log.lumas.push({ tag, x, y, w, h });
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData() {},
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    drawImage(
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
        gco: ctx.globalCompositeOperation,
        filter: ctx.filter,
      });
    },
  };
  return ctx;
}

function mockMain(width: number, height: number, log: Log) {
  return { getContext: () => recCtx(width, height, "main", log) } as any;
}

// Real ensureOffscreen returns null under bun (no document/OffscreenCanvas), so
// mint recording buffers instead — sized as the real one would be (grid-rounded,
// grow-only), so the source-rect assertions face a buffer bigger than its region.
function stubOffscreen(r: any, log: Log) {
  const sizes: { index: number; w: number; h: number }[] = [];
  const buffers = new Map<number, any>();
  r.ensureOffscreen = (index: number, w: number, h: number) => {
    sizes.push({ index, w, h });
    const gw = Math.ceil(w / 64) * 64,
      gh = Math.ceil(h / 64) * 64;
    let b = buffers.get(index);
    if (!b) {
      b = recCtx(gw, gh, `off${index}`, log);
      buffers.set(index, b);
    }
    b.canvas.width = Math.max(b.canvas.width, gw);
    b.canvas.height = Math.max(b.canvas.height, gh);
    return b;
  };
  return { sizes, buffers };
}

/** A translate-only device matrix. */
function translate(tx: number, ty: number): Matrix3x3 {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

test("compositeFilter blits the region from the buffer's corner to its device position", () => {
  const log = newLog();
  const r = new Canvas2DRenderer(mockMain(800, 600, log));
  const { sizes } = stubOffscreen(r as any, log);

  r.compositeFilter(
    "blur(4px)",
    () => {
      // The content draws in device space; the buffer's offset is folded in.
      r.setTransform(translate(300, 200));
    },
    { x: 290, y: 190, width: 100, height: 80 },
  );

  // Buffer asked for region size, not canvas size.
  expect(sizes).toEqual([{ index: 0, w: 100, h: 80 }]);
  // Clear/clip open at the buffer's corner.
  expect(log.clears).toEqual([{ tag: "off0", x: 0, y: 0, w: 100, h: 80 }]);
  // A device translate of (300,200) lands at (10,10) inside a buffer whose
  // origin is (290,190).
  expect(log.transforms).toContainEqual({ tag: "off0", e: 10, f: 10 });
  // Source is the region at the buffer corner; destination is its device rect.
  expect(log.blits).toEqual([
    {
      src: "off0",
      dst: "main",
      sx: 0,
      sy: 0,
      sw: 100,
      sh: 80,
      dx: 290,
      dy: 190,
      dw: 100,
      dh: 80,
      gco: "source-over",
      filter: "blur(4px)",
    },
  ]);
});

test("compositeMask combines both buffers corner-to-corner and blits to the device rect", () => {
  const log = newLog();
  const r = new Canvas2DRenderer(mockMain(800, 600, log));
  stubOffscreen(r as any, log);
  const region = { x: 120, y: 40, width: 60, height: 50 };

  r.compositeMask(
    "luminance-invert",
    () => r.setTransform(translate(120, 40)),
    () => r.setTransform(translate(150, 60)),
    region,
  );

  // Content and mask buffers share the region origin, so the world transforms
  // shift by the same amount and the two rasters stay aligned.
  expect(log.transforms).toContainEqual({ tag: "off0", e: 0, f: 0 });
  expect(log.transforms).toContainEqual({ tag: "off1", e: 30, f: 20 });
  // Luminance readback covers the region at the buffer corner.
  expect(log.lumas).toEqual([{ tag: "off1", x: 0, y: 0, w: 60, h: 50 }]);

  const [combine, out] = log.blits;
  expect(combine).toMatchObject({
    src: "off1",
    dst: "off0",
    sx: 0,
    sy: 0,
    sw: 60,
    sh: 50,
    dx: 0,
    dy: 0,
    gco: "destination-out", // inverted mode
  });
  expect(out).toMatchObject({
    src: "off0",
    dst: "main",
    sx: 0,
    sy: 0,
    sw: 60,
    sh: 50,
    dx: 120,
    dy: 40,
    dw: 60,
    dh: 50,
  });
});

test("a filter nested in a mask blits relative to the outer buffer's origin", () => {
  const log = newLog();
  const r = new Canvas2DRenderer(mockMain(800, 600, log));
  stubOffscreen(r as any, log);

  r.compositeMask(
    "alpha",
    () => {
      r.compositeFilter(
        "blur(2px)",
        () => {
          r.setTransform(translate(240, 130));
        },
        { x: 230, y: 120, width: 40, height: 30 },
      );
    },
    () => {},
    { x: 200, y: 100, width: 200, height: 150 },
  );

  // The inner content sits at (240,130) device = (10,10) in a buffer whose
  // origin is (230,120).
  expect(log.transforms).toContainEqual({ tag: "off2", e: 10, f: 10 });
  const inner = log.blits.find((b) => b.src === "off2")!;
  // Destination is the inner region expressed in the OUTER buffer's pixels:
  // (230,120) - (200,100).
  expect(inner).toMatchObject({
    dst: "off0",
    sx: 0,
    sy: 0,
    sw: 40,
    sh: 30,
    dx: 30,
    dy: 20,
    filter: "blur(2px)",
  });
  // ...and the outer composite still lands at its own device position.
  const outer = log.blits.find((b) => b.dst === "main")!;
  expect(outer).toMatchObject({ dx: 200, dy: 100, dw: 200, dh: 150 });
});

test("an empty region composites nothing", () => {
  const log = newLog();
  const r = new Canvas2DRenderer(mockMain(800, 600, log));
  stubOffscreen(r as any, log);
  let drew = false;
  r.compositeFilter("blur(2px)", () => (drew = true), {
    x: 10,
    y: 10,
    width: 0,
    height: 4,
  });
  expect(drew).toBe(false);
  expect(log.blits).toEqual([]);
});

test("the current target's size never leaks into getWidth/getHeight", () => {
  const log = newLog();
  const r = new Canvas2DRenderer(mockMain(800, 600, log));
  stubOffscreen(r as any, log);
  let seen: number[] = [];
  r.compositeFilter(
    "blur(2px)",
    () => {
      seen = [r.getWidth(), r.getHeight()];
    },
    { x: 0, y: 0, width: 64, height: 64 },
  );
  // The walk clamps its device bounds against these, so they must stay the
  // main canvas's even while a small composite buffer is the draw target.
  expect(seen).toEqual([800, 600]);
});

// ---------------------------------------------------------------------------
// Allocation policy — exercised against the real ensureOffscreen by faking the
// document.createElement('canvas') that createOffscreen reaches for.
// ---------------------------------------------------------------------------

const realDocument = (globalThis as any).document;
afterEach(() => {
  if (realDocument === undefined) delete (globalThis as any).document;
  else (globalThis as any).document = realDocument;
});

function fakeCanvasDocument() {
  (globalThis as any).document = {
    createElement() {
      const canvas: any = { width: 0, height: 0 };
      canvas.getContext = () => ({ canvas });
      return canvas;
    },
  };
}

test("offscreen buffers round up to a 64px grid, grow only, and reset on resize", () => {
  fakeCanvasDocument();
  const log = newLog();
  const r = new Canvas2DRenderer(mockMain(2160, 2160, log)) as any;

  const a = r.ensureOffscreen(0, 100, 70);
  expect([a.canvas.width, a.canvas.height]).toEqual([128, 128]);

  // A region shrinking (or jittering under the grid) keeps the same buffer.
  const b = r.ensureOffscreen(0, 90, 20);
  expect(b).toBe(a);
  expect([a.canvas.width, a.canvas.height]).toEqual([128, 128]);

  // Growth rounds up and never drops below the request.
  const c = r.ensureOffscreen(0, 300, 20);
  expect(c).toBe(a);
  expect(a.canvas.width).toBe(320);
  expect(a.canvas.height).toBe(128);

  // resize drops the pool so a shrunken canvas stops retaining the old buffers.
  r.resize(400, 400);
  const d = r.ensureOffscreen(0, 100, 70);
  expect(d).not.toBe(a);
  expect([d.canvas.width, d.canvas.height]).toEqual([128, 128]);
});
