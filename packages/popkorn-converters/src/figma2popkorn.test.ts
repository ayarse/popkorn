import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@popkorn/parser";
import { buildSceneGraph } from "@popkorn/player";
import { convertFigma, type FigmaCaptureBundle } from "./figma2popkorn";

const FIX = join(import.meta.dir, "..", "test", "fixtures", "figma");
const load = (name: string): FigmaCaptureBundle =>
  JSON.parse(readFileSync(join(FIX, name), "utf8"));

/** Convert, then assert the CSS parses + builds a scene (the validate contract). */
function run(name: string) {
  const res = convertFigma(load(name));
  const sheet = parse(res.css);
  expect(() => buildSceneGraph(sheet)).not.toThrow();
  return res;
}

test("static shapes: stage, shape types, geometry, gradients-free paints", () => {
  const { css, warnings } = run("static-shapes.figma.json");
  expect(css).toContain("width: 400px");
  expect(css).toContain("background: #0d0d1f");
  // Frame -> group, rect/ellipse/vector mapped.
  expect(css).toContain("type: group");
  expect(css).toContain("type: rect");
  expect(css).toContain("type: circle"); // ellipse w==h collapses to circle
  expect(css).toContain("type: path");
  // Rect placed at local origin with its transform carrying the position.
  expect(css).toContain("transform: translate(20px, 30px)");
  expect(css).toContain("border-radius: 8px");
  // Vector path + its winding + stroke.
  expect(css).toContain('d: "M0 0 L100 0 L50 100 Z"');
  expect(css).toContain("stroke-width: 2");
  expect(warnings).toEqual([]);
});

test("translate + opacity tracks: one @keyframes per channel, comma-joined", () => {
  const { css } = run("keyframe-translate-opacity.figma.json");
  // Two channels -> two @keyframes blocks.
  expect(css).toContain("@keyframes");
  expect(css).toMatch(/transform: translateX\(300px\)/);
  expect(css).toContain("opacity: 0");
  // Comma-joined animation list, both channels, seconds duration.
  expect(css).toMatch(/animation:[^;]*2s linear 1[^;]*,[^;]*2s linear 1/);
  expect(css).toContain("animation-fill-mode: both");
  // Per-keyframe easing (ease-out on the departing translate keyframe).
  expect(css).toContain("animation-timing-function: ease-out");
});

test("spring easing samples into linear() and warns", () => {
  const { css, warnings } = run("spring-track.figma.json");
  expect(css).toContain("animation-timing-function: linear(");
  // Rotation is negated (Figma CCW+ -> canvas CW+).
  expect(css).toContain("transform: rotate(-90deg)");
  expect(warnings.some((w) => w.includes("spring"))).toBe(true);
});

test("gradient + per-corner radius: linear/radial geometry + border-radius 4-value", () => {
  const { css } = run("gradient-corner.figma.json");
  expect(css).toContain("linear-gradient(from 0px 0px to 160px 120px");
  expect(css).toContain("radial-gradient(circle 60px at 60px 60px");
  expect(css).toContain("border-radius: 4px 8px 12px 16px");
});

test("unsupported features warn/block instead of failing", () => {
  const { css, warnings, blocked } = run("unsupported.figma.json");
  // SLICE skipped, IMAGE fill dropped, ANGULAR gradient blocked, skew dropped.
  expect(blocked).toContain("node-type:SLICE");
  expect(blocked).toContain("IMAGE");
  expect(blocked).toContain("GRADIENT_ANGULAR");
  expect(blocked).toContain("skew");
  expect(warnings.length).toBeGreaterThan(0);
  // Still produces valid, buildable CSS (asserted by run()).
  expect(css).toContain(":root");
});

test("accepts a raw JSON string as well as a bundle object", () => {
  const raw = readFileSync(join(FIX, "static-shapes.figma.json"), "utf8");
  expect(() => convertFigma(raw)).not.toThrow();
});

