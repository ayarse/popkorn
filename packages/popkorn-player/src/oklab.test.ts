import { describe, expect, test } from "bun:test";
import { parse } from "@popkorn/parser";

import { gradientsCompatible, interpolateColor } from "./animation/registry";
import { resolveGradient } from "./renderer/gradient-geometry";
import {
  mixOklch,
  oklabToOklch,
  oklabToRgba,
  resolveHueArc,
  rgbaToOklab,
  tryParseOklabColor,
} from "./renderer/oklab";
import { parseColor } from "./renderer/types";
import { buildSceneGraph } from "./scene/builder";

const rgb = (css: string) => {
  const c = parseColor(css);
  return [c.r, c.g, c.b];
};

const nodesOf = (source: string) => {
  const scene = buildSceneGraph(parse(source)) as unknown as {
    nodes?: unknown[];
    children?: unknown[];
  };
  return (scene.nodes ?? scene.children ?? []) as Record<string, never>[];
};

const STAGE = ":root { width: 100px; height: 100px; }";

describe("oklab color space", () => {
  test("round-trips sRGB losslessly", () => {
    for (const c of [
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 128, b: 255, a: 1 },
      { r: 17, g: 200, b: 34, a: 1 },
      { r: 255, g: 255, b: 255, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
    ]) {
      expect(oklabToRgba(rgbaToOklab(c))).toEqual(c);
    }
  });

  test("parses the CSS Color 4 spellings", () => {
    // oklch(0.628 0.2577 29.23) is the canonical Oklch of #ff0000.
    expect(rgb("oklch(0.628 0.2577 29.23)")).toEqual([255, 0, 0]);
    expect(rgb("oklch(1 0 0)")).toEqual([255, 255, 255]);
    expect(rgb("oklch(0 0 0)")).toEqual([0, 0, 0]);
    // Percentage L, and percentages against the 0.4 a/b reference.
    expect(rgb("oklab(100% 0 0)")).toEqual([255, 255, 255]);
    expect(tryParseOklabColor("oklab(50% 25% -50%)")).toMatchObject({
      L: 0.5,
      a: 0.1,
      b: -0.2,
    });
  });

  test("parses hue units and slash alpha", () => {
    const deg = tryParseOklabColor("oklch(0.7 0.2 180deg)")!;
    for (const equivalent of [
      "oklch(0.7 0.2 180)",
      "oklch(0.7 0.2 0.5turn)",
      "oklch(0.7 0.2 200grad)",
    ]) {
      const got = tryParseOklabColor(equivalent)!;
      expect(got.a).toBeCloseTo(deg.a, 6);
      expect(got.b).toBeCloseTo(deg.b, 6);
    }
    expect(tryParseOklabColor("oklch(0.7 0.2 30 / 0.5)")!.alpha).toBe(0.5);
    expect(tryParseOklabColor("oklab(0.7 0.1 0 / 50%)")!.alpha).toBe(0.5);
  });

  test("rejects non-oklab text", () => {
    for (const bad of ["#ff0000", "rgb(1,2,3)", "oklab()", "oklab(0.5 0.1)"]) {
      expect(tryParseOklabColor(bad)).toBeNull();
    }
  });

  test("hue arcs follow CSS Color 4", () => {
    expect(resolveHueArc(20, 340, "shorter")).toEqual([380, 340]);
    expect(resolveHueArc(20, 340, "longer")).toEqual([20, 340]);
    expect(resolveHueArc(340, 20, "increasing")).toEqual([340, 380]);
    expect(resolveHueArc(20, 340, "decreasing")).toEqual([380, 340]);
  });

  test("an achromatic endpoint borrows the other's hue", () => {
    // Mixing toward white must not swing chroma through an arbitrary arc.
    const red = rgbaToOklab(parseColor("#ff0000"));
    const white = rgbaToOklab(parseColor("#ffffff"));
    const mid = oklabToOklch(mixOklch(red, white, 0.5));
    // Hue is red's throughout; only lightness and chroma move.
    expect(mid.h).toBeCloseTo(oklabToOklch(red).h, 4);
    expect(mid.C).toBeCloseTo(oklabToOklch(red).C / 2, 4);
  });
});

describe("color interpolation space", () => {
  test("a legacy sRGB pair still interpolates in sRGB", () => {
    expect(interpolateColor("#ff0000", "#0000ff", 0.5)).toBe(
      "rgb(128, 0, 128)",
    );
  });

  test("an oklab endpoint moves the pair to Oklab", () => {
    const srgbMid = rgb(interpolateColor("#0011ff", "#fff300", 0.5));
    const oklabMid = rgb(
      interpolateColor("oklab(0.452 -0.032 -0.312)", "#fff300", 0.5),
    );
    // sRGB's blue->yellow midpoint collapses to grey; Oklab's keeps chroma.
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(srgbMid)).toBeLessThan(10);
    expect(spread(oklabMid)).toBeGreaterThan(60);
  });

  test("endpoints are exact regardless of space", () => {
    expect(
      rgb(interpolateColor("oklch(0.628 0.2577 29.23)", "#0000ff", 0)),
    ).toEqual([255, 0, 0]);
    expect(
      rgb(interpolateColor("oklch(0.628 0.2577 29.23)", "#0000ff", 1)),
    ).toEqual([0, 0, 255]);
  });
});

