import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@popkorn/parser";
import {
  AnimationScheduler,
  buildSceneGraph,
  type Matrix3x3,
  multiplyMatrices,
  type Renderer,
  RenderLoop,
} from "@popkorn/player";
import { convertLottie } from "./lottie2popkorn.js";
import { convertPopkorn } from "./popkorn2lottie.js";

const GALLERY = join(import.meta.dir, "..", "..", "..", "examples", "popkorn");

interface Draw {
  x: number;
  y: number;
  lin: number[];
  alpha: number;
}

/** Plays `source` and records each painted primitive's world centre, linear matrix and alpha. */
function drawsAt(source: string, times: number[]): Draw[][] {
  const ast = parse(source);
  let m: Matrix3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const stack: Matrix3x3[] = [];
  let alpha = 1;
  let draws: Draw[] = [];
  const rec = (cx: number, cy: number) => {
    if (alpha < 0.01) return;
    draws.push({
      x: m[0] * cx + m[1] * cy + m[2],
      y: m[3] * cx + m[4] * cy + m[5],
      lin: [m[0], m[1], m[3], m[4]],
      alpha,
    });
  };
  const impl: Partial<Renderer> = {
    beginFrame: () => {
      alpha = 1;
    },
    save: () => {
      stack.push(m);
    },
    restore: () => {
      m = stack.pop() ?? m;
    },
    transform: (t) => {
      m = multiplyMatrices(m, t);
    },
    setTransform: (t) => {
      m = t;
    },
    setOpacity: (a) => {
      alpha = a;
    },
    drawRect: (x, y, w, h) => rec(x + w / 2, y + h / 2),
    drawCircle: (cx, cy) => rec(cx, cy),
    drawEllipse: (cx, cy) => rec(cx, cy),
    // A path's start point survives the round trip; its control-hull box doesn't.
    drawPath: (cmds) => {
      const m0 = cmds[0];
      if (m0?.type === "M") rec(m0.x, m0.y);
    },
    getWidth: () => 400,
    getHeight: () => 400,
  };
  const renderer = new Proxy(impl as Renderer, {
    get: (t, k) => (t as any)[k] ?? (() => {}),
  });
  const loop = new RenderLoop(renderer, new AnimationScheduler());
  loop.setScene(buildSceneGraph(ast));
  loop.setSceneSize(ast.canvas?.width ?? 400, ast.canvas?.height ?? 300);
  loop.getVariableResolver().setVariables(ast.variables);
  if (ast.canvas?.background) loop.setBackgroundColor(ast.canvas.background);
  return times.map((t) => {
    draws = [];
    loop.seek(t);
    return draws;
  });
}

function roundTrip(source: string) {
  const { lottie, warnings } = convertPopkorn(source);
  const back = convertLottie(JSON.parse(JSON.stringify(lottie)));
  return { lottie: lottie as any, warnings, css: back.css };
}

