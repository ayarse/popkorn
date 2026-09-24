import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@popkorn/parser";
import {
  AnimationScheduler,
  buildSceneGraph,
  computeLocalMatrix,
  type SceneNode,
} from "@popkorn/player";
import { childrenInPaintOrder } from "../../popkorn-player/src/scene/node.js";
import { Converter, validate } from "./lottie2popkorn.js";

const IDENTITY_TR = {
  ty: "tr",
  p: { a: 0, k: [0, 0] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
};

/** An `rc` whose size animates between two frames with a per-segment bezier. */
function animRect(pos: number[], t0: number, t1: number, ease: number[]) {
  return {
    ty: "rc",
    p: { a: 0, k: pos },
    s: {
      a: 1,
      k: [
        {
          t: t0,
          s: [10, 10],
          o: { x: [ease[0]], y: [ease[1]] },
          i: { x: [ease[2]], y: [ease[3]] },
        },
        { t: t1, s: [20, 20] },
      ],
    },
  };
}

/** A layer whose grouped rects share one group-level stroke (hoisted union stroke). */
function hoistedStrokeComp(st: any) {
  return {
    v: "5",
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        nm: "g",
        ind: 1,
        ip: 0,
        op: 30,
        st: 0,
        ks: {
          r: { a: 0, k: 0 },
          p: { a: 0, k: [50, 50] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 100 },
        },
        shapes: [
          {
            ty: "gr",
            it: [animRect([0, 0], 0, 10, [0.1, 0, 0.9, 1]), { ...IDENTITY_TR }],
          },
          {
            ty: "gr",
            it: [animRect([5, 5], 5, 15, [0.3, 0, 0.7, 1]), { ...IDENTITY_TR }],
          },
          st,
        ],
      },
    ],
  };
}

/** Duration of the first `animation:` shorthand in the CSS, in seconds. */
function firstAnimDuration(css: string): number {
  const m = css.match(/animation:\s*[\w-]+\s+([\d.]+)s/);
  if (!m) throw new Error("no animation in output");
  return +m[1];
}
/** Delay (5th token) of the first `animation:` shorthand, in seconds (0 if omitted). */
function firstAnimDelay(css: string): number {
  const m = css.match(
    /animation:\s*[\w-]+\s+[\d.]+s\s+\w+\s+\d+(?:\s+([\d.-]+)s)?/,
  );
  if (!m) throw new Error("no animation in output");
  return m[1] ? +m[1] : 0;
}

/** Minimal one-shape comp: a spinner with rotation keyframes at the listed frames. */
function comp(op: number, kfTimes: number[], st = 0, ip = 0) {
  return {
    v: "5",
    fr: 30,
    ip,
    op,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        nm: "spinner",
        ind: 1,
        ip,
        op,
        st,
        ks: {
          r: {
            a: 1,
            k: kfTimes.map((t, i) => ({ t, s: [(i + 1) * 30], h: 0 })),
          },
          p: { a: 0, k: [50, 50] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 100 },
        },
        shapes: [
          { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
          { ty: "fl", c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } },
        ],
      },
    ],
  };
}

test("keyframes past comp op are clamped to the comp playback window", () => {
  // op = 30 frames @ 30fps = 1s, but keyframes run out to frame 120 (4s) — as AE
  // exports often leave keyframes past the work area. lottie-web renders only
  // 0..op, so the emitted animation must be ~1s, not ~4s.
  const css = new Converter().convert(comp(30, [0, 30, 60, 90, 120]));
  expect(firstAnimDuration(css)).toBeCloseTo(1, 2);
});

test("layer start-time (st) does NOT offset a layer's own keyframes", () => {
  // A layer's transform keyframe times are stored in comp-global frames, and
  // lottie-web samples them at the comp frame directly (verified: a keyframe at
  // stored time t renders at comp frame t, NOT t+st). So keyframes at t=60..120
  // play at comp frames 60..120 regardless of st — delay is (60-0)/30 = 2s, with
  // no st term. (st matters only as a precomp instance's subtree time-offset.)
  const css = new Converter().convert(
    comp(180, [60, 120], /*st*/ 60, /*ip*/ 0),
  );
  expect(firstAnimDelay(css)).toBeCloseTo(2, 2);
});

test("a layer whose keyframes are (mostly) past op holds its first keyframe (no anim)", () => {
  // Keyframes at comp frames 60,120 with op=60: only t=60 sits at the window
  // edge and t=120 is past it, so the clamp collapses the track to a single
  // in-window sample — a static first-keyframe pose, no animation.
  const css = new Converter().convert(comp(60, [60, 120], /*st*/ 0, /*ip*/ 0));
  expect(css).not.toContain("animation:");
});

/** Split position whose x and y animate on different grids with different easing. */
function splitPosComp() {
  const ease = (ox: number, ix: number) => ({
    o: { x: ox, y: 0 },
    i: { x: ix, y: 1 },
  });
  return {
    v: "5",
    fr: 30,
    ip: 0,
    op: 120,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        nm: "mover",
        ind: 1,
        ip: 0,
        op: 120,
        st: 0,
        ks: {
          p: {
            s: true,
            x: {
              a: 1,
              k: [
                { t: 0, s: [0], ...ease(0.1, 0.9), h: 0 },
                { t: 30, s: [40], h: 0 },
              ],
            },
            y: {
              a: 1,
              k: [
                { t: 0, s: [0], ...ease(0.6, 0.3), h: 0 },
                { t: 60, s: [80], h: 0 },
              ],
            },
          },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
        shapes: [
          { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
          { ty: "fl", c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } },
        ],
      },
    ],
  };
}

test("split position with per-axis easing emits independent translateX/translateY channels", () => {
  // Lottie stores separate bezier tangents per axis. x (t=0..30) and y (t=0..60)
  // diverge in both grid and easing, so folding them onto one translate() would
  // force x's curve onto y. Each axis must become its own longhand channel with
  // its own duration: 30f=1s for X, 60f=2s for Y.
  const css = new Converter().convert(splitPosComp());
  expect(css).toContain("translateX(");
  expect(css).toContain("translateY(");
  const animLine = css.match(/animation:[^;]*/)![0];
  const durs = [...animLine.matchAll(/[\w-]+\s+([\d.]+)s/g)]
    .map((m) => +m[1])
    .sort();
  expect(durs).toEqual([1, 2]); // X span 30f=1s, Y span 60f=2s — two independent channels
});

