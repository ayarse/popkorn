import { expect, test } from "bun:test";
import { Converter, validate } from "./lottie2popcorn.ts";

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