describe("popkorn2lottie", () => {
  test("static scene emits static values and a background", () => {
    const { lottie, warnings } = roundTrip(`
      :root { width: 100px; height: 80px; background: #102030; }
      #box { type: rect; x: 10px; y: 20px; width: 30px; height: 10px; fill: #ff0000; }
    `);
    expect(warnings).toEqual([]);
    expect(lottie.op).toBe(1);
    const [scene, bg] = lottie.layers[0].shapes;
    expect(bg.nm).toBe("background");
    const box = scene.it[0];
    expect(box.nm).toBe("box");
    const [shape] = box.it;
    const rc = shape.it[0];
    expect(rc.ty).toBe("rc");
    expect(rc.p).toEqual({ a: 0, k: [25, 25] });
    expect(rc.s).toEqual({ a: 0, k: [30, 10] });
    expect(shape.it[1]).toMatchObject({
      ty: "fl",
      c: { a: 0, k: [1, 0, 0, 1] },
    });
  });

  test("clip-path splits layers and masks in scene space; nested clips intersect", () => {
    const { lottie, warnings } = convertPopkorn(`
      :root { width: 200px; height: 100px; }
      #a { type: rect; width: 10px; height: 10px; fill: #f00; }
      #g { type: group; transform: translate(50px, 0px); clip-path: circle(10 at 5 5);
        > #r { type: rect; width: 20px; height: 20px; fill: #0f0; }
        > #in { type: rect; width: 8px; height: 8px; fill: #00f; clip-path: inset(2px); }
      }
      #c { type: rect; width: 10px; height: 10px; fill: #fff; }
    `) as { lottie: any; warnings: string[] };
    expect(warnings).toEqual([]);
    expect(lottie.layers.map((l: any) => l.nm)).toEqual([
      "scene",
      "clip #g #in",
      "clip #g",
      "scene",
    ]);
    expect(lottie.layers.map((l: any) => l.ind)).toEqual([1, 2, 3, 4]);
    const [outer, inner] = lottie.layers[1].masksProperties;
    expect(outer.mode).toBe("a");
    expect(inner.mode).toBe("i");
    const xs = (m: any) => m.pt.k.v.map((p: number[]) => p[0]);
    expect(Math.min(...xs(outer))).toBeCloseTo(45, 3);
    expect(Math.max(...xs(outer))).toBeCloseTo(65, 3);
    expect(inner.pt.k.v).toEqual([
      [52, 2],
      [56, 2],
      [56, 6],
      [52, 6],
    ]);
    expect(lottie.layers[2].masksProperties).toHaveLength(1);
    expect(lottie.layers[0].masksProperties).toBeUndefined();
  });

  test("decomposes rotate/scale around transform-origin with anchor = origin", () => {
    const { lottie } = roundTrip(`
      :root { width: 200px; height: 200px; }
      #b { type: rect; x: 0px; y: 0px; width: 40px; height: 20px; fill: #fff;
           transform: translate(50px, 60px) rotate(30deg) scale(2, 0.5);
           transform-origin: 50% 50%; }
    `);
    const tr = lottie.layers[0].shapes[0].it[0].it.at(-1);
    expect(tr.a.k).toEqual([20, 10]);
    expect(tr.p.k).toEqual([70, 70]);
    expect(tr.r.k).toBeCloseTo(30, 3);
    expect(tr.s.k[0]).toBeCloseTo(200, 3);
    expect(tr.s.k[1]).toBeCloseTo(50, 3);
    expect(tr.sk.k).toBeCloseTo(0, 3);
  });

  test("linear motion collapses to its endpoints; rotation unwraps past 180", () => {
    const { lottie } = roundTrip(`
      :root { width: 200px; height: 200px; }
      #b { type: circle; r: 5px; fill: #fff; animation: go 1s linear; }
      @keyframes go {
        from { transform: translate(0px, 0px) rotate(0deg); }
        to { transform: translate(100px, 0px) rotate(350deg); }
      }
    `);
    expect(lottie.op).toBe(30);
    const tr = lottie.layers[0].shapes[0].it[0].it.at(-1);
    expect(tr.p.k.map((k: any) => k.t)).toEqual([0, 30]);
    expect(tr.p.k[1].s).toEqual([100, 0]);
    expect(tr.r.k.at(-1).s[0]).toBeCloseTo(350, 3);
  });

  test("paint order follows z-index (topmost first in Lottie)", () => {
    const { lottie } = roundTrip(`
      :root { width: 100px; height: 100px; }
      #a { type: circle; r: 5px; fill: #f00; z-index: 2; }
      #b { type: circle; r: 5px; fill: #0f0; }
      #c { type: circle; r: 5px; fill: #00f; }
    `);
    const names = lottie.layers[0].shapes[0].it
      .slice(0, -1)
      .map((g: any) => g.nm);
    expect(names).toEqual(["a", "c", "b"]);
  });

  test("unsupported features warn with ids", () => {
    const { warnings } = roundTrip(`
      :root { width: 100px; height: 100px; }
      #t { type: text; content: "hi"; }
      #g { type: circle; r: 5px; fill: #fff; filter: blur(2px); }
    `);
    expect(warnings).toContain("text not exported: #t");
    expect(warnings).toContain("filter/box-shadow not exported: #g");
  });

  test("path morph animates one sh with compatible vertices", () => {
    const { lottie } = roundTrip(`
      :root { width: 100px; height: 100px; }
      #p { type: path; d: "M0 0 L10 0 L10 10 Z"; fill: #fff; animation: m 1s ease-in-out; }
      @keyframes m { to { d: "M0 0 L20 0 L20 20 Z"; } }
    `);
    const sh = lottie.layers[0].shapes[0].it[0].it[0].it[0];
    expect(sh.ty).toBe("sh");
    expect(sh.ks.a).toBe(1);
    expect(sh.ks.k[0].s[0].v).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(sh.ks.k.at(-1).s[0].v).toEqual([
      [0, 0],
      [20, 0],
      [20, 20],
    ]);
  });

  // Gallery -> Lottie -> Popkorn must paint the same primitives at the same world pose/alpha.
  for (const name of [
    "02-basics--bounce-and-cascade.css",
    "03-hierarchy.css",
    "06-morph--jellyfish.css",
    "05-trim-path.css",
    "04-symbols-and-motion-path.css",
    "16-procedural--x-logo.css",
  ]) {
    test(`round-trips ${name}`, () => {
      const source = readFileSync(join(GALLERY, name), "utf8");
      const { lottie, css } = roundTrip(source);
      expect(() => parse(css)).not.toThrow();
      const frames = [0, 0.27, 0.5, 0.81].map((f) => Math.round(f * lottie.op));
      const times = frames.map((f) => (f * 1000) / lottie.fr);
      const a = drawsAt(source, times);
      const b = drawsAt(css, times);
      for (let i = 0; i < times.length; i++) {
        // Text/images/filters are dropped by the export, so compare as a subsequence.
        let j = 0;
        for (const d of b[i]) {
          while (
            j < a[i].length &&
            (Math.abs(a[i][j].x - d.x) > 1 || Math.abs(a[i][j].y - d.y) > 1)
          )
            j++;
          expect(j).toBeLessThan(a[i].length);
          const o = a[i][j++];
          for (let k = 0; k < 4; k++)
            expect(Math.abs(o.lin[k] - d.lin[k])).toBeLessThan(0.02);
          expect(Math.abs(o.alpha - d.alpha)).toBeLessThan(0.02);
        }
        expect(b[i].length).toBeGreaterThan(a[i].length * 0.6);
      }
    });
  }
});

