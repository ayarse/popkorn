import { expect, test } from "bun:test";
import {
  applyCommandsToPath,
  flattenToSubpaths,
  type PathSink,
  parsePath,
} from "./path-parser.js";

test("parsePath splits compact concatenated decimals into separate numbers", () => {
  // Compact SVG notation: ".2-1.96" must tokenize as -0.2, -1.96, not one number.
  const commands = parsePath("M0 0a.99.99 0 0 1-.2-1.96");

  expect(commands.length).toBe(2);
  expect(commands[0]).toEqual({ type: "M", x: 0, y: 0 });

  const arc = commands[1];
  expect(arc.type).toBe("A");
  if (arc.type !== "A") throw new Error("expected arc command");
  expect(arc.rx).toBeCloseTo(0.99);
  expect(arc.ry).toBeCloseTo(0.99);
  expect(arc.angle).toBe(0);
  expect(arc.largeArc).toBe(false);
  expect(arc.sweep).toBe(true);
  expect(arc.x).toBeCloseTo(-0.2);
  expect(arc.y).toBeCloseTo(-1.96);

  for (const cmd of commands) {
    for (const value of Object.values(cmd)) {
      if (typeof value === "number") {
        expect(Number.isNaN(value)).toBe(false);
      }
    }
  }
});

// SVG arc flags are single chars; svgo glues them onto the following number.
// Each case asserts flags AND the endpoint (no NaN from a swallowed coordinate).
const arcFlagCases: Array<{
  d: string;
  largeArc: boolean;
  sweep: boolean;
  x: number;
  y: number;
}> = [
  { d: "M0 0a5 5 0 011.5.5", largeArc: false, sweep: true, x: 1.5, y: 0.5 },
  { d: "M0 0a.5.5 0 01.3.3", largeArc: false, sweep: true, x: 0.3, y: 0.3 },
  { d: "M0 0A5 5 0 1 1 1.5.5", largeArc: true, sweep: true, x: 1.5, y: 0.5 },
  { d: "M0 0a5 5 0 105 5", largeArc: true, sweep: false, x: 5, y: 5 },
];

for (const c of arcFlagCases) {
  test(`parsePath reads packed/spaced arc flags: ${c.d}`, () => {
    const commands = parsePath(c.d);
    const arc = commands[1];
    expect(arc.type).toBe("A");
    if (arc.type !== "A") throw new Error("expected arc command");
    expect(arc.largeArc).toBe(c.largeArc);
    expect(arc.sweep).toBe(c.sweep);
    expect(arc.x).toBeCloseTo(c.x);
    expect(arc.y).toBeCloseTo(c.y);

    for (const cmd of commands) {
      for (const value of Object.values(cmd)) {
        if (typeof value === "number") {
          expect(Number.isNaN(value)).toBe(false);
        }
      }
    }
  });
}

test("Z returns the pen to the subpath start for render and flatten alike", () => {
  const cmds = parsePath("M0 0 L10 10 Z H5");
  const lines: number[][] = [];
  const noop = () => {};
  const sink: PathSink = {
    moveTo: noop,
    lineTo: (x, y) => lines.push([x, y]),
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    ellipse: noop,
    closePath: noop,
  };
  applyCommandsToPath(sink, cmds);
  expect(lines.at(-1)).toEqual([5, 0]);
  expect(flattenToSubpaths(cmds)[0].at(-1)).toEqual({ x: 5, y: 0 });
});

test("truncated commands end the path at the last complete command", () => {
  const m = { type: "M", x: 0, y: 0 };
  const l = { type: "L", x: 1, y: 1 };
  expect(parsePath("M0 0a1 1 0 0")).toEqual([m]);
  expect(parsePath("M0 0 a5 5 0 1.5 5 5")).toEqual([m]);
  expect(parsePath("M0 0 L1 1 C1 2 3 4 5")).toEqual([m, l]);
  expect(parsePath("M0 0 L1 1 Q1 2 3")).toEqual([m, l]);
  expect(parsePath("M0 0 L1 1 L2")).toEqual([m, l]);
  expect(parsePath("M0 0 L1 1 L2 Z")).toEqual([m, l]);
  expect(parsePath("M0")).toEqual([]);
});
