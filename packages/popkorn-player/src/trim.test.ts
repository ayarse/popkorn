import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import {
  buildKeyframeTracks,
  interpolateKeyframes,
} from "./animation/keyframes.js";
import { getPropHandler } from "./animation/registry.js";
import type { Renderer } from "./renderer/interface.js";
import {
  computeTrim,
  drawContourTrims,
  resolveStrokeDash,
} from "./renderer/stroke.js";
import type { TrimDescriptor } from "./renderer/types.js";
import { buildSceneGraph } from "./scene/builder.js";
import {
  createSceneNode,
  resetNodeToBase,
  snapshotNode,
} from "./scene/node.js";
import {
  computePathLength,
  outlineContours,
  outlineLength,
  parsePath,
  pathContours,
  shapeOutlineLength,
} from "./scene/path-parser.js";
import type { CircleData, SceneNode } from "./scene/types.js";

function firstNode(css: string): SceneNode {
  return buildSceneGraph(parse(css)).children[0];
}

// --- (1) computePathLength / shapeOutlineLength ------------------------------

test("computePathLength: straight polyline is exact", () => {
  // (0,0)->(100,0)->(100,100): two orthogonal segments, total 200.
  expect(computePathLength(parsePath("M0 0 L100 0 L100 100"))).toBeCloseTo(
    200,
    6,
  );
});

test("computePathLength: closed triangle includes the Z closing edge", () => {
  // (0,0)->(3,0)->(3,4)->back to (0,0): 3 + 4 + 5 = 12.
  expect(computePathLength(parsePath("M0 0 L3 0 L3 4 Z"))).toBeCloseTo(12, 6);
});

test("computePathLength: collinear cubic measures its chord", () => {
  // All control points on the x-axis -> the curve is the straight segment (100).
  expect(computePathLength(parsePath("M0 0 C33 0 66 0 100 0"))).toBeCloseTo(
    100,
    6,
  );
});

test("computePathLength: quarter-circle cubic approximates the true arc length", () => {
  // Standard cubic approximation of a quarter circle, r=100. True arc length is
  // (pi/2)*100 ~= 157.08; the bezier approximation is within a fraction of a unit.
  const len = computePathLength(
    parsePath("M100 0 C100 55.2285 55.2285 100 0 100"),
  );
  expect(len).toBeCloseTo(157.08, 0); // within 0.5
});

test("shapeOutlineLength: circle is 2*pi*r", () => {
  expect(
    shapeOutlineLength({ type: "circle", cx: 0, cy: 0, r: 50 }),
  ).toBeCloseTo(2 * Math.PI * 50, 6);
});

test("shapeOutlineLength: sharp rect perimeter is 2*(w+h)", () => {
  expect(
    shapeOutlineLength({
      type: "rect",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rx: 0,
      ry: 0,
    }),
  ).toBeCloseTo(600, 6);
});

test("shapeOutlineLength: rounded rect = straight edges + one full corner ellipse", () => {
  // rx=ry=10: straight 2*(200-20)+2*(100-20)=520, plus 4 quarter circles = 2*pi*10.
  const len = shapeOutlineLength({
    type: "rect",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    rx: 10,
    ry: 10,
  });
  expect(len).toBeCloseTo(520 + 2 * Math.PI * 10, 6);
});

// --- (2) builder: parse + normalize + clamp + defaults + linecap -------------

test("builder: trim percentages normalize to 0..1", () => {
  const node = firstNode(
    "#p { type: circle; r: 50px; trim-start: 25%; trim-end: 75%; trim-offset: 10%; }",
  );
  expect(node.trimStart).toBeCloseTo(0.25, 6);
  expect(node.trimEnd).toBeCloseTo(0.75, 6);
  expect(node.trimOffset).toBeCloseTo(0.1, 6);
});

test("builder: trim values clamp to [0,1]", () => {
  const node = firstNode("#p { type: circle; r: 50px; trim-end: 150%; }");
  expect(node.trimEnd).toBe(1);
});

test("builder: trim defaults are 0 / 1 / 0", () => {
  const node = firstNode("#p { type: circle; r: 50px; }");
  expect(node.trimStart).toBe(0);
  expect(node.trimEnd).toBe(1);
  expect(node.trimOffset).toBe(0);
});

test("builder: stroke-linecap keywords", () => {
  for (const cap of ["butt", "round", "square"] as const) {
    const node = firstNode(
      `#p { type: circle; r: 50px; stroke-linecap: ${cap}; }`,
    );
    expect(node.strokeLineCap).toBe(cap);
  }
  // Default and unknown fall back to butt.
  expect(firstNode("#p { type: circle; r: 50px; }").strokeLineCap).toBe("butt");
});

