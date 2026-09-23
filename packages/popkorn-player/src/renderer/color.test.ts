import { expect, test } from "bun:test";
import { tryParseColor } from "./color";

const rgba = (css: string) => {
  const c = tryParseColor(css);
  return c && [c.r, c.g, c.b, c.a];
};

test("hex: 3/4/6/8 digits; junk rejected", () => {
  expect(rgba("#f00")).toEqual([255, 0, 0, 1]);
  expect(rgba("#f008")).toEqual([255, 0, 0, 0x88 / 255]);
  expect(rgba("#00ff0080")).toEqual([0, 255, 0, 0x80 / 255]);
  expect(rgba("#ggg")).toBeNull();
  expect(rgba("#12345")).toBeNull();
});

test("rgb(): %, decimals, space syntax, % alpha, clamped", () => {
  expect(rgba("rgb(100%, 50%, 0%)")).toEqual([255, 128, 0, 1]);
  expect(rgba("rgb(10.4 20.6 30 / 50%)")).toEqual([10, 21, 30, 0.5]);
  expect(rgba("rgba(300, -5, 0, 2)")).toEqual([255, 0, 0, 1]);
  expect(rgba("rgb(1, 2)")).toBeNull();
  expect(rgba("x rgb(1, 2, 3)")).toBeNull();
});

test("hsl(): % or bare-number s/l, % alpha", () => {
  expect(rgba("hsl(0, 100%, 50%)")).toEqual([255, 0, 0, 1]);
  expect(rgba("hsl(120 100 25)")).toEqual([0, 128, 0, 1]);
  expect(rgba("hsla(240deg, 100%, 50%, 25%)")).toEqual([0, 0, 255, 0.25]);
});

test("named: full CSS list, case-insensitive; transparent and prototype keys aren't", () => {
  expect(rgba("RebeccaPurple")).toEqual([102, 51, 153, 1]);
  expect(rgba("lightgoldenrodyellow")).toEqual([250, 250, 210, 1]);
  expect(rgba("transparent")).toBeNull();
  expect(rgba("constructor")).toBeNull();
});