function tmComp(tmKfs: any[]) {
  const inner = {
    ty: 4,
    nm: "dot",
    ind: 1,
    ip: 0,
    op: 60,
    st: 0,
    ks: {
      p: { a: 0, k: [50, 50] },
      a: { a: 0, k: [0, 0] },
      s: { a: 0, k: [100, 100] },
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
    },
    shapes: [
      { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
      { ty: "fl", c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } },
    ],
  };
  return {
    v: "5",
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    assets: [{ id: "inner", layers: [inner] }],
    layers: [
      {
        ty: 0,
        nm: "pre",
        ind: 1,
        refId: "inner",
        ip: 0,
        op: 60,
        st: 0,
        w: 100,
        h: 100,
        ks: {
          p: { a: 0, k: [50, 50] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
        },
        tm: { a: 1, k: tmKfs },
      },
    ],
  };
}

test("precomp time remap (tm) emits a time-remap curve, not a blocked feature", () => {
  const c = new Converter();
  const css = c.convert(
    tmComp([
      { t: 0, s: [0], i: { x: [0.6], y: [1] }, o: { x: [0.4], y: [0] } },
      { t: 30, s: [2] },
    ]),
  );
  // 0 frames -> 0s in / 0s out; 30 frames @30fps -> 1s in / source 2s out.
  expect(css).toContain("time-remap:");
  expect(css).toContain("0s 0s cubic-bezier(0.4, 0, 0.6, 1)");
  expect(css).toContain("1s 2s");
  // The remap fully defines the local timeline, so plain time scoping is dropped.
  expect(css).not.toContain("time-offset:");
  expect([...c.blocked].some((b) => b.includes("time remap"))).toBe(false);
});

test("an unsupported layer effect (ef) warns instead of silently dropping, and still converts", () => {
  const doc = comp(30, [0, 30]);
  // A Tint effect (ty 20, unsupported), plus a disabled one that must stay silent.
  doc.layers[0].ef = [
    { ty: 20, nm: "Tint", en: 1 },
    { ty: 20, nm: "Fill", en: 0 },
  ];
  const c = new Converter();
  const css = c.convert(doc);
  expect(validate(css)).toEqual([]); // conversion still succeeds
  expect(c.warnings.some((w) => w.includes("layer effect 'Tint'"))).toBe(true);
  expect(c.warnings.some((w) => w.includes("Fill"))).toBe(false); // en:0 stays quiet
  expect([...c.blocked].some((b) => b.includes("effect"))).toBe(false); // warn, not block
});

test("Gaussian Blur (ty 29) maps to filter: blur(Blurriness / 4 px), no warning", () => {
  const doc = comp(30, [0, 30]);
  doc.layers[0].ef = [
    {
      ty: 29,
      nm: "Gaussian Blur",
      en: 1,
      ef: [{ ty: 0, nm: "Blurriness", v: { a: 0, k: 89.3 } }],
    },
  ];
  const c = new Converter();
  const css = c.convert(doc);
  expect(validate(css)).toEqual([]);
  expect(css).toContain("filter: blur(22.33px)"); // 89.3 / 4
  expect(c.warnings.some((w) => w.includes("Gaussian Blur"))).toBe(false); // mapped, not warned
});

test("Drop Shadow (ty 25) maps to drop-shadow() using lottie-web polar convention", () => {
  const doc = comp(30, [0, 30]);
  // color black, opacity 128/255, direction 0deg (straight up), distance 10, softness 8.
  // angle = (0 - 90)deg -> dx = 10·cos(-90°) = 0, dy = 10·sin(-90°) = -10; blur = 8/4 = 2.
  doc.layers[0].ef = [
    {
      ty: 25,
      nm: "Drop Shadow",
      en: 1,
      ef: [
        { ty: 2, nm: "Shadow Color", v: { a: 0, k: [0, 0, 0, 1] } },
        { ty: 0, nm: "Opacity", v: { a: 0, k: 128 } },
        { ty: 0, nm: "Direction", v: { a: 0, k: 0 } },
        { ty: 0, nm: "Distance", v: { a: 0, k: 10 } },
        { ty: 0, nm: "Softness", v: { a: 0, k: 8 } },
      ],
    },
  ];
  const c = new Converter();
  const css = c.convert(doc);
  expect(validate(css)).toEqual([]);
  expect(css).toContain("drop-shadow(0px -10px 2px rgba(0, 0, 0, 0.502))");
});

test("a hoisted union stroke samples the combined d on the UNION of every input grid", () => {
  // Two grouped rects animate on DIFFERENT keyframe grids ({0,10} and {5,15})
  // with different per-segment easings, sharing one group stroke. The hoisted
  // stroke must morph on the union grid {0,5,10,15} — sampling only the longest
  // (carrier) track let the stroke drift past the fills between its keyframes
  // (the cat-tail spikes). Union frames map to offsets 0/33.3/66.7/100%.
  const st = { ty: "st", c: { a: 0, k: [0, 0, 0] }, w: { a: 0, k: 4 } };
  const css = new Converter().convert(hoistedStrokeComp(st));
  expect(validate(css)).toEqual([]);
  const kfHead = css.indexOf("@keyframes");
  const kfIdx = css.indexOf("-stroke", css.indexOf("stroke:")); // stroke node exists
  expect(kfIdx).toBeGreaterThan(-1);
  // Grab the stroke node's @keyframes block and count its keyframe stops.
  const block = css.slice(css.indexOf("@keyframes", kfHead), css.length);
  const strokeKf = block.match(
    /@keyframes[^\n]*-stroke-[\w-]*k\s*\{[\s\S]*?\n\}/,
  );
  expect(strokeKf).not.toBeNull();
  const stops = strokeKf![0].match(/^\s*[\d.]+%\s*\{/gm) || [];
  expect(stops.length).toBe(4); // union of both grids, not just one carrier track
  // The frames unique to each grid must both survive: 5→33.33%, 10→66.67%.
  expect(strokeKf![0]).toContain("33.33%");
  expect(strokeKf![0]).toContain("66.67%");
});

test("Lottie lj/ml map onto stroke-linejoin / stroke-miterlimit (non-default only)", () => {
  // lj 2 -> round, ml 3 (non-default; player defaults miter/4). On the hoisted stroke node.
  const round = new Converter().convert(
    hoistedStrokeComp({
      ty: "st",
      c: { a: 0, k: [0, 0, 0] },
      w: { a: 0, k: 4 },
      lj: 2,
      ml: 3,
    }),
  );
  expect(validate(round)).toEqual([]);
  expect(round).toContain("stroke-linejoin: round");
  expect(round).toContain("stroke-miterlimit: 3");
  // lj 3 -> bevel.
  const bevel = new Converter().convert(
    hoistedStrokeComp({
      ty: "st",
      c: { a: 0, k: [0, 0, 0] },
      w: { a: 0, k: 4 },
      lj: 3,
    }),
  );
  expect(bevel).toContain("stroke-linejoin: bevel");
  // lj 1 (miter) + ml 4 are the defaults -> nothing emitted (lean output).
  const miter = new Converter().convert(
    hoistedStrokeComp({
      ty: "st",
      c: { a: 0, k: [0, 0, 0] },
      w: { a: 0, k: 4 },
      lj: 1,
      ml: 4,
    }),
  );
  expect(miter).not.toContain("stroke-linejoin");
  expect(miter).not.toContain("stroke-miterlimit");
});

test("a solid parent's opacity dims only its own rect, never its parented children", () => {
  // Lottie parenting inherits transform only, never opacity. A solid used as a
  // transform-control parent (here o=0, like lottie-logo's MASTER null-solid)
  // must not push its opacity onto the wrapper group, or every parented child
  // vanishes — the whole scene renders blank but the background. Its opacity
  // belongs on its own rect.
  const css = new Converter().convert({
    v: "5",
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 1,
        nm: "ctrl",
        ind: 1,
        ip: 0,
        op: 30,
        st: 0,
        sw: 100,
        sh: 100,
        sc: "#000000",
        ks: {
          r: { a: 0, k: 0 },
          p: { a: 0, k: [50, 50] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 0 },
        },
      },
      {
        ty: 4,
        nm: "dot",
        ind: 2,
        parent: 1,
        ip: 0,
        op: 30,
        st: 0,
        ks: {
          r: { a: 0, k: 0 },
          p: { a: 0, k: [10, 10] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 100 },
        },
        shapes: [
          { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
          { ty: "fl", c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } },
        ],
      },
    ],
  });
  // The wrapper group's own decls (before its first child) carry no opacity.
  const groupDecls = css.slice(
    css.indexOf("#ctrl {"),
    css.indexOf("> #ctrl-rect"),
  );
  expect(groupDecls).not.toContain("opacity");
  // The solid's own rect keeps the opacity 0 (it is what is invisible).
  const rectBlock = css.slice(
    css.indexOf("#ctrl-rect {"),
    css.indexOf("> #dot"),
  );
  expect(rectBlock).toContain("opacity: 0");
});

