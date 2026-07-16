import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import { RenderLoop } from "../runtime/loop";
import { buildSceneGraph } from "../scene/builder";
import type { ImageData } from "../scene/types";
import type { Renderer } from "./interface";

// A no-op renderer that records the full drawImage argument list per call, so a
// test can assert the source-crop rect (sx..sh) the shared walk hands each backend.
type ImageCall = [
  string,
  number,
  number,
  number,
  number,
  number?,
  number?,
  number?,
  number?,
];
function recordingRenderer(): Renderer & { images: ImageCall[] } {
  const r: Partial<Renderer> & { images: ImageCall[] } = {
    images: [],
    clear() {},
    beginFrame() {},
    endFrame() {},
    drawRect() {},
    drawCircle() {},
    drawEllipse() {},
    drawPath() {},
    drawText() {},
    drawImage(...args: ImageCall) {
      r.images.push(args);
    },
    clip() {},
    compositeMask(_m, c, m) {
      c();
      m();
    },
    setFill() {},
    setFillGradient() {},
    setStroke() {},
    setStrokeGradient() {},
    setStrokeLineCap() {},
    setStrokeLineJoin() {},
    setStrokeMiterLimit() {},
    setTrim() {},
    setDash() {},
    setFillRule() {},
    setPaintOrder() {},
    setBlendMode() {},
    setOpacity() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    setTransform() {},
    getWidth() {
      return 100;
    },
    getHeight() {
      return 100;
    },
  };
  return r as Renderer & { images: ImageCall[] };
}

const SPRITE = "data:image/png;base64,AAAA";

// --- parse -------------------------------------------------------------------

test("object-view-box: xywh() parses to an image source-crop rect", () => {
  const [n] = buildSceneGraph(
    parse(
      `#s { type: image; content: url('${SPRITE}'); width: 64px; height: 64px;
            object-view-box: xywh(128px 0 64px 64px); }`,
    ),
  ).children;
  expect((n.shapeData as ImageData).viewBox).toEqual({
    x: 128,
    y: 0,
    width: 64,
    height: 64,
  });
});

test("object-view-box: none parses to no crop (whole bitmap)", () => {
  const [n] = buildSceneGraph(
    parse(
      `#s { type: image; content: url('${SPRITE}'); object-view-box: none; }`,
    ),
  ).children;
  expect((n.shapeData as ImageData).viewBox).toBeNull();
});

// --- static crop reaches the renderer ----------------------------------------

test("static crop draws the source sub-rect into the dest box (9-arg)", () => {
  const scene = buildSceneGraph(
    parse(
      `#s { type: image; content: url('${SPRITE}'); x: 5px; y: 7px;
            width: 40px; height: 40px; object-view-box: xywh(64px 32px 16px 16px); }`,
    ),
  );
  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(scene);
  loop.seek(0);
  // src=[64,32,16,16] -> dest=[5,7,40,40]
  expect(r.images.at(-1)).toEqual([SPRITE, 5, 7, 40, 40, 64, 32, 16, 16]);
});

test("a zero-size dest box falls back to the crop's own pixel size", () => {
  const scene = buildSceneGraph(
    parse(
      `#s { type: image; content: url('${SPRITE}');
            object-view-box: xywh(0 0 24px 12px); }`,
    ),
  );
  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(scene);
  loop.seek(0);
  expect(r.images.at(-1)).toEqual([SPRITE, 0, 0, 24, 12, 0, 0, 24, 12]);
});

// --- steps() keyframe paging -------------------------------------------------

test("steps() @keyframes pages discrete source rects (sprite sheet)", () => {
  // 4 frames of 64px across a 256px sheet; steps(4) holds one frame per quarter.
  const scene = buildSceneGraph(
    parse(
      `@keyframes play {
         from { object-view-box: xywh(0 0 64px 64px); }
         to   { object-view-box: xywh(256px 0 64px 64px); }
       }
       #s { type: image; content: url('${SPRITE}'); width: 64px; height: 64px;
            animation: play 4s steps(4, jump-none) infinite; }`,
    ),
  );
  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(scene);

  const frameX = (t: number): number => {
    r.images.length = 0;
    loop.seek(t);
    return r.images.at(-1)![5] as number; // sx
  };

  // jump-none over 4 steps: 0, 1, 2, 3 of the 0..256 range -> 0, 85.3, 170.6, 256.
  expect(frameX(0)).toBeCloseTo(0, 3);
  expect(frameX(1100)).toBeCloseTo(256 / 3, 1);
  expect(frameX(2100)).toBeCloseTo((256 / 3) * 2, 1);
  expect(frameX(3100)).toBeCloseTo(256, 1);
  // Each sampled sx is a discrete frame edge, never a value in between.
  for (const t of [0, 500, 1100, 2100, 3100, 3900]) {
    const sx = frameX(t);
    const q = sx / (256 / 3);
    expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-6);
  }
});

// --- var-driven frame selection ----------------------------------------------

test("var(--frame) selects the crop column and re-resolves per frame", () => {
  const scene = buildSceneGraph(
    parse(
      `#s { type: image; content: url('${SPRITE}'); width: 64px; height: 64px;
            object-view-box: xywh(calc(var(--frame) * 64px) 0 64px 64px); }`,
    ),
  );
  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(scene);
  const vars = loop.getVariableResolver();

  const sxAt = (frame: number): number => {
    vars.setVariable("--frame", frame);
    r.images.length = 0;
    loop.seek(0);
    return r.images.at(-1)![5] as number;
  };

  expect(sxAt(0)).toBe(0);
  expect(sxAt(3)).toBe(192);
  expect(sxAt(7)).toBe(448);
});

// --- degenerate rects --------------------------------------------------------

test("a zero/negative source size skips the draw entirely", () => {
  const scene = buildSceneGraph(
    parse(
      `#s { type: image; content: url('${SPRITE}'); width: 40px; height: 40px;
            object-view-box: xywh(10px 10px 0 20px); }`,
    ),
  );
  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(scene);
  loop.seek(0);
  expect(r.images.length).toBe(0);
});

test("an out-of-bounds crop passes through unclamped (backend draws the overlap)", () => {
  const scene = buildSceneGraph(
    parse(
      `#s { type: image; content: url('${SPRITE}'); width: 40px; height: 40px;
            object-view-box: xywh(1000px 1000px 64px 64px); }`,
    ),
  );
  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(scene);
  loop.seek(0);
  expect(r.images.at(-1)).toEqual([SPRITE, 0, 0, 40, 40, 1000, 1000, 64, 64]);
});
