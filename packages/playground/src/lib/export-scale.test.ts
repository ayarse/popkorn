import { expect, test } from "bun:test";
import { scaledFrame } from "@/lib/export-scale";
import { evenDim, maxMp4Scale } from "@/lib/mp4-plan";

test("scale 2 renders a 2x-dimension frame through a 2x viewport", () => {
  expect(scaledFrame(400, 300, 2)).toEqual({
    width: 800,
    height: 600,
    viewport: [2, 0, 0, 0, 2, 0, 0, 0, 1],
  });
  expect(scaledFrame(401, 301, 3, evenDim)).toMatchObject({
    width: 1202,
    height: 902,
  });
});

test("maxMp4Scale caps scale to the top AVC level", () => {
  expect(maxMp4Scale(800, 600)).toBe(3);
  expect(maxMp4Scale(1920, 1080)).toBe(2);
  expect(maxMp4Scale(4096, 2304)).toBe(1);
});
