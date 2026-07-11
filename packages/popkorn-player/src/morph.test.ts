import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import { interpolateKeyframes } from "./animation/keyframes";
import {
  getPropHandler,
  gradientsCompatible,
  interpolateColor,
  interpolateGradient,
  interpolatePath,
  interpolateProp,
  pathsCompatible,
} from "./animation/registry";
import type { GradientData } from "./renderer/types";
import { parseColor } from "./renderer/types";
import { computeTrim } from "./runtime/loop";
import { buildSceneGraph } from "./scene/builder";
import { outlineLength, parsePath } from "./scene/path-parser";
import type { PathData, SceneNode } from "./scene/types";
import { createSceneNode, resetNodeToBase, snapshotNode } from "./scene/types";

function firstNode(css: string): SceneNode {
  return buildSceneGraph(parse(css)).children[0];
}

const grad = (stops: [number, string][], angle = 0): GradientData => ({
  type: "linear-gradient",
  angle,
  stops: stops.map(([offset, color]) => ({ offset, color })),
});

// --- (1) gradient lerp -------------------------------------------------------

test("interpolateGradient: offset and color lerp at the midpoint", () => {
  const a = grad([
    [0, "#000000"],
    [1, "#ff0000"],
  ]);
  const b = grad([
    [0.4, "#ffffff"],
    [1, "#0000ff"],
  ]);
  const mid = interpolateGradient(a, b, 0.5) as GradientData;
  expect(mid.stops[0].offset).toBeCloseTo(0.2, 6);
  const c0 = parseColor(mid.stops[0].color);
  expect(c0.r).toBe(128); // (0 + 255)/2 rounded
  const c1 = parseColor(mid.stops[1].color);
  expect(c1.r).toBe(128); // ff -> 00
  expect(c1.b).toBe(128); // 00 -> ff
});

test("gradientsCompatible: type mismatch and stop-count mismatch are incompatible", () => {
  const lin = grad([
    [0, "#000"],
    [1, "#fff"],
  ]);
  const rad: GradientData = { type: "radial-gradient", stops: lin.stops };
  const threeStops = grad([
    [0, "#000"],
    [0.5, "#888"],
    [1, "#fff"],
  ]);
  expect(gradientsCompatible(lin, threeStops)).toBe(false);
  expect(gradientsCompatible(lin, rad)).toBe(false);
});

test("interpolateProp: incompatible gradients step to the departing value", () => {
  const handler = getPropHandler("fill")!;
  const a = grad([
    [0, "#000"],
    [1, "#fff"],
  ]);
  const b = grad([
    [0, "#000"],
    [0.5, "#888"],
    [1, "#fff"],
  ]);
  // Mid-segment holds `from`; never crashes on the mismatched stop counts.
  expect(interpolateProp(handler, a, b, 0.5)).toBe(a);
});

// --- (2) gradient deep-copy on reset ----------------------------------------

test("resetNodeToBase: mutating a live gradient stop does not corrupt the base", () => {
  const node = createSceneNode("g", "rect");
  node.shapeData = {
    type: "rect",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rx: 0,
    ry: 0,
  };
  node.fillGradient = grad([
    [0, "#ff0000"],
    [1, "#0000ff"],
  ]);
  node.base = snapshotNode(node);

  resetNodeToBase(node);
  // Corrupt the live stops.
  node.fillGradient!.stops[0].offset = 0.9;
  node.fillGradient!.stops[0].color = "#00ff00";

  // A fresh reset must restore pristine authored stops.
  resetNodeToBase(node);
  expect(node.fillGradient!.stops[0].offset).toBe(0);
  expect(node.fillGradient!.stops[0].color).toBe("#ff0000");
  // The base itself must never have aliased the live array.
  expect(node.base.fillGradient!.stops[0].offset).toBe(0);
});

// --- (3) path morph midpoint -------------------------------------------------

test("interpolatePath: numeric args lerp pairwise at the midpoint", () => {
  const a = parsePath("M0 0 L10 0");
  const b = parsePath("M0 0 L20 40");
  const mid = interpolatePath(a, b, 0.5);
  const l = mid[1] as { type: "L"; x: number; y: number };
  expect(l.type).toBe("L");
  expect(l.x).toBeCloseTo(15, 6);
  expect(l.y).toBeCloseTo(20, 6);
});

