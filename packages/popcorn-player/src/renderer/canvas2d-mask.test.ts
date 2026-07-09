import { expect, test } from "bun:test";
import { Canvas2DRenderer } from "./canvas2d";

// A minimal recording 2D context. Tracks clearRect ("frame begins") and blit
// drawImage calls so we can reason about which buffer got wiped when. Enough
// surface for beginFrame() + the compositeMask blit tail.
function recCtx(width: number, height: number, tag: string, log: string[]) {
  const ctx: any = {
    tag,
    canvas: { width, height },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none", // a string, so supportsFilter() sees it
    setTransform() {},
    clearRect() {
      log.push(`clear:${tag}`);
    },
    save() {},
    restore() {},
    // Record the active filter on the blit so compositeFilter can be asserted.
    drawImage(src: any) {
      const f =
        this.filter && this.filter !== "none" ? ` filter=${this.filter}` : "";
      log.push(`blit:${src?.tag ?? "?"}->${tag}${f}`);
    },
  };
  ctx.canvas.tag = tag; // so drawImage(b.canvas) can report the source tag
  return ctx;
}

function mockMain(width: number, height: number, log: string[]) {
  const ctx = recCtx(width, height, "main", log);
  return { getContext: () => ctx } as any;
}

// The real ensureOffscreen returns null under bun (no document/OffscreenCanvas),
// which short-circuits compositeMask before the depth logic runs. Stub it to
// mint one recording buffer per index so the re-entrancy path executes.
function stubOffscreen(r: any, log: string[]) {
  const requested: number[] = [];
  const buffers = new Map<number, any>();
  r.ensureOffscreen = (index: number) => {
    requested.push(index);
    let b = buffers.get(index);
    if (!b) {
      b = recCtx(300, 200, `off${index}`, log);
      buffers.set(index, b);
    }
    return b;
  };
  return { requested, buffers };
}

test("compositeMask nests: inner matte claims a distinct buffer pair and depth is restored", () => {
  const log: string[] = [];
  const r = new Canvas2DRenderer(mockMain(300, 200, log));
  const { requested, buffers } = stubOffscreen(r as any, log);

  let innerRan = false;
  r.compositeMask(
    "alpha",
    () => {
      // Outer content draws, and partway through re-enters with a nested matte.
      r.compositeMask(
        "alpha",
        () => {
          innerRan = true;
        },
        () => {},
      );
    },
    () => {},
  );

  expect(innerRan).toBe(true);
  // Outer used indices 0/1; the nested call at depth 1 used 2/3 — disjoint pairs.
  expect(requested).toContain(0);
  expect(requested).toContain(1);
  expect(requested).toContain(2);
  expect(requested).toContain(3);
  expect(buffers.get(0)).not.toBe(buffers.get(2));
  expect(buffers.get(1)).not.toBe(buffers.get(3));

  // The inner matte cleared its own buffers (off2/off3), never the outer content
  // buffer (off0). That wipe was the original bug — the outer subtree vanished.
  const off0ClearsBeforeInnerBlit = log.filter(
    (l) => l === "clear:off0",
  ).length;
  expect(off0ClearsBeforeInnerBlit).toBe(1); // off0 cleared exactly once, by the outer's own beginFrame
  expect(log).toContain("clear:off2");
  expect(log).toContain("clear:off3");

  // Depth is balanced back to 0 so the next top-level mask starts at buffer 0.
  expect((r as any).maskDepth).toBe(0);
});

test("compositeFilter renders content offscreen then blits it back through ctx.filter", () => {
  const log: string[] = [];
  const r = new Canvas2DRenderer(mockMain(300, 200, log));
  stubOffscreen(r as any, log);

  let ran = false;
  r.compositeFilter("blur(16px)", () => {
    ran = true;
  });

  expect(ran).toBe(true);
  expect(log).toContain("clear:off0"); // offscreen prepared via beginFrame
  expect(log).toContain("blit:off0->main filter=blur(16px)"); // blit carries the filter
  expect((r as any).maskDepth).toBe(0); // depth balanced
});

test("compositeFilter shares the composite depth so a nested composite claims a deeper band", () => {
  const log: string[] = [];
  const r = new Canvas2DRenderer(mockMain(300, 200, log));
  const { requested } = stubOffscreen(r as any, log);

  r.compositeFilter("blur(4px)", () => {
    // A mask nested inside the filter must not reuse the filter's buffer 0.
    r.compositeMask(
      "alpha",
      () => {},
      () => {},
    );
  });

  expect(requested).toContain(0); // filter's own buffer
  expect(requested).toContain(2); // nested mask claimed the next band (depth 1)
  expect(requested).toContain(3);
  expect((r as any).maskDepth).toBe(0);
});

test("compositeMask depth restores even if a draw closure throws", () => {
  const log: string[] = [];
  const r = new Canvas2DRenderer(mockMain(300, 200, log));
  stubOffscreen(r as any, log);

  expect(() =>
    r.compositeMask(
      "alpha",
      () => {
        throw new Error("boom");
      },
      () => {},
    ),
  ).toThrow("boom");
  expect((r as any).maskDepth).toBe(0);
});