// --- gradient alpha-stop merge + exact geometry -----------------------------

/** One shape layer whose single fill is the given gradient item (`gf`). */
function gradComp(gf: any) {
  return {
    v: "5",
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        nm: "g",
        ind: 1,
        ip: 0,
        op: 30,
        st: 0,
        ks: {
          r: { a: 0, k: 0 },
          p: { a: 0, k: [50, 50] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 100 },
        },
        shapes: [
          { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
          gf,
        ],
      },
    ],
  };
}
const gf = (t: number, extra: any, gk: number[], p: number) => ({
  ty: "gf",
  t,
  o: { a: 0, k: 100 },
  s: { a: 0, k: [0, 0] },
  e: { a: 0, k: [10, 0] },
  h: { a: 0, k: 0 },
  a: { a: 0, k: 0 },
  g: { p, k: { a: 0, k: gk } },
  ...extra,
});
const fillOf = (css: string) =>
  css.match(/fill:\s*((?:radial|linear)-gradient\([^;\n]*\))/)![1];

test("alpha tail merges into color stops as rgba() at merged positions", () => {
  // 2 color stops (white@0, black@1) + alpha tail (a=1@0, a=0@1) -> fade to transparent.
  const css = new Converter().convert(
    gradComp(gf(2, {}, [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0], 2)),
  );
  const fill = fillOf(css);
  expect(fill).toContain("#ffffff 0%");
  expect(fill).toContain("rgba(0, 0, 0, 0) 100%");
});

test("alpha keys not aligned with color keys insert interpolated rgba stops", () => {
  // colors white@0, black@1; alphas 1@0, 0@0.5, 1@1 -> midpoint is grey, alpha 0.
  const css = new Converter().convert(
    gradComp(gf(2, {}, [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0.5, 0, 1, 1], 2)),
  );
  const fill = fillOf(css);
  expect(fill).toContain("rgba(128, 128, 128, 0) 50%");
});

test("radial gradient emits exact circle geometry (radius from |e-s|, center s)", () => {
  const css = new Converter().convert(
    gradComp({
      ...gf(2, {}, [0, 1, 1, 1, 1, 0, 0, 0], 2),
      s: { a: 0, k: [10, 20] },
      e: { a: 0, k: [10, 120] },
    }),
  );
  expect(fillOf(css)).toMatch(/^radial-gradient\(circle 100px at 10px 20px,/);
});

test("radial highlight (h%, angle a) offsets the focal via `from fx fy`", () => {
  // center (10,20), e straight down -> base angle 90deg; h=50% of r=100 -> focal 50 below center.
  const css = new Converter().convert(
    gradComp({
      ...gf(2, {}, [0, 1, 1, 1, 1, 0, 0, 0], 2),
      s: { a: 0, k: [10, 20] },
      e: { a: 0, k: [10, 120] },
      h: { a: 0, k: 50 },
      a: { a: 0, k: 0 },
    }),
  );
  expect(fillOf(css)).toContain("from 10px 70px");
});

test("linear gradient emits exact from/to endpoints (not a bbox angle)", () => {
  const css = new Converter().convert(
    gradComp({
      ...gf(1, {}, [0, 1, 0, 0, 1, 0, 0, 1], 2),
      s: { a: 0, k: [0, 0] },
      e: { a: 0, k: [100, 50] },
    }),
  );
  expect(fillOf(css)).toMatch(/^linear-gradient\(from 0px 0px to 100px 50px,/);
});

test("gradient stroke (gs) becomes a stroke gradient + width/cap, not a fill", () => {
  // A `gs` is a stroked outline painted with a gradient (see the "Hello (apple)"
  // scene: a gradient-stroked path drawn on by a trim). It must map to
  // `stroke: <gradient>` + stroke-width/cap/join — NOT `fill: <gradient>`.
  const gs = {
    ty: "gs",
    t: 1,
    o: { a: 0, k: 100 },
    w: { a: 0, k: 9 },
    lc: 2,
    lj: 2,
    s: { a: 0, k: [0, 0] },
    e: { a: 0, k: [10, 0] },
    h: { a: 0, k: 0 },
    a: { a: 0, k: 0 },
    g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } },
  };
  const css = new Converter().convert(gradComp(gs));
  expect(css).toContain("stroke: linear-gradient(from 0px 0px to 10px 0px,");
  expect(css).toContain("stroke-width: 9px");
  expect(css).toContain("stroke-linecap: round");
  expect(css).toContain("stroke-linejoin: round");
  expect(css).toContain("fill: none");
  expect(css).not.toMatch(/fill:\s*linear-gradient/);
});

// --- legacy (v4) shape / mask quirks: absent `a` flag, non-'a' mask modes ----

/** A closed triangle bezier shape (the value carried by an `sh`/mask keyframe). */
const tri = (dx = 0) => ({
  v: [
    [dx, 0],
    [10 + dx, 0],
    [10 + dx, 10],
  ],
  i: [
    [0, 0],
    [0, 0],
    [0, 0],
  ],
  o: [
    [0, 0],
    [0, 0],
    [0, 0],
  ],
  c: true,
});

/** A one-shape layer with an optional mask list, at the comp centre. */
function shapeLayer(shapes: any[], masks?: any[]) {
  return {
    v: "4.0.0",
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        nm: "m",
        ind: 1,
        ip: 0,
        op: 30,
        st: 0,
        ks: {
          r: { a: 0, k: 0 },
          p: { a: 0, k: [50, 50] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 100 },
        },
        ...(masks ? { masksProperties: masks } : {}),
        shapes,
      },
    ],
  };
}

test("legacy animated `sh` with no `a` flag still morphs (d channel, not an empty path)", () => {
  // v4 exports omit the `a` flag on animated shape paths; detection must infer
  // animation from the keyframe-array shape, or the path freezes to '' (invisible).
  const sh = {
    ty: "sh",
    ks: { k: [{ t: 0, s: [tri(0)] }, { t: 10, s: [tri(20)] }, { t: 12 }] },
  };
  const c = new Converter();
  const css = c.convert(
    shapeLayer([
      sh,
      { ty: "fl", c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } },
    ]),
  );
  expect(css).toContain("@keyframes");
  expect(css).toContain("animation:");
  // A real path exists — inline or hoisted into a :root `--pN` by path dedup —
  // and it is never the empty `d: ''` that a frozen shape would emit.
  expect(css).toMatch(/(d:|--p\d+:)\s*'M/);
  expect(css).not.toMatch(/d:\s*''/);
});

// --- fill/stroke opacity (Lottie `o` on its own track) ----------------------

test("animated fill opacity (static color) drives an rgba() fill channel, not a baked opaque fill", () => {
  // A fill whose `o` pulses 0->35->10 with a static red `c`. Opacity lives on its
  // own track; the color must be sampled with alpha per keyframe (previously the
  // whole pulse was silently baked to fully-opaque).
  const fl = {
    ty: "fl",
    c: { a: 0, k: [1, 0, 0] },
    o: {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
        { t: 15, s: [35] },
        { t: 30, s: [10] },
      ],
    },
  };
  const c = new Converter();
  const css = c.convert(
    shapeLayer([
      { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
      fl,
    ]),
  );
  // A fill animation exists, keyed on the opacity grid, with rgba() values.
  expect(css).toContain("@keyframes");
  expect(css).toContain("animation:");
  expect(css).toContain("fill: rgba(255, 0, 0, 0)"); // t=0, alpha 0
  expect(css).toContain("fill: rgba(255, 0, 0, 0.35)"); // t=15
  expect(css).toContain("fill: rgba(255, 0, 0, 0.1)"); // t=30
  // The departing keyframe's easing is preserved on the fill channel.
  expect(css).toContain("cubic-bezier(0.3, 0, 0.7, 1)");
  // The old lossy warning is gone for the handled case.
  expect(
    c.warnings.some((w) => w.includes("animated fill opacity baked")),
  ).toBe(false);
});