test("live motion capture: converts with zero blocked, polygon survives", () => {
  const { css, blocked } = run("live-motion-test.figma.json");
  // Nothing blocked — the POLYGON with no vectorPaths falls back to native.
  expect(blocked).toEqual([]);
  // Bug 4: POLYGON with no path data -> native polygon (not skipped/blocked).
  expect(css).toContain("type: polygon");
  expect(css).toContain("sides: 3");
  expect(css).toContain("outer-radius: 45px");
  // Bug 3: the FRAME's solid fill re-emitted as a background rect child.
  expect(css).toContain("#MotionTest-bg");
  expect(css).toMatch(/#MotionTest-bg \{[^}]*fill: #08081a/s);
  // Bug 2: static translate(40,40) + TRANSLATION_X 0->240 bakes to 40->280.
  expect(css).toContain("transform: translateX(40px)");
  expect(css).toContain("transform: translateX(280px)");
  // Bug 2: animated ROTATION/SCALE re-pivot to the visual center.
  expect(css).toMatch(/#spinner \{[^}]*transform-origin: center/s);
  expect(css).toMatch(/#ball \{[^}]*transform-origin: center/s);
  // Bug 2: SCALE_XY multiplies resting scale (1 -> 1.8).
  expect(css).toContain("transform: scale(1.8, 1.8)");
  // Redundant LINEAR bezier {0,0,1,1} maps to linear (omitted), never cubic.
  expect(css).not.toContain("cubic-bezier(0, 0, 1, 1)");
  // Float-noisy rotation (-360.00001) rounds cleanly.
  expect(css).toContain("transform: rotate(360deg)");
  expect(css).not.toMatch(/rotate\([^)]*\.0*1/);
});

test("easing shifts back one keyframe (Figma eases FROM previous TO this)", () => {
  // TRANSLATION_X kf0 default-bezier (meaningless) is dropped; kf1's EASE_IN_AND_OUT
  // becomes the 0% stop's outgoing easing.
  const { css } = run("live-motion-test.figma.json");
  const block =
    css.match(/@keyframes box-translation_x \{[^}]*\}[^}]*\}/s)?.[0] ?? "";
  expect(block).toContain(
    "0% { transform: translateX(40px); animation-timing-function: ease-in-out;",
  );
  // The destination keyframe carries no outgoing easing (nothing after it).
  expect(block).toMatch(/75% \{ transform: translateX\(280px\); \}/);
});

test("native star: pointCount -> sides, innerRadius ratio -> inner-radius px", () => {
  const bundle = {
    version: 1,
    document: { width: 200, height: 200 },
    nodes: [
      {
        id: "9:1",
        name: "star",
        type: "STAR",
        relativeTransform: [
          [1, 0, 20],
          [0, 1, 20],
        ],
        width: 100,
        height: 100,
        pointCount: 6,
        innerRadius: 0.4,
        fills: [{ type: "SOLID", color: { r: 1, g: 0.7, b: 0 } }],
      },
    ],
  };
  const { css, blocked } = convertFigma(bundle as any);
  expect(() => buildSceneGraph(parse(css))).not.toThrow();
  expect(blocked).toEqual([]);
  expect(css).toContain("type: star");
  expect(css).toContain("sides: 6");
  expect(css).toContain("outer-radius: 50px");
  expect(css).toContain("inner-radius: 20px"); // 50 * 0.4
});

test("frame with no fill emits no background rect", () => {
  const bundle = {
    version: 1,
    document: { width: 100, height: 100 },
    nodes: [
      {
        id: "8:1",
        name: "clear",
        type: "FRAME",
        width: 100,
        height: 100,
        fills: [],
        clipsContent: true,
        children: [
          {
            id: "8:2",
            name: "dot",
            type: "ELLIPSE",
            width: 20,
            height: 20,
            fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
          },
        ],
      },
    ],
  };
  const { css, blocked } = convertFigma(bundle as any);
  expect(css).not.toContain("-bg");
  // clipsContent maps to a frame-bounds clip-path on the group.
  expect(css).toContain("clip-path: path('M 0 0 H 100 V 100 H 0 Z')");
  expect(blocked).not.toContain("clips-content");
});
