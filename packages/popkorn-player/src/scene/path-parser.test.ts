import { expect, test } from "bun:test";
import { parsePath } from "./path-parser";

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