test("builder: stroke-linejoin keywords and miterlimit", () => {
  for (const join of ["miter", "round", "bevel"] as const) {
    const node = firstNode(
      `#p { type: circle; r: 50px; stroke-linejoin: ${join}; }`,
    );
    expect(node.strokeLineJoin).toBe(join);
  }
  // SVG/Lottie defaults: miter join, miter limit 4.
  const dflt = firstNode("#p { type: circle; r: 50px; }");
  expect(dflt.strokeLineJoin).toBe("miter");
  expect(dflt.strokeMiterLimit).toBe(4);
  // Explicit miter limit is parsed as a number.
  expect(
    firstNode("#p { type: circle; r: 50px; stroke-miterlimit: 2; }")
      .strokeMiterLimit,
  ).toBe(2);
});

// --- (3) registry: trim-end animates ----------------------------------------

test("registry: trim-end interpolates between keyframes", () => {
  const node = firstNode("#p { type: circle; r: 50px; trim-end: 0%; }"); // base trimEnd = 0
  const kf = buildKeyframeTracks([
    { offset: 0, properties: { "trim-end": 0 } },
    { offset: 1, properties: { "trim-end": 1 } },
  ]);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0);
  expect(node.trimEnd).toBeCloseTo(0, 6);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.5);
  expect(node.trimEnd).toBeCloseTo(0.5, 6);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 1);
  expect(node.trimEnd).toBeCloseTo(1, 6);
});

// --- (4) length cache invalidates when geometry is animated ------------------

// --- (5) computeTrim: window -> dash descriptor ------------------------------

function circle(r: number): SceneNode {
  const n = createSceneNode("c", "circle");
  n.shapeData = { type: "circle", cx: 0, cy: 0, r };
  n.base = snapshotNode(n);
  return n;
}

test("computeTrim: full range is untrimmed (null)", () => {
  expect(computeTrim(circle(50))).toBeNull();
});

test("computeTrim: empty window strokes nothing", () => {
  const n = circle(50);
  n.trimStart = 0.6;
  n.trimEnd = 0.4;
  expect(computeTrim(n)!.visible).toBe(false);
  expect(resolveStrokeDash(computeTrim(n), [], 0).stroke).toBe(false);
});

test("computeTrim: partial window is start + offset, length end - start", () => {
  const n = circle(50);
  const total = 2 * Math.PI * 50;
  n.trimStart = 0.25;
  n.trimEnd = 0.75;
  n.trimOffset = 0.1;
  const trim = computeTrim(n)!;
  expect(trim.visible).toBe(true);
  expect(trim.start).toBeCloseTo(0.35 * total, 6);
  expect(trim.length).toBeCloseTo(0.5 * total, 6);
  expect(trim.total).toBeCloseTo(total, 6);
  expect(trim.continuous).toBe(true); // a circle is closed
  const dash = resolveStrokeDash(trim, [], 0);
  expect(dash.dashArray[0]).toBeCloseTo(0.5 * total, 6);
  expect(dash.dashOffset).toBeCloseTo(-0.35 * total, 6);
});

// Arc positions where the realized dash is ON, sampled across [0, total].
function onAt(d: { dashArray: number[]; dashOffset: number }, x: number) {
  const period = d.dashArray.reduce((a, b) => a + b, 0);
  let pos = (((x + d.dashOffset) % period) + period) % period;
  for (let i = 0; i < d.dashArray.length; i++) {
    if (pos < d.dashArray[i]) return i % 2 === 0;
    pos -= d.dashArray[i];
  }
  return false;
}