describe("scene integration", () => {
  test("oklab()/oklch() resolve as paints and normalize to oklab()", () => {
    const [a, b] = nodesOf(`${STAGE}
      #a { type: circle; cx: 5px; cy: 5px; r: 2px; fill: oklch(0.7 0.2 30deg); }
      #b { type: circle; cx: 5px; cy: 5px; r: 2px; fill: oklch(0.7 0.2 30 / 0.5); }`);
    expect(a.fill).toMatch(/^oklab\(/);
    expect(b.fill).toMatch(/ \/ 0\.5\)$/);
  });

  test("hex paints are untouched by the wide-gamut path", () => {
    const [n] = nodesOf(
      `${STAGE}\n#n { type: circle; cx: 5px; cy: 5px; r: 2px; fill: #ff0000; }`,
    );
    expect(n.fill).toBe("#ff0000");
  });
});

describe("gradient `in <space>`", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const gradientOf = (paint: string) => {
    const [n] = nodesOf(
      `${STAGE}\n#g { type: rect; x: 0; y: 0; width: 100px; height: 100px; fill: ${paint}; }`,
    );
    return n.fillGradient as never;
  };

  test("a plain gradient is not densified", () => {
    const g = gradientOf("linear-gradient(90deg, #0011ff, #fff300)");
    expect(resolveGradient(g, box).stops).toHaveLength(2);
  });

  test("`in oklab` densifies and keeps its endpoints", () => {
    const g = gradientOf("linear-gradient(90deg in oklab, #0011ff, #fff300)");
    const { stops } = resolveGradient(g, box);
    expect(stops.length).toBeGreaterThan(2);
    expect(rgb(stops[0].color)).toEqual([0, 17, 255]);
    expect(rgb(stops[stops.length - 1].color)).toEqual([255, 243, 0]);
    // Offsets stay monotonic so backends see a well-formed ramp.
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
    }
  });

  test("the method parses with or without a leading direction", () => {
    expect(
      (
        gradientOf(
          "linear-gradient(in oklch longer hue, #0011ff, #fff300)",
        ) as {
          interpolate: unknown;
        }
      ).interpolate,
    ).toEqual({ space: "oklch", hue: "longer" });
    expect(
      gradientOf("linear-gradient(45deg in oklab, #0011ff, #fff300)") as {
        angle: number;
        interpolate: unknown;
      },
    ).toMatchObject({ angle: 45, interpolate: { space: "oklab" } });
  });

  test("an unknown space degrades to sRGB rather than failing", () => {
    const g = gradientOf("linear-gradient(in lab, #0011ff, #fff300)");
    expect((g as { interpolate?: unknown }).interpolate).toBeUndefined();
    expect(resolveGradient(g, box).stops).toHaveLength(2);
  });

  test("hue method changes the ramp it takes", () => {
    const mid = (paint: string) => {
      const { stops } = resolveGradient(gradientOf(paint), box);
      return rgb(stops[Math.floor(stops.length / 2)].color);
    };
    expect(
      mid("linear-gradient(in oklch shorter hue, #0011ff, #fff300)"),
    ).not.toEqual(
      mid("linear-gradient(in oklch longer hue, #0011ff, #fff300)"),
    );
  });
});

describe("gradient morph compatibility", () => {
  const g = (paint: string) =>
    nodesOf(
      `${STAGE}\n#g { type: rect; x: 0; y: 0; width: 10px; height: 10px; fill: ${paint}; }`,
    )[0].fillGradient as never;

  test("a mismatched interpolation space steps instead of morphing", () => {
    const srgb = g("linear-gradient(90deg, #0011ff, #fff300)");
    const oklab = g("linear-gradient(90deg in oklab, #0011ff, #fff300)");
    const oklch = g("linear-gradient(90deg in oklch, #0011ff, #fff300)");
    expect(gradientsCompatible(srgb, oklab)).toBe(false);
    expect(gradientsCompatible(oklab, oklch)).toBe(false);
    expect(
      gradientsCompatible(
        oklab,
        g("linear-gradient(0deg in oklab, #123456, #654321)"),
      ),
    ).toBe(true);
  });

  test("a mismatched hue method steps too", () => {
    expect(
      gradientsCompatible(
        g("linear-gradient(in oklch shorter hue, #0011ff, #fff300)"),
        g("linear-gradient(in oklch longer hue, #0011ff, #fff300)"),
      ),
    ).toBe(false);
  });
});