test("interpolatePath: cubic control points lerp pairwise", () => {
  const a = parsePath("M0 0 C0 0 10 10 20 20");
  const b = parsePath("M0 0 C0 0 30 10 40 20");
  const mid = interpolatePath(a, b, 0.5);
  const c = mid[1] as { type: "C"; x2: number; x: number };
  expect(c.x2).toBeCloseTo(20, 6);
  expect(c.x).toBeCloseTo(30, 6);
});

// --- (4) incompatible path steps --------------------------------------------

test("pathsCompatible / interpolateProp: mismatched command sequences step", () => {
  const a = parsePath("M0 0 L10 0");
  const b = parsePath("M0 0 C0 0 5 5 10 0"); // L vs C at index 1
  expect(pathsCompatible(a, b)).toBe(false);
  const handler = getPropHandler("d")!;
  expect(interpolateProp(handler, a, b, 0.5)).toBe(a);
});

// --- (5) outline-length cache invalidates during a morph --------------------

test("outlineLength cache invalidates when d morphs (trim tracks the new length)", () => {
  const css = `
    #p {
      type: path;
      d: 'M0 0 L100 0';
      stroke: #000;
      stroke-width: 1;
      trim-end: 50%;
      animation: grow 1s linear 1;
    }
    @keyframes grow {
      0% { d: 'M0 0 L100 0'; }
      100% { d: 'M0 0 L300 0'; }
    }
  `;
  const node = firstNode(css);

  // Base state: 100-unit outline, half trimmed -> a 50-unit dash window.
  resetNodeToBase(node);
  expect(outlineLength(node)).toBeCloseTo(100, 6);
  const baseTrim = computeTrim(node)!;

  // Sample at the end: the morphed path is 300 units long. The registry's `d`
  // apply must have flagged the outline-length cache dirty for this to update.
  resetNodeToBase(node);
  interpolateKeyframes(node, node.animations[0].keyframes, 1);
  expect((node.shapeData as PathData).commands[1]).toMatchObject({ x: 300 });
  expect(outlineLength(node)).toBeCloseTo(300, 6);
  const endTrim = computeTrim(node)!;
  // trim-end 50% of a longer outline => a longer visible dash than at base.
  expect(endTrim.dashArray[0]).toBeGreaterThan(baseTrim.dashArray[0]);
});

// --- gradient animates end-to-end through the pipeline ----------------------

test("fill gradient animates through @keyframes (interpolated at the midpoint)", () => {
  const css = `
    #r {
      type: rect; x: 0; y: 0; width: 10; height: 10;
      fill: linear-gradient(0deg, #000000 0%, #ffffff 100%);
      animation: recolor 1s linear 1;
    }
    @keyframes recolor {
      0% { fill: linear-gradient(0deg, #000000 0%, #ffffff 100%); }
      100% { fill: linear-gradient(0deg, #ff0000 0%, #ffffff 100%); }
    }
  `;
  const node = firstNode(css);
  resetNodeToBase(node);
  interpolateKeyframes(node, node.animations[0].keyframes, 0.5);
  expect(parseColor(node.fillGradient!.stops[0].color).r).toBe(128);
});

// --- (n) named / hsl color parsing ------------------------------------------

test("parseColor: named color resolves (not black)", () => {
  expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
});

test("parseColor: hsl() resolves", () => {
  // hsl(120,100%,50%) == pure green
  expect(parseColor("hsl(120, 100%, 50%)")).toEqual({
    r: 0,
    g: 255,
    b: 0,
    a: 1,
  });
});

test("interpolateColor: named endpoints interpolate through color, not black", () => {
  const mid = parseColor(interpolateColor("red", "blue", 0.5));
  // was rgb(0,0,0) before named-color support
  expect(mid.r).toBe(128);
  expect(mid.b).toBe(128);
  expect(mid.r + mid.g + mid.b).toBeGreaterThan(0);
});

test("builder: fill: hsl(...) produces a non-null fill", () => {
  const node = firstNode(`
    #r { type: rect; x: 0; y: 0; width: 10; height: 10; fill: hsl(120, 100%, 50%); }
  `);
  expect(node.fill).not.toBeNull();
  expect(node.fill).not.toBeUndefined();
  expect(parseColor(node.fill as string)).toEqual({ r: 0, g: 255, b: 0, a: 1 });
});

test("builder: fill: red (named color) resolves to #ff0000-equivalent", () => {
  const node = firstNode(`
    #r { type: rect; x: 0; y: 0; width: 10; height: 10; fill: red; }
  `);
  expect(node.fill).not.toBeNull();
  expect(node.fill).not.toBeUndefined();
  expect(parseColor(node.fill as string)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
});