test("trim dash: the period is twice the outline, so no round-cap dot wraps onto either end", () => {
  const total = 2 * Math.PI * 50;
  for (const [s, e] of [
    [0, 0.6],
    [0, 0.999],
    [0.9, 1],
  ]) {
    const n = circle(50);
    n.trimStart = s;
    n.trimEnd = e;
    const d = resolveStrokeDash(computeTrim(n), [], 0);
    expect(d.dashArray.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(
      2 * total - 1e-6,
    );
    expect(onAt(d, s * total + 1)).toBe(true);
    expect(onAt(d, e * total - 1)).toBe(true);
    if (s > 0) expect(onAt(d, 0)).toBe(false);
    if (e < 1) expect(onAt(d, total)).toBe(false);
  }
});

test("trim dash: a window reaching the end overshoots it (under-measured curves still finish)", () => {
  const n = circle(50);
  const total = 2 * Math.PI * 50;
  n.trimStart = 0.9;
  const d = resolveStrokeDash(computeTrim(n), [], 0);
  expect(d.dashArray[0]).toBeGreaterThan(0.1 * total);
  expect(onAt(d, total * 1.01)).toBe(true);
});

test("trim dash: full window with an offset strokes solid, and keeps an authored dash", () => {
  const n = circle(50);
  n.trimStart = 0;
  n.trimEnd = 1;
  n.trimOffset = 0.5;
  const trim = computeTrim(n)!;
  expect(resolveStrokeDash(trim, [], 0).dashArray).toEqual([]);
  // The dash restarts at the offset point and runs continuously through the seam.
  const total = 2 * Math.PI * 50;
  const d = resolveStrokeDash(trim, [10, 10], 0);
  expect(d.dashArray.length).toBeGreaterThan(2);
  expect(onAt(d, 0.5 * total + 5)).toBe(true);
  expect(onAt(d, 0.5 * total + 15)).toBe(false);
  // Position 0 is 0.5*total along the window; the pattern there continues, not restarts.
  const phase = (0.5 * total) % 20;
  expect(onAt(d, 1)).toBe((phase + 1) % 20 < 10);
});

test("trim dash: a marching window wraps the seam of a closed shape", () => {
  const n = circle(50);
  const total = 2 * Math.PI * 50;
  n.trimStart = 0;
  n.trimEnd = 0.3;
  n.trimOffset = 0.8; // window [0.8, 1.1] straddles the closed-shape seam
  const d = resolveStrokeDash(computeTrim(n), [], 0);
  expect(onAt(d, 0.85 * total)).toBe(true);
  expect(onAt(d, 0.05 * total)).toBe(true);
  expect(onAt(d, 0.5 * total)).toBe(false);
});

test("trim dash: an open path's wrapped piece restarts the authored dash at 0", () => {
  const n = createSceneNode("p", "path");
  n.shapeData = { type: "path", commands: parsePath("M0 0 L100 0") };
  n.trimStart = 0;
  n.trimEnd = 0.5;
  n.trimOffset = 0.75; // pieces [75,100] and [0,25]
  n.base = snapshotNode(n);
  const trim = computeTrim(n)!;
  expect(trim.continuous).toBe(false);
  const d = resolveStrokeDash(trim, [10, 10], 0);
  expect(onAt(d, 76)).toBe(true);
  expect(onAt(d, 86)).toBe(false);
  expect(onAt(d, 1)).toBe(true); // restarted, not continued from 25
  expect(onAt(d, 11)).toBe(false);
  expect(onAt(d, 40)).toBe(false);
});

test("trim dash: the authored dash phase follows trim-start", () => {
  const n = createSceneNode("p", "path");
  n.shapeData = { type: "path", commands: parsePath("M0 0 L100 0") };
  n.trimStart = 0.13;
  n.trimEnd = 0.9;
  n.base = snapshotNode(n);
  const d = resolveStrokeDash(computeTrim(n)!, [10, 10], 0);
  expect(onAt(d, 13.5)).toBe(true);
  expect(onAt(d, 22.5)).toBe(true);
  expect(onAt(d, 23.5)).toBe(false);
  expect(onAt(d, 12.5)).toBe(false);
});

// --- (6) trim-mode: multi-contour paths ---------------------------------------

test("builder: trim-mode keywords, default simultaneous", () => {
  expect(firstNode("#p { type: path; d: 'M0 0 L1 0'; }").trimMode).toBe(
    "simultaneous",
  );
  expect(
    firstNode("#p { type: path; d: 'M0 0 L1 0'; trim-mode: sequential; }")
      .trimMode,
  ).toBe("sequential");
  expect(
    firstNode("#p { type: path; d: 'M0 0 L1 0'; trim-mode: bogus; }").trimMode,
  ).toBe("simultaneous");
});

test("pathContours: splits at M, keeps lengths and closedness", () => {
  const cs = pathContours(parsePath("M0 0 L10 0 M0 5 L3 5 L3 9 Z"));
  expect(cs.map((c) => c.length)).toEqual([10, 12]);
  expect(cs.map((c) => c.closed)).toEqual([false, true]);
  const one = parsePath("M0 0 L10 0");
  expect(pathContours(one)[0].commands).toBe(one);
});

// Records each drawPath with the trim window active at that moment.
function recordContourTrims(n: SceneNode) {
  const draws: { trim: TrimDescriptor | null; fill: unknown; cmds: number }[] =
    [];
  let trim: TrimDescriptor | null = null;
  let fill: unknown = n.fill; // the walk sets the node's paint before the draw
  const r = {
    setTrim: (t: TrimDescriptor | null) => {
      trim = t;
    },
    setFill: (f: unknown) => {
      fill = f;
    },
    setFillGradient: () => {},
    drawPath: (cmds: unknown[]) => {
      draws.push({ trim, fill, cmds: cmds.length });
    },
  } as unknown as Renderer;
  const drawn = drawContourTrims(r, n);
  return { drawn, draws };
}

function twoContours(mode: "simultaneous" | "sequential") {
  return firstNode(
    `#p { type: path; d: 'M0 0 L10 0 M0 20 L30 20'; fill: #f00; stroke: #000; trim-end: 50%; trim-offset: 0%; trim-mode: ${mode}; }`,
  );
}

test("drawContourTrims: simultaneous gives each contour the same fractions", () => {
  const { drawn, draws } = recordContourTrims(twoContours("simultaneous"));
  expect(drawn).toBe(true);
  expect(draws[0]).toMatchObject({ cmds: 4, fill: "#f00" }); // whole path, fill only
  expect(draws[0].trim!.visible).toBe(false);
  expect(draws.slice(1).map((d) => [d.trim!.start, d.trim!.length])).toEqual([
    [0, 5],
    [0, 15],
  ]);
  expect(draws.slice(1).every((d) => d.fill === null)).toBe(true);
});

test("drawContourTrims: sequential runs one window across the contours in order", () => {
  const n = twoContours("sequential");
  n.trimStart = 0.2; // window [8, 20] of 40
  const { draws } = recordContourTrims(n);
  expect(draws.slice(1).map((d) => [d.trim!.start, d.trim!.length])).toEqual([
    [8, 2],
    [0, 10],
  ]);
});

test("drawContourTrims: sequential wrap splits a contour into separate pieces", () => {
  const n = twoContours("sequential");
  n.trimStart = 0;
  n.trimEnd = 0.5;
  n.trimOffset = 0.9; // window [36, 56) wraps to [0, 16)
  const { draws } = recordContourTrims(n);
  const [a, b] = draws.slice(1).map((d) => d.trim!);
  expect([a.start, a.length]).toEqual([0, 10]);
  expect(b.start).toBeCloseTo(26, 6);
  expect(b.length).toBeCloseTo(10, 6);
  expect(b.continuous).toBe(false);
});

test("drawContourTrims: paint-order stroke strokes before the fill; single contours are left alone", () => {
  const n = twoContours("simultaneous");
  n.paintOrder = "stroke";
  const { draws } = recordContourTrims(n);
  expect(draws.map((d) => d.cmds)).toEqual([2, 2, 4]);
  const single = firstNode(
    "#p { type: path; d: 'M0 0 L10 0'; stroke: #000; trim-end: 50%; }",
  );
  expect(recordContourTrims(single).drawn).toBe(false);
});

test("outlineLength: cache recomputes after a geometry apply", () => {
  const node = createSceneNode("c", "circle");
  node.shapeData = { type: "circle", cx: 0, cy: 0, r: 10 };
  node.base = snapshotNode(node);

  expect(outlineLength(node)).toBeCloseTo(2 * Math.PI * 10, 6);

  // Animate r via the registry (as the pipeline does) -> flags the cache dirty.
  getPropHandler("r")!.apply(node, 20);
  expect((node.shapeData as CircleData).r).toBe(20);
  expect(node.outlineLengthDirty).toBe(true);
  expect(outlineLength(node)).toBeCloseTo(2 * Math.PI * 20, 6);
});

test("contour cache follows a d morph and its reset back to base", () => {
  const n = firstNode(`
    #p { type: path; d: 'M0 0 L10 0 M0 20 L30 20'; stroke: #000; trim-end: 50%; animation: m 1s linear 1; }
    @keyframes m { to { d: 'M0 0 L50 0 M0 20 L70 20'; } }
  `);
  resetNodeToBase(n);
  interpolateKeyframes(n, n.animations[0].tracks, 1);
  expect(outlineContours(n).map((c) => c.length)).toEqual([50, 70]);
  resetNodeToBase(n);
  expect(outlineContours(n).map((c) => c.length)).toEqual([10, 30]);
});
