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
