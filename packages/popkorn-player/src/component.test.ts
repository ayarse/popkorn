import { expect, test } from "bun:test";
import { formatAnimatableValue } from "./component";
import { createDefaultTransform } from "./scene/types";

test("formatAnimatableValue: number trims to a short display string", () => {
  expect(formatAnimatableValue(45)).toBe("45");
  expect(formatAnimatableValue(0.5)).toBe("0.5");
  expect(formatAnimatableValue(1.23456)).toBe("1.235");
});

test("formatAnimatableValue: string passes through", () => {
  expect(formatAnimatableValue("#ff0000")).toBe("#ff0000");
});

test("formatAnimatableValue: Transform summarizes non-default channels", () => {
  const t = createDefaultTransform();
  t.translateX = 20;
  t.rotate = 45;
  expect(formatAnimatableValue(t)).toBe("x 20, rot 45°");
});

test("formatAnimatableValue: identity Transform reads as none", () => {
  expect(formatAnimatableValue(createDefaultTransform())).toBe("none");
});

test("formatAnimatableValue: uniform vs per-axis scale", () => {
  const uni = createDefaultTransform();
  uni.scaleX = uni.scaleY = 2;
  expect(formatAnimatableValue(uni)).toBe("scale 2");
  const ani = createDefaultTransform();
  ani.scaleX = 2;
  ani.scaleY = 0.5;
  expect(formatAnimatableValue(ani)).toBe("scale 2,0.5");
});

test("formatAnimatableValue: gradient / path / filter type tags", () => {
  expect(
    formatAnimatableValue({
      type: "linear-gradient",
      angle: 0,
      stops: [],
    } as never),
  ).toBe("gradient");
  expect(
    formatAnimatableValue([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 1, y: 1 },
    ] as never),
  ).toBe("path");
  expect(formatAnimatableValue([{ type: "blur", radius: 4 }] as never)).toBe(
    "filter",
  );
});
