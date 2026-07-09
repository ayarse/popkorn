import { expect, test } from "bun:test";
import { parse } from "@popcorn/parser";
import { interpolateKeyframes } from "./animation/keyframes";
import { getPropHandler } from "./animation/registry";
import { computeTrim } from "./runtime/loop";
import { buildSceneGraph } from "./scene/builder";
import {
  computePathLength,
  outlineLength,
  parsePath,
  shapeOutlineLength,
} from "./scene/path-parser";
import type { CircleData, SceneNode } from "./scene/types";
import { createSceneNode, resetNodeToBase, snapshotNode } from "./scene/types";

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
  const kf = [
    { offset: 0, properties: { "trim-end": 0 } },
    { offset: 1, properties: { "trim-end": 1 } },
  ];

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
  expect(computeTrim(n)).toEqual({
    visible: false,
    dashArray: [],
    dashOffset: 0,
  });
});

test("computeTrim: partial window becomes a dash pattern plus offset", () => {
  const n = circle(50);
  const total = 2 * Math.PI * 50;
  n.trimStart = 0.25;
  n.trimEnd = 0.75;
  n.trimOffset = 0.1;
  const trim = computeTrim(n)!;
  expect(trim.visible).toBe(true);
  expect(trim.dashArray[0]).toBeCloseTo(0.5 * total, 6); // visible = 50%
  expect(trim.dashArray[1]).toBeCloseTo(0.5 * total, 6); // hidden = 50%
  expect(trim.dashOffset).toBeCloseTo(-0.35 * total, 6); // -(start + offset)
});

test("computeTrim: a start-anchored reveal pads the gap so the dash cannot wrap", () => {
  // Regression: outlineLength under-measures a curved path, so a period == total
  // let Canvas wrap a round-cap sliver (a stray dot) onto the path's end. A
  // start-anchored window (start 0, offset 0) must use a full-length trailing gap.
  const n = circle(50);
  const total = 2 * Math.PI * 50;
  n.trimStart = 0;
  n.trimEnd = 0.6;
  n.trimOffset = 0;
  const trim = computeTrim(n)!;
  expect(trim.visible).toBe(true);
  expect(trim.dashArray[0]).toBeCloseTo(0.6 * total, 6); // visible arc
  expect(trim.dashArray[1]).toBeCloseTo(total, 6); // gap == full length -> no wrap
  expect(trim.dashOffset).toBe(0);
});

test("computeTrim: a near-full reveal never emits a degenerate sub-pixel gap", () => {
  const n = circle(50);
  const total = 2 * Math.PI * 50;
  n.trimStart = 0;
  n.trimEnd = 0.999; // gap would be ~0.001*total; must be padded to a full total
  const trim = computeTrim(n)!;
  expect(trim.dashArray[1]).toBeCloseTo(total, 6);
});

test("computeTrim: full window with a nonzero offset still strokes solid", () => {
  const n = circle(50);
  n.trimStart = 0;
  n.trimEnd = 1;
  n.trimOffset = 0.5;
  expect(computeTrim(n)).toEqual({
    visible: true,
    dashArray: [],
    dashOffset: 0,
  });
});

test("computeTrim: a marching window keeps the exact period so it can wrap the seam", () => {
  const n = circle(50);
  const total = 2 * Math.PI * 50;
  n.trimStart = 0;
  n.trimEnd = 0.3;
  n.trimOffset = 0.8; // window [0.8, 1.1] straddles the closed-shape seam
  const trim = computeTrim(n)!;
  expect(trim.dashArray[0]).toBeCloseTo(0.3 * total, 6);
  expect(trim.dashArray[1]).toBeCloseTo(0.7 * total, 6);
  expect(trim.dashOffset).toBeCloseTo(-0.8 * total, 6);
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
