import { describe, expect, test } from "bun:test";
import type { LinearEasing, StepsEasing } from "../scene/types";
import { applyEasing, linearEasing, stepEasing } from "./easing";

const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("steps() easing (CSS Easing L1 value tables)", () => {
  // steps(4, jump-end) — default: no jump at t=0, jump at t=1.
  test("steps(4, jump-end)", () => {
    const s: StepsEasing = { type: "steps", count: 4, position: "jump-end" };
    expect(applyEasing(0, s)).toBe(0);
    expect(applyEasing(0.1, s)).toBe(0);
    expect(applyEasing(0.3, s)).toBe(0.25);
    expect(applyEasing(0.6, s)).toBe(0.5);
    expect(applyEasing(0.9, s)).toBe(0.75);
    expect(applyEasing(1, s)).toBe(1);
  });

  // steps(4, jump-start): jumps immediately at t=0.
  test("steps(4, jump-start)", () => {
    const s: StepsEasing = { type: "steps", count: 4, position: "jump-start" };
    expect(applyEasing(0, s)).toBe(0.25);
    expect(applyEasing(0.1, s)).toBe(0.25);
    expect(applyEasing(0.3, s)).toBe(0.5);
    expect(applyEasing(0.6, s)).toBe(0.75);
    expect(applyEasing(0.9, s)).toBe(1);
    expect(applyEasing(1, s)).toBe(1);
  });

  // steps(4, jump-none): n distinct levels 0..1, no jump at either edge.
  test("steps(4, jump-none)", () => {
    const s: StepsEasing = { type: "steps", count: 4, position: "jump-none" };
    expect(applyEasing(0, s)).toBe(0);
    expect(approx(applyEasing(0.3, s), 1 / 3)).toBe(true);
    expect(approx(applyEasing(0.6, s), 2 / 3)).toBe(true);
    expect(applyEasing(0.9, s)).toBe(1);
    expect(applyEasing(1, s)).toBe(1);
  });

  // steps(4, jump-both): jump at both edges, n+1 intervals.
  test("steps(4, jump-both)", () => {
    const s: StepsEasing = { type: "steps", count: 4, position: "jump-both" };
    expect(applyEasing(0, s)).toBe(0.2);
    expect(applyEasing(0.3, s)).toBe(0.4);
    expect(applyEasing(0.6, s)).toBe(0.6);
    expect(applyEasing(0.9, s)).toBe(0.8);
    expect(applyEasing(1, s)).toBe(1);
  });

  test("step-start === steps(1, jump-start): holds at end value", () => {
    expect(applyEasing(0, "step-start")).toBe(1);
    expect(applyEasing(0.5, "step-start")).toBe(1);
    expect(applyEasing(1, "step-start")).toBe(1);
    expect(stepEasing(0.5, 1, "jump-start")).toBe(1);
  });

  test("step-end === steps(1, jump-end): holds at start value (unchanged)", () => {
    expect(applyEasing(0, "step-end")).toBe(0);
    expect(applyEasing(0.5, "step-end")).toBe(0);
    expect(applyEasing(0.999, "step-end")).toBe(0);
    expect(applyEasing(1, "step-end")).toBe(1);
  });
});

describe("linear() easing (CSS Easing L2)", () => {
  // linear(0, 0.25, 1): evenly distributed inputs at 0, 0.5, 1.
  test("evenly distributed inputs", () => {
    const pts = [
      { input: 0, output: 0 },
      { input: 0.5, output: 0.25 },
      { input: 1, output: 1 },
    ];
    expect(linearEasing(0, pts)).toBe(0);
    expect(linearEasing(0.25, pts)).toBe(0.125); // halfway 0->0.25
    expect(linearEasing(0.5, pts)).toBe(0.25);
    expect(linearEasing(0.75, pts)).toBe(0.625); // halfway 0.25->1
    expect(linearEasing(1, pts)).toBe(1);
  });

  // linear(0, 0.5 50%, 1) is identity-like: the 50% is redundant.
  test("explicit input percentage", () => {
    const pts = [
      { input: 0, output: 0 },
      { input: 0.5, output: 0.5 },
      { input: 1, output: 1 },
    ];
    expect(linearEasing(0.3, pts)).toBeCloseTo(0.3, 10);
  });

  // Flat segment (two inputs, same output): linear(0, 0.5 25% 75%, 1) holds 0.5
  // across [0.25, 0.75].
  test("flat segment holds", () => {
    const pts = [
      { input: 0, output: 0 },
      { input: 0.25, output: 0.5 },
      { input: 0.75, output: 0.5 },
      { input: 1, output: 1 },
    ];
    expect(linearEasing(0.5, pts)).toBe(0.5);
    expect(linearEasing(0.25, pts)).toBe(0.5);
    expect(linearEasing(0.75, pts)).toBe(0.5);
  });

  // Overshoot: outputs may exceed 1 (spring/bounce enabler).
  test("overshoot output not clamped", () => {
    const pts = [
      { input: 0, output: 0 },
      { input: 0.5, output: 1.4 },
      { input: 1, output: 1 },
    ];
    expect(linearEasing(0.5, pts)).toBe(1.4);
    const e: LinearEasing = { type: "linear", points: pts };
    expect(applyEasing(0.5, e)).toBe(1.4);
    expect(applyEasing(0.25, e)).toBe(0.7);
  });
});