describe("popkorn2lottie input(time) with an export length", () => {
  const countAnimated = (v: unknown): number => {
    if (!v || typeof v !== "object") return 0;
    const o = v as Record<string, unknown>;
    return (
      (o.a === 1 ? 1 : 0) +
      Object.values(o).reduce<number>((n, c) => n + countAnimated(c), 0)
    );
  };
  const field = readFileSync(
    join(GALLERY, "17-procedural--particle-field.css"),
    "utf8",
  );

  test("without a length it freezes and warns", () => {
    const { lottie, warnings } = convertPopkorn(field);
    expect(countAnimated(lottie)).toBe(0);
    expect(warnings.some((w) => w.includes("frozen"))).toBe(true);
  });

  test("durationMs samples time-driven frames and drops the frozen warning", () => {
    const { lottie, warnings } = convertPopkorn(field, { durationMs: 200 });
    expect((lottie as { op: number }).op).toBe(6);
    expect(countAnimated(lottie)).toBeGreaterThan(1000);
    expect(warnings.some((w) => w.includes("frozen"))).toBe(false);
  });

  test("cursor input still warns with a length", () => {
    const { warnings } = convertPopkorn(
      `:root { width: 100px; height: 100px; --x: input(cursor.x); }
       #a { type: rect; width: 10px; height: 10px; x: var(--x); }`,
      { durationMs: 1000 },
    );
    expect(warnings.some((w) => w.includes("frozen"))).toBe(true);
  });
});
