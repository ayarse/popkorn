import { expect, test } from "bun:test";
import { parse } from "@popcorn/parser";
import { gradientsCompatible, interpolateGradient } from "./animation/registry";
import { Canvas2DRenderer } from "./renderer/canvas2d";
import type {
  GradientData,
  LinearGradientData,
  RadialGradientData,
} from "./renderer/types";
import { buildSceneGraph } from "./scene/builder";

function gradientOf(css: string): GradientData {
  const node = buildSceneGraph(parse(css)).children[0];
  return node.fillGradient!;
}

// A mock 2D context recording the exact createLinear/RadialGradient arguments.
function mockGradCanvas() {
  const calls: Array<{ op: string; args: number[] }> = [];
  const grad = { addColorStop() {} };
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    createLinearGradient(...args: number[]) {
      calls.push({ op: "linear", args });
      return grad;
    },
    createRadialGradient(...args: number[]) {
      calls.push({ op: "radial", args });
      return grad;
    },
  };
  return { getContext: () => ctx, calls } as any;
}

const realize = (
  g: GradientData,
  b: { x: number; y: number; width: number; height: number },
) => {
  const canvas = mockGradCanvas();
  const r = new Canvas2DRenderer(canvas);
  (r as any).realizeGradient(g, b);
  return canvas.calls[0];
};

// --- parsing ----------------------------------------------------------------

test("parses linear-gradient(from x y to x y) endpoints in local space", () => {
  const g = gradientOf(
    "#r { type: rect; width: 50px; height: 50px; fill: linear-gradient(from -20px -500px to -19px 545px, #f00 0%, #00f 100%) }",
  ) as LinearGradientData;
  expect(g.type).toBe("linear-gradient");
  expect(g.from).toEqual({ x: -20, y: -500 });
  expect(g.to).toEqual({ x: -19, y: 545 });
  expect(g.stops.length).toBe(2);
});

test("parses radial-gradient(circle r at cx cy) geometry", () => {
  const g = gradientOf(
    "#r { type: rect; width: 50px; height: 50px; fill: radial-gradient(circle 271.5px at 0px 0px, #fff 0%, #000 100%) }",
  ) as RadialGradientData;
  expect(g.type).toBe("radial-gradient");
  expect(g.radius).toBeCloseTo(271.5, 6);
  expect(g.at).toEqual({ x: 0, y: 0 });
  expect(g.focal).toBeUndefined();
});

test("parses radial focal (highlight) via trailing from fx fy", () => {
  const g = gradientOf(
    "#r { type: rect; width: 50px; height: 50px; fill: radial-gradient(circle 100px at 10px 20px from 40px 30px, #fff 0%, #000 100%) }",
  ) as RadialGradientData;
  expect(g.at).toEqual({ x: 10, y: 20 });
  expect(g.focal).toEqual({ x: 40, y: 30 });
});

test("plain angle linear-gradient still parses (no from/to)", () => {
  const g = gradientOf(
    "#r { type: rect; width: 50px; height: 50px; fill: linear-gradient(45deg, #f00 0%, #00f 100%) }",
  ) as LinearGradientData;
  expect(g.angle).toBe(45);
  expect(g.from).toBeUndefined();
});

// --- rendering (exact createGradient args) -----------------------------------

test("explicit linear renders point-to-point, ignoring the bbox", () => {
  const g: LinearGradientData = {
    type: "linear-gradient",
    angle: 180,
    stops: [],
    from: { x: -20, y: -500 },
    to: { x: -19, y: 545 },
  };
  const call = realize(g, { x: 0, y: 0, width: 10, height: 10 });
  expect(call.op).toBe("linear");
  expect(call.args).toEqual([-20, -500, -19, 545]);
});

test("explicit radial renders createRadialGradient(cx,cy,0,cx,cy,r)", () => {
  const g: RadialGradientData = {
    type: "radial-gradient",
    stops: [],
    radius: 271.5,
    at: { x: 5, y: 6 },
  };
  const call = realize(g, { x: 0, y: 0, width: 10, height: 10 });
  expect(call.op).toBe("radial");
  expect(call.args).toEqual([5, 6, 0, 5, 6, 271.5]);
});

test("radial focal moves the INNER circle center only", () => {
  const g: RadialGradientData = {
    type: "radial-gradient",
    stops: [],
    radius: 100,
    at: { x: 10, y: 20 },
    focal: { x: 40, y: 30 },
  };
  const call = realize(g, { x: 0, y: 0, width: 10, height: 10 });
  expect(call.args).toEqual([40, 30, 0, 10, 20, 100]); // focal is start circle, `at` is end
});

test("bbox fallback unchanged when no explicit geometry", () => {
  const g: RadialGradientData = { type: "radial-gradient", stops: [] };
  const call = realize(g, { x: 0, y: 0, width: 8, height: 6 });
  expect(call.op).toBe("radial");
  // center (4,3), radius = hypot(8,6)/2 = 5
  expect(call.args).toEqual([4, 3, 0, 4, 3, 5]);
});

// --- registry interpolation --------------------------------------------------

test("interpolateGradient lerps linear from/to endpoints", () => {
  const a: LinearGradientData = {
    type: "linear-gradient",
    angle: 0,
    stops: [{ offset: 0, color: "#000" }],
    from: { x: 0, y: 0 },
    to: { x: 10, y: 0 },
  };
  const b: LinearGradientData = {
    type: "linear-gradient",
    angle: 0,
    stops: [{ offset: 0, color: "#000" }],
    from: { x: 10, y: 20 },
    to: { x: 30, y: 40 },
  };
  expect(gradientsCompatible(a, b)).toBe(true);
  const m = interpolateGradient(a, b, 0.5) as LinearGradientData;
  expect(m.from).toEqual({ x: 5, y: 10 });
  expect(m.to).toEqual({ x: 20, y: 20 });
});

test("interpolateGradient lerps radial radius/at/focal", () => {
  const a: RadialGradientData = {
    type: "radial-gradient",
    stops: [{ offset: 0, color: "#000" }],
    radius: 100,
    at: { x: 0, y: 0 },
    focal: { x: 0, y: 0 },
  };
  const b: RadialGradientData = {
    type: "radial-gradient",
    stops: [{ offset: 0, color: "#000" }],
    radius: 200,
    at: { x: 10, y: 10 },
    focal: { x: 20, y: 20 },
  };
  const m = interpolateGradient(a, b, 0.5) as RadialGradientData;
  expect(m.radius).toBe(150);
  expect(m.at).toEqual({ x: 5, y: 5 });
  expect(m.focal).toEqual({ x: 10, y: 10 });
});

test("explicit and bbox-derived gradients are incompatible (step, no lerp)", () => {
  const a: LinearGradientData = {
    type: "linear-gradient",
    angle: 0,
    stops: [{ offset: 0, color: "#000" }],
    from: { x: 0, y: 0 },
    to: { x: 1, y: 0 },
  };
  const b: LinearGradientData = {
    type: "linear-gradient",
    angle: 0,
    stops: [{ offset: 0, color: "#000" }],
  };
  expect(gradientsCompatible(a, b)).toBe(false);
});