test("static stroke opacity <100 folds into the stroke color alpha (rgba)", () => {
  const st = {
    ty: "st",
    c: { a: 0, k: [0, 0, 1] },
    w: { a: 0, k: 4 },
    o: { a: 0, k: 50 },
  };
  const css = new Converter().convert(
    shapeLayer([
      { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
      st,
    ]),
  );
  expect(css).toContain("stroke: rgba(0, 0, 255, 0.5)");
});

test("animated stroke opacity drives a keyframed rgba() stroke channel", () => {
  const st = {
    ty: "st",
    c: { a: 0, k: [0, 0, 1] },
    w: { a: 0, k: 4 },
    o: {
      a: 1,
      k: [
        { t: 0, s: [80] },
        { t: 30, s: [0] },
      ],
    },
  };
  const css = new Converter().convert(
    shapeLayer([
      { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
      st,
    ]),
  );
  expect(css).toContain("animation:");
  expect(css).toContain("stroke: rgba(0, 0, 255, 0.8)"); // base / t=0
  expect(css).toContain("stroke: rgba(0, 0, 255, 0)"); // t=30, faded out
});

test("masks: any non-'n' mode clips (canvas parity), 'n' is a no-op, none block", () => {
  // lottie-web's canvas renderer clips to the nonzero union of every mask whose
  // mode isn't 'none', ignoring add/subtract/intersect/difference.
  const masks = [
    { mode: "f", pt: { a: 0, k: tri(0) } },
    { mode: "n", pt: { a: 0, k: tri(20) } },
  ];
  const c = new Converter();
  const css = c.convert(
    shapeLayer(
      [{ ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } }],
      masks,
    ),
  );
  expect(c.blocked.size).toBe(0);
  // one clip path (the 'f' mask); the 'n' mask contributes nothing.
  expect((css.match(/clip-path:\s*path\(/g) || []).length).toBe(1);
});

test("animated mask (legacy, no `a` flag) drives a keyframed clip-path", () => {
  const masks = [
    {
      mode: "a",
      pt: {
        k: [
          { t: 0, s: [tri(0)] },
          { t: 10, s: [tri(20)] },
        ],
      },
    },
  ];
  const c = new Converter();
  const css = c.convert(
    shapeLayer(
      [{ ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } }],
      masks,
    ),
  );
  expect(c.blocked.size).toBe(0);
  // A static base clip plus an animation whose @keyframes morph the clip region;
  // the mask shape is no longer frozen to its first frame.
  expect(css).toContain("clip-path: path(");
  expect(css).toContain("animation:");
  expect(css).toMatch(/\d+%\s*\{[^}]*clip-path: path\(/);
  expect(c.warnings.some((w) => w.includes("baked to first frame"))).toBe(
    false,
  );
});

/** Byte range [openBrace, closeBrace] of the block introduced by `selector`. */
function blockRange(css: string, selector: string): [number, number] {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector ${selector} not found`);
  const open = css.indexOf("{", start);
  let depth = 0,
    i = open;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) break;
  }
  return [open, i];
}

test("a transform-parented child is NOT nested inside its parent precomp clip/mask scope", () => {
  const ks = {
    p: { a: 0, k: [50, 50] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
  };
  const dot = {
    ty: 4,
    nm: "dot",
    ind: 1,
    ip: 0,
    op: 60,
    st: 0,
    ks,
    shapes: [
      { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
      { ty: "fl", c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } },
    ],
  };
  const css = new Converter().convert({
    v: "5",
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    assets: [{ id: "inner", layers: [dot] }],
    layers: [
      // Matte source: painted only through the precomp's composite.
      {
        ty: 4,
        nm: "matte-src",
        ind: 2,
        ip: 0,
        op: 60,
        st: 0,
        ks,
        shapes: [
          { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] } },
          { ty: "fl", c: { a: 0, k: [0, 0, 0] }, o: { a: 0, k: 100 } },
        ],
      },
      // Precomp instance: emits a comp-box clip AND consumes matte src (tt:1 tp:2).
      {
        ty: 0,
        nm: "pre",
        ind: 3,
        refId: "inner",
        ip: 0,
        op: 60,
        st: 0,
        w: 50,
        h: 50,
        tt: 1,
        tp: 2,
        ks,
      },
      // Transform-parented child of the precomp — must inherit ONLY its transform.
      {
        ty: 4,
        nm: "child",
        ind: 4,
        parent: 3,
        ip: 0,
        op: 60,
        st: 0,
        ks,
        shapes: [
          { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] } },
          { ty: "fl", c: { a: 0, k: [0, 1, 0] }, o: { a: 0, k: 100 } },
        ],
      },
    ],
  });
  // The clip + matte are isolated onto an inner content wrapper.
  const [cOpen, cClose] = blockRange(css, "#pre-content {");
  const content = css.slice(cOpen, cClose);
  expect(content).toContain("clip-path: path(");
  expect(content).toContain("mask: #matte-src alpha");
  // The transform-parented child sits OUTSIDE that clip/mask scope.
  const childIdx = css.indexOf("#child {");
  expect(childIdx).toBeGreaterThan(-1);
  expect(childIdx < cOpen || childIdx > cClose).toBe(true);
  // And the outer transform group carries neither the clip nor the matte itself.
  const [pOpen] = blockRange(css, "#pre {");
  const preHead = css.slice(pOpen, cOpen);
  expect(preHead).not.toContain("clip-path");
  expect(preHead).not.toContain("mask:");
});

test("an orphan track-matte source (td with no tt consumer) is dropped, not painted", () => {
  const ks = {
    p: { a: 0, k: [50, 50] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
  };
  const rect = (c: number[]) => [
    { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [40, 40] } },
    { ty: "fl", c: { a: 0, k: c }, o: { a: 0, k: 100 } },
  ];
  const css = new Converter().convert({
    v: "5",
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
      // A proper matte pair: source (td) consumed by the content below (tt/tp).
      {
        ty: 4,
        nm: "good-src",
        ind: 1,
        td: 1,
        ip: 0,
        op: 60,
        st: 0,
        ks,
        shapes: rect([0, 0, 0]),
      },
      {
        ty: 4,
        nm: "content",
        ind: 2,
        tt: 1,
        tp: 1,
        ip: 0,
        op: 60,
        st: 0,
        ks,
        shapes: rect([0, 1, 0]),
      },
      // An orphan matte source: td set, but the layer below has NO tt — degenerate.
      {
        ty: 4,
        nm: "orphan-src",
        ind: 3,
        td: 1,
        ip: 0,
        op: 60,
        st: 0,
        ks,
        shapes: rect([0, 0, 1]),
      },
      {
        ty: 4,
        nm: "plain",
        ind: 4,
        ip: 0,
        op: 60,
        st: 0,
        ks,
        shapes: rect([1, 0, 0]),
      },
    ],
  });
  // The orphan is dropped entirely — no rule and no blue fill leaks into paint.
  expect(css).not.toContain("#orphan-src");
  expect(css).not.toContain("#0000ff");
  // The consumed source survives (as the matte) and the plain layer paints.
  expect(css).toContain("mask: #good-src alpha");
  expect(css).toContain("#plain");
});

// --- text layers (ty 5) -----------------------------------------------------

const TEXT_KS = {
  r: { a: 0, k: 0 },
  p: { a: 0, k: [100, 50] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  o: { a: 0, k: 100 },
};

/** A minimal comp with one text layer; `doc` overrides the text document `s`. */
function textComp(doc: any, extra: any = {}, fonts?: any) {
  return {
    v: "5",
    fr: 30,
    ip: 0,
    op: 30,
    w: 200,
    h: 100,
    ...(fonts ? { fonts } : {}),
    layers: [
      {
        ty: 5,
        nm: "label",
        ind: 1,
        ip: 0,
        op: 30,
        st: 0,
        ks: TEXT_KS,
        t: { d: { k: [{ t: 0, s: doc }] }, ...extra },
      },
    ],
  };
}

test("text layer maps to a text node (string, size, fill, anchor)", () => {
  const c = new Converter();
  const css = c.convert(
    textComp({ t: "Hi", s: 24, fc: [1, 0, 0], j: 2, f: "Helvetica" }),
  );
  expect(css).toContain("type: text");
  expect(css).toContain('content: "Hi"');
  expect(css).toContain("font-size: 24px");
  expect(css).toContain("fill: #ff0000");
  expect(css).toContain("text-anchor: middle");
  // No document remains blocked.
  expect(c.blocked.size).toBe(0);
  expect(validate(css)).toEqual([]);
});

test("text justification maps to text-anchor (start omitted, end explicit)", () => {
  const start = new Converter().convert(textComp({ t: "L", s: 12, j: 0 }));
  expect(start).not.toContain("text-anchor");
  const end = new Converter().convert(textComp({ t: "R", s: 12, j: 1 }));
  expect(end).toContain("text-anchor: end");
});

test("text font-family resolves via the fonts list, generics unquoted", () => {
  const c = new Converter();
  const css = c.convert(
    textComp(
      { t: "x", s: 12, f: "F1" },
      {},
      {
        list: [{ fName: "F1", fFamily: "Roboto" }],
      },
    ),
  );
  expect(css).toContain('font-family: "Roboto"');
  const g = new Converter().convert(
    textComp({ t: "y", s: 12, f: "sans-serif" }),
  );
  expect(g).toContain("font-family: sans-serif");
});

test("multi-keyframe text document uses the first and warns", () => {
  // Inject a second document to trip the animated-document path.
  const comp = textComp({ t: "First", s: 12 });
  comp.layers[0].t.d.k.push({ t: 15, s: { t: "Second", s: 12 } });
  const c2 = new Converter();
  const css2 = c2.convert(comp);
  expect(css2).toContain('content: "First"');
  expect(css2).not.toContain("Second");
  expect(c2.warnings.some((w) => /animated text document/.test(w))).toBe(true);
});

test("text animators and multi-line warn but do not block", () => {
  const c = new Converter();
  const comp = textComp({ t: "line1\rline2", s: 12 });
  comp.layers[0].t.a = [{ nm: "anim" }];
  const css = c.convert(comp);
  expect(css).toContain('content: "line1"');
  expect(css).not.toContain("line2");
  expect(c.warnings.some((w) => /text animators/.test(w))).toBe(true);
  expect(c.warnings.some((w) => /multi-line/.test(w))).toBe(true);
  expect(c.blocked.size).toBe(0);
});

// --- expressions ------------------------------------------------------------

test("expressions on animatable properties emit one warning", () => {
  const c = new Converter();
  const css = c.convert({
    v: "5",
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        nm: "e",
        ind: 1,
        ip: 0,
        op: 30,
        st: 0,
        ks: {
          r: { a: 0, k: 0 },
          // Expression on position.
          p: { a: 0, k: [50, 50], x: "wiggle(2,10);" },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [100, 100] },
          o: { a: 1, k: 100, x: "time*10;" },
        },
        shapes: [
          {
            ty: "gr",
            it: [
              { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] } },
              { ...IDENTITY_TR },
            ],
          },
        ],
      },
    ],
  });
  const exprWarn = c.warnings.filter((w) => /expressions dropped/.test(w));
  expect(exprWarn.length).toBe(1);
  expect(exprWarn[0]).toContain("2 properties");
  expect(validate(css)).toEqual([]);
});

// --- text: content escaping + stroke ---------------------------------------

/** Convert a text doc, parse the CSS, and return the label's content string. */
function roundTripContent(doc: any): string {
  const css = new Converter().convert(textComp(doc));
  const sheet = parse(css);
  let found: string | undefined;
  const walk = (rules: any[]) => {
    for (const r of rules) {
      for (const d of r.declarations)
        if (d.property === "content" && d.value.type === "string")
          found = d.value.value;
      if (r.children) walk(r.children);
    }
  };
  walk(sheet.rules);
  if (found === undefined) throw new Error("no content decl parsed");
  return found;
}

test("text content with double quotes round-trips (single delimiter)", () => {
  expect(roundTripContent({ t: 'Say "hi"', s: 12 })).toBe('Say "hi"');
});

test("text content with single quotes round-trips (double delimiter)", () => {
  expect(roundTripContent({ t: "it's fine", s: 12 })).toBe("it's fine");
});

test("text content with both quote kinds substitutes and warns", () => {
  const c = new Converter();
  const css = c.convert(textComp({ t: `he said "it's"`, s: 12 }));
  expect(c.warnings.some((w) => /both quote characters/.test(w))).toBe(true);
  const sheet = parse(css);
  // Double quotes were replaced with single; the literal still parses cleanly.
  expect(css).toContain("content:");
  expect(validate(css)).toEqual([]);
  expect(sheet.rules.length).toBeGreaterThan(0);
});

test("text content with backslashes passes through raw", () => {
  expect(roundTripContent({ t: "path\\to\\file", s: 12 })).toBe(
    "path\\to\\file",
  );
});

test("stroke-only text maps stroke and emits no fill", () => {
  const css = new Converter().convert(
    textComp({ t: "S", s: 12, sc: [0, 0, 1], sw: 3 }),
  );
  expect(css).toContain("stroke: #0000ff");
  expect(css).toContain("stroke-width: 3px");
  expect(css).not.toContain("fill:");
  expect(validate(css)).toEqual([]);
});

test("filled + stroked text keeps both", () => {
  const css = new Converter().convert(
    textComp({ t: "S", s: 12, fc: [1, 0, 0], sc: [0, 0, 1], sw: 2 }),
  );
  expect(css).toContain("fill: #ff0000");
  expect(css).toContain("stroke: #0000ff");
  expect(css).toContain("stroke-width: 2px");
});

// --- 3D layers (ddd) flatten orthographically, as camera-less players render them.

/** A ddd layer with a 10x10 rect; `ks` extends a 3D transform at (50, 50). */
function layer3d(ks: any, extraLayers: any[] = []) {
  const doc: any = shapeLayer([
    {
      ty: "gr",
      it: [
        {
          ty: "rc",
          p: { a: 0, k: [0, 0] },
          s: { a: 0, k: [10, 10] },
          r: { a: 0, k: 0 },
        },
        { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
        IDENTITY_TR,
      ],
    },
  ]);
  const l = doc.layers[0];
  l.ddd = 1;
  delete l.ks.r;
  l.ks = {
    ...l.ks,
    rx: { a: 0, k: 0 },
    ry: { a: 0, k: 0 },
    rz: { a: 0, k: 0 },
    or: { a: 0, k: [0, 0, 0] },
    ...ks,
  };
  doc.layers.push(...extraLayers);
  return doc;
}

const layerTransform = (css: string) =>
  css.match(/#m \{[^}]*?transform: ([^;]*);/)?.[1];

test("3D rx-only folds into scaleY·cos(rx)", () => {
  const c = new Converter();
  const css = c.convert(
    layer3d({ rx: { a: 0, k: 60 }, s: { a: 0, k: [80, 50, 100] } }),
  );
  expect(layerTransform(css)).toBe("translate(50px, 50px) scale(0.8, 0.25)");
  expect(c.warnings).toEqual([]);
});

test("3D ry-only folds into scaleX·cos(ry)", () => {
  const css = new Converter().convert(layer3d({ ry: { a: 0, k: 60 } }));
  expect(layerTransform(css)).toBe("translate(50px, 50px) scale(0.5, 1)");
});

test("3D rz maps to rotate (static and animated)", () => {
  expect(
    layerTransform(new Converter().convert(layer3d({ rz: { a: 0, k: 30 } }))),
  ).toBe("translate(50px, 50px) rotate(30deg)");
  const css = new Converter().convert(
    layer3d({
      rz: {
        a: 1,
        k: [
          { t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
          { t: 30, s: [90] },
        ],
      },
    }),
  );
  expect(css).toContain("0% { transform: rotate(0deg); }");
  expect(css).toContain("100% { transform: rotate(90deg); }");
  expect(css).toContain("m-k 1s cubic-bezier(0.3, 0, 0.7, 1)");
});

test("3D animated rx emits per-keyframe scale", () => {
  const c = new Converter();
  const css = c.convert(
    layer3d({
      rx: {
        a: 1,
        k: [
          { t: 0, s: [0], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } },
          { t: 30, s: [60] },
        ],
      },
    }),
  );
  expect(css).toContain("0% { transform: scale(1, 1); }");
  expect(css).toContain("100% { transform: scale(1, 0.5); }");
  expect(c.warnings).toEqual([]);
});

test("3D animated rx+ry (non-axis-aligned) bakes its first value with a warning", () => {
  const c = new Converter();
  c.convert(
    layer3d({
      ry: { a: 0, k: 30 },
      rx: {
        a: 1,
        k: [
          { t: 0, s: [20] },
          { t: 30, s: [60] },
        ],
      },
    }),
  );
  expect(c.warnings).toContain(
    "3D layer rotation X/Y animation not supported; using first value",
  );
});

test("3D general static transform matches lottie-web's projected matrix", () => {
  const ks = {
    rx: { a: 0, k: 30 },
    ry: { a: 0, k: 40 },
    rz: { a: 0, k: 25 },
    or: { a: 0, k: [10, 20, 15] },
    s: { a: 0, k: [80, 120, 100] },
    a: { a: 0, k: [5, 7, 0] },
  };
  const css = new Converter().convert(layer3d(ks));
  expect(css).toContain("skewX(");
  const find = (n: SceneNode): SceneNode | undefined =>
    n.id === "m" ? n : n.children.map(find).find(Boolean);
  const got = computeLocalMatrix(find(buildSceneGraph(parse(css)))!);

  // lottie-web Matrix: row-major 4x4, each op post-multiplied (row-vector points).
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const t = (b: number[]) => {
    const o = new Array(16).fill(0);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++) o[i * 4 + j] += m[i * 4 + k] * b[k * 4 + j];
    m = o;
  };
  const d = Math.PI / 180;
  const rX = (a: number) =>
    t([
      1,
      0,
      0,
      0,
      0,
      Math.cos(a),
      -Math.sin(a),
      0,
      0,
      Math.sin(a),
      Math.cos(a),
      0,
      0,
      0,
      0,
      1,
    ]);
  const rY = (a: number) =>
    t([
      Math.cos(a),
      0,
      Math.sin(a),
      0,
      0,
      1,
      0,
      0,
      -Math.sin(a),
      0,
      Math.cos(a),
      0,
      0,
      0,
      0,
      1,
    ]);
  const rZ = (a: number) =>
    t([
      Math.cos(a),
      -Math.sin(a),
      0,
      0,
      Math.sin(a),
      Math.cos(a),
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
    ]);
  t([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -5, -7, 0, 1]);
  t([0.8, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  rZ(-25 * d);
  rY(40 * d);
  rX(30 * d);
  rZ(-15 * d);
  rY(20 * d);
  rX(10 * d);
  t([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 50, 0, 1]);
  // Popkorn Matrix3x3 is row-major column-vector: [a c tx; b d ty].
  const want = [m[0], m[4], m[12], m[1], m[5], m[13]];
  const have = [got[0], got[1], got[2], got[3], got[4], got[5]];
  for (let i = 0; i < 6; i++) expect(have[i]).toBeCloseTo(want[i], 1);
});

test("3D layers with a camera warn that perspective is ignored", () => {
  const c = new Converter();
  const res = c.convert(
    layer3d({ rx: { a: 0, k: 30 } }, [
      { ty: 13, ind: 2, nm: "Camera", ip: 0, op: 30, st: 0, ks: {} },
    ]),
  );
  expect(res).toContain("scale(1, 0.87)");
  expect(c.warnings).toContain(
    "camera layer ignored; 3D layers rendered orthographically",
  );
  expect([...c.blocked]).toEqual([]);
});

// --- transform-only parenting: exact stack order via ghost ancestors ---------

function stackLayer(ind: number, nm: string, parent?: number, extra = {}) {
  return {
    ty: 4,
    ind,
    nm,
    ...(parent !== undefined ? { parent } : {}),
    ip: 0,
    op: 30,
    st: 0,
    ks: { p: { a: 0, k: [ind * 10, 0] } },
    shapes: [
      {
        ty: "gr",
        it: [
          {
            ty: "rc",
            p: { a: 0, k: [0, 0] },
            s: { a: 0, k: [10, 10] },
            r: { a: 0, k: 0 },
          },
          { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
          IDENTITY_TR,
        ],
      },
    ],
    ...extra,
  };
}

const stackComp = (layers: any[]) => ({
  fr: 30,
  ip: 0,
  op: 30,
  w: 100,
  h: 100,
  layers,
});

/** Layer ids in effective paint order (bottom first), one entry per run of leaves. */
function leafLayerOrder(css: string, ids: Set<string>): string[] {
  const out: string[] = [];
  const walk = (n: SceneNode, owner: string | null) => {
    const o = ids.has(n.id) ? n.id : owner;
    const kids = childrenInPaintOrder(n);
    if (kids.length === 0) {
      if (o && out[out.length - 1] !== o) out.push(o);
      return;
    }
    for (const k of kids) walk(k, o);
  };
  walk(buildSceneGraph(parse(css)), null);
  return out;
}

test("grandchild below its grandparent's content paints at its Lottie slot", () => {
  const rot = {
    a: 1,
    k: [
      { t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
      { t: 30, s: [90] },
    ],
  };
  // Lottie stack top->bottom: C, G, X. X's parent C paints above G.
  const c = new Converter();
  const css = c.convert(
    stackComp([
      stackLayer(2, "C", 1, { ks: { p: { a: 0, k: [20, 0] }, r: rot } }),
      stackLayer(1, "G"),
      stackLayer(3, "X", 2),
    ]),
  );
  expect(leafLayerOrder(css, new Set(["G", "C", "X"]))).toEqual([
    "X",
    "G",
    "C",
  ]);
  expect(c.warnings.filter((w) => w.includes("approximate"))).toEqual([]);
  // The ghost of C reuses C's rotation @keyframes (declared once).
  expect(css).toContain("#C--xf-X {");
  expect(css.match(/@keyframes C-k /g)?.length).toBe(1);
  expect(css.match(/animation: C-k /g)?.length).toBe(2);
  const find = (n: SceneNode, id: string): SceneNode | undefined =>
    n.id === id ? n : n.children.map((k) => find(k, id)).find(Boolean);
  const root = buildSceneGraph(parse(css));
  const ghost = find(root, "C--xf-X")!;
  expect(ghost.children.map((k) => k.id)).toEqual(["X"]);
  expect(computeLocalMatrix(ghost)).toEqual(
    computeLocalMatrix(find(root, "C")!),
  );
});

test("a drawn parent's ip/op does not hide its transform-parented child", () => {
  const c = new Converter();
  const css = c.convert(
    stackComp([
      stackLayer(2, "C", 1),
      stackLayer(1, "P", undefined, { op: 10 }),
    ]),
  );
  const find = (n: SceneNode, id: string): SceneNode | undefined =>
    n.id === id ? n : n.children.map((k) => find(k, id)).find(Boolean);
  const root = buildSceneGraph(parse(css));
  expect(find(root, "P")!.visibleUntil).toBe(333); // ms
  for (let n: SceneNode | null = find(root, "C")!; n; n = n.parent)
    expect(n.visibleUntil).toBe(Number.POSITIVE_INFINITY);
  expect(leafLayerOrder(css, new Set(["P", "C"]))).toEqual(["P", "C"]);
});

test("a null parent's ip/op is not emitted (it would only hide children)", () => {
  const css = new Converter().convert(
    stackComp([
      stackLayer(2, "C", 1),
      { ty: 3, ind: 1, nm: "N", ip: 0, op: 10, st: 0, ks: {} },
    ]),
  );
  expect(css).not.toContain("visible-until");
  expect(css).not.toContain("--xf-");
});

test("contiguous parenting keeps plain nesting (no ghosts)", () => {
  const c = new Converter();
  const css = c.convert(
    stackComp([
      stackLayer(2, "C", 1),
      stackLayer(1, "G"),
      stackLayer(3, "X", 1),
    ]),
  );
  expect(css).not.toContain("--xf-");
  expect(leafLayerOrder(css, new Set(["G", "C", "X"]))).toEqual([
    "X",
    "G",
    "C",
  ]);
});

test("boxer: leaf paint order matches Lottie's layer stack", () => {
  const lottie = JSON.parse(
    readFileSync(
      join(import.meta.dir, "../../../examples/lottie/boxer lottie.json"),
      "utf8",
    ),
  );
  const names = lottie.layers.map((l: any) =>
    l.nm.replace(/[^a-zA-Z0-9_-]+/g, "-"),
  );
  const c = new Converter();
  const css = c.convert(lottie);
  expect(c.warnings.filter((w) => w.includes("approximate"))).toEqual([]);
  expect(leafLayerOrder(css, new Set(names))).toEqual([...names].reverse());
});

test("an image parent stacks a child behind the image", () => {
  const img = (ind: number, nm: string, parent?: number) => ({
    ty: 2,
    ind,
    nm,
    refId: "img",
    ...(parent !== undefined ? { parent } : {}),
    ip: 0,
    op: 30,
    st: 0,
    ks: { p: { a: 0, k: [ind * 10, 0] }, o: { a: 0, k: 50 } },
  });
  const css = new Converter().convert({
    ...stackComp([img(1, "P"), img(2, "C", 1)]),
    assets: [
      { id: "img", w: 10, h: 10, u: "", p: "data:image/png;base64,AA==" },
    ],
  });
  expect(css).toContain("#P-image {");
  const order: string[] = [];
  const walk = (n: SceneNode) => {
    if (n.type === "image") order.push(n.id);
    for (const k of childrenInPaintOrder(n)) walk(k);
  };
  walk(buildSceneGraph(parse(css)));
  expect(order).toEqual(["C", "P-image"]);
  // The image keeps its own opacity; the transform group doesn't pass it on.
  expect(css).toMatch(/#P-image \{[^}]*opacity: 0\.5/);
  expect(css).not.toMatch(/#P \{[^>]*opacity/);
});

/** lottie-web's eased progress for a segment bezier at time fraction u. */
function lottieEase(bz: number[], u: number): number {
  const c = (p1: number, p2: number, s: number) =>
    3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3;
  let lo = 0,
    hi = 1;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    if (c(bz[0], bz[2], m) < u) lo = m;
    else hi = m;
  }
  return c(bz[1], bz[3], (lo + hi) / 2);
}

/** One ellipse layer whose x position keyframes are `kfs`, in a comp [ip, op]. */
function posComp(kfs: any[], ip: number, op: number, layer: any = {}) {
  return {
    v: "5",
    fr: 30,
    ip,
    op,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        nm: "m",
        ind: 1,
        ip,
        op,
        st: 0,
        ks: { p: { a: 1, k: kfs }, a: { a: 0, k: [0, 0] } },
        shapes: [
          { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [5, 5] } },
          { ty: "fl", c: { a: 0, k: [1, 1, 1] }, o: { a: 0, k: 100 } },
        ],
        ...layer,
      },
    ],
  };
}

/** Rendered translateX of node `id` at comp frame f (30fps). */
function xAt(css: string, id: string, f: number): number {
  const find = (n: SceneNode): SceneNode | undefined =>
    n.id === id ? n : n.children.map(find).find(Boolean);
  const node = find(buildSceneGraph(parse(css)))!;
  new AnimationScheduler().sampleNode(node, (f / 30) * 1000);
  return node.transform.translateX;
}

const DOT_EASE = [0.823, 0, 0.833, 0.833];
const dotKfs = [
  {
    t: -3,
    s: [100, 0],
    o: { x: DOT_EASE[0], y: DOT_EASE[1] },
    i: { x: DOT_EASE[2], y: DOT_EASE[3] },
  },
  { t: 16, s: [-160, 0] },
];

test("a segment straddling comp ip keeps its value and easing (st/ip before 0)", () => {
  // lottie-logo Dot1: st=-36, ip=-5, keyframes -3..16 in comp frames.
  const css = new Converter().convert(
    posComp(dotKfs, 0, 30, { st: -36, ip: -5, op: 17 }),
  );
  for (const f of [0, 4, 8, 12, 14, 16]) {
    const want = 100 - 260 * lottieEase(DOT_EASE, (f + 3) / 19);
    expect(Math.abs(xAt(css, "m", f) - want)).toBeLessThan(0.5);
  }
});

test("a segment straddling comp op keeps its value and easing up to op", () => {
  const kfs = [
    { t: 10, s: [0, 0], o: { x: 0.7, y: 0 }, i: { x: 0.3, y: 1 } },
    { t: 40, s: [90, 0] },
  ];
  const css = new Converter().convert(posComp(kfs, 0, 20));
  expect(firstAnimDuration(css)).toBeCloseTo(10 / 30, 2);
  for (const f of [12, 15, 18, 20]) {
    const want = 90 * lottieEase([0.7, 0, 0.3, 1], (f - 10) / 30);
    expect(Math.abs(xAt(css, "m", f) - want)).toBeLessThan(0.5);
  }
});

test("a hold keyframe straddling comp ip holds, not lerps", () => {
  const kfs = [
    { t: -10, s: [50, 0], h: 1 },
    { t: 10, s: [100, 0] },
  ];
  const css = new Converter().convert(posComp(kfs, 0, 30));
  expect(xAt(css, "m", 0)).toBeCloseTo(50, 3);
  expect(xAt(css, "m", 9)).toBeCloseTo(50, 3);
  expect(xAt(css, "m", 10)).toBeCloseTo(100, 3);
  expect(css).toMatch(/animation: m-k 0\.666s step-end 1 -0\.333s/);
});

test("a segment crossing comp ip keeps its source keyframes and easing via a negative delay", () => {
  const css = new Converter().convert(posComp(dotKfs, 0, 30));
  expect(css).toMatch(
    /animation: m-k 0\.633s cubic-bezier\(0\.823, 0, 0\.833, 0\.833\) 1 -0\.1s/,
  );
  expect(css).toMatch(/0% \{ transform: translate\(100px, 0px\); \}/);
  for (const f of [0, 6.5, 16]) {
    const want = 100 - 260 * lottieEase(DOT_EASE, (f + 3) / 19);
    expect(Math.abs(xAt(css, "m", f) - want)).toBeLessThan(0.5);
  }
});

test("a segment spanning both comp bounds starts via delay and is cut at op", () => {
  const kfs = [
    { t: -10, s: [0, 0], o: { x: 0.7, y: 0 }, i: { x: 0.3, y: 1 } },
    { t: 40, s: [100, 0] },
  ];
  const css = new Converter().convert(posComp(kfs, 0, 20));
  expect(css).toMatch(/animation: m-k 1s cubic-bezier\([^)]*\) 1 -0\.333s/);
  for (const f of [0, 10, 20]) {
    const want = 100 * lottieEase([0.7, 0, 0.3, 1], (f + 10) / 50);
    expect(Math.abs(xAt(css, "m", f) - want)).toBeLessThan(0.5);
  }
});

test("a track ending at or before comp ip bakes its last value, no animation", () => {
  const kfs = [
    { t: -20, s: [0, 0], o: { x: 0.5, y: 0 }, i: { x: 0.5, y: 1 } },
    { t: -5, s: [70, 0] },
  ];
  const css = new Converter().convert(posComp(kfs, 0, 30));
  expect(css).not.toContain("animation:");
  expect(xAt(css, "m", 0)).toBeCloseTo(70, 3);
});

test("a shape layer's sr does not rescale its own keyframes (lottie-web: sr is precomp time only)", () => {
  const css = new Converter().convert(posComp(dotKfs, 0, 30, { sr: 2, st: 5 }));
  const want = 100 - 260 * lottieEase(DOT_EASE, (8 + 3) / 19);
  expect(Math.abs(xAt(css, "m", 8) - want)).toBeLessThan(0.5);
});

test("a child of an st-offset parent samples its keyframes in comp frames", () => {
  const doc: any = posComp(dotKfs, 0, 30);
  doc.layers[0].parent = 2;
  doc.layers.push({
    ty: 3,
    nm: "P",
    ind: 2,
    ip: 0,
    op: 30,
    st: 20,
    ks: { p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] } },
  });
  const css = new Converter().convert(doc);
  expect(css).not.toContain("time-offset");
  const want = 100 - 260 * lottieEase(DOT_EASE, (8 + 3) / 19);
  expect(Math.abs(xAt(css, "m", 8) - want)).toBeLessThan(0.5);
});

// --- skew (sk/sa) maps onto rotate·scale·skewX, matching lottie-web's matrix.

/** lottie-web's 2D layer matrix (TransformProperty order), as Popkorn's [a c tx b d ty]. */
function lottieLayerMatrix(k: {
  p: number[];
  a: number[];
  s: number[];
  r: number;
  sk: number;
  sa: number;
}): number[] {
  const d = Math.PI / 180;
  // 2D row-vector affine [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
  let m = [1, 0, 0, 1, 0, 0];
  const t = (n: number[]) => {
    const [a, b, c, dd, e, f] = m;
    m = [
      a * n[0] + b * n[2],
      a * n[1] + b * n[3],
      c * n[0] + dd * n[2],
      c * n[1] + dd * n[3],
      e * n[0] + f * n[2] + n[4],
      e * n[1] + f * n[3] + n[5],
    ];
  };
  // Mirrors lottie-web: translate(-a) scale(s) skewFromAxis(-sk, sa) rotate(-r) translate(p).
  t([1, 0, 0, 1, -k.a[0], -k.a[1]]);
  t([k.s[0] / 100, 0, 0, k.s[1] / 100, 0, 0]);
  const ax = -k.sk * d,
    c = Math.cos(k.sa * d),
    s = Math.sin(k.sa * d);
  t([c, s, -s, c, 0, 0]);
  t([1, 0, Math.tan(ax), 1, 0, 0]);
  t([c, -s, s, c, 0, 0]);
  const rc = Math.cos(-k.r * d),
    rs = Math.sin(-k.r * d);
  t([rc, -rs, rs, rc, 0, 0]);
  t([1, 0, 0, 1, k.p[0], k.p[1]]);
  return [m[0], m[2], m[4], m[1], m[3], m[5]];
}

function skewedLayer(ks: any) {
  const doc: any = shapeLayer([
    {
      ty: "gr",
      it: [
        {
          ty: "rc",
          p: { a: 0, k: [0, 0] },
          s: { a: 0, k: [10, 10] },
          r: { a: 0, k: 0 },
        },
        { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
        IDENTITY_TR,
      ],
    },
  ]);
  doc.layers[0].ks = { ...doc.layers[0].ks, ...ks };
  return doc;
}

function layerMatrixAt(css: string, frame: number): number[] {
  const find = (n: SceneNode): SceneNode | undefined =>
    n.id === "m" ? n : n.children.map(find).find(Boolean);
  const node = find(buildSceneGraph(parse(css)))!;
  new AnimationScheduler().sampleNode(node, (frame / 30) * 1000);
  const g = computeLocalMatrix(node);
  return [g[0], g[1], g[2], g[3], g[4], g[5]];
}

test("static skew with a skew axis matches lottie-web's layer matrix", () => {
  const k = { p: [50, 40], a: [5, 7], s: [80, 120], r: 25, sk: 20, sa: 35 };
  const conv = new Converter();
  const css = conv.convert(
    skewedLayer({
      p: { a: 0, k: k.p },
      a: { a: 0, k: k.a },
      s: { a: 0, k: k.s },
      r: { a: 0, k: k.r },
      sk: { a: 0, k: k.sk },
      sa: { a: 0, k: k.sa },
    }),
  );
  expect(css).toContain("skewX(");
  expect(conv.warnings.some((w) => w.includes("skew"))).toBe(false);
  const want = lottieLayerMatrix(k);
  const have = layerMatrixAt(css, 0);
  for (let i = 0; i < 6; i++) expect(have[i]).toBeCloseTo(want[i], 3);
});

test("animated skew and rotation sample to lottie-web's matrix at keyframes", () => {
  const lin = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
  const css = new Converter().convert(
    skewedLayer({
      r: {
        a: 1,
        k: [
          { t: 0, s: [0], ...lin },
          { t: 30, s: [270] },
        ],
      },
      sk: {
        a: 1,
        k: [
          { t: 0, s: [0], ...lin },
          { t: 15, s: [30], ...lin },
          { t: 30, s: [-10] },
        ],
      },
      sa: { a: 0, k: 15 },
    }),
  );
  for (const [f, r, sk] of [
    [0, 0, 0],
    [15, 135, 30],
    [30, 270, -10],
  ]) {
    const want = lottieLayerMatrix({
      p: [50, 50],
      a: [0, 0],
      s: [100, 100],
      r,
      sk,
      sa: 15,
    });
    const have = layerMatrixAt(css, f);
    for (let i = 0; i < 6; i++) expect(have[i]).toBeCloseTo(want[i], 4);
  }
});
