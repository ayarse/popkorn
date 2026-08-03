import { expect, test } from "bun:test";
import { maskDeviceBounds, subtreeDeviceBounds } from "./bounds";
import { IDENTITY_MATRIX } from "./matrix";
import type { SceneNode } from "./types";
import { createSceneNode } from "./types";

const BUF = 1000;
// subtreeDeviceBounds pads the region by ANTIALIAS_SLOP device px per side so a
// rasterizer's antialiased fringe isn't clipped off. Expectations below fold it
// in via `slop`, rather than hard-coding pre-padded numbers that hide it.
const SLOP = 2;
function slop(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(0, x - SLOP),
    y: Math.max(0, y - SLOP),
    width: width + SLOP * 2 - (x - SLOP < 0 ? SLOP - x : 0),
    height: height + SLOP * 2 - (y - SLOP < 0 ? SLOP - y : 0),
  };
}

function rect(id: string, x: number, y: number, w: number, h: number) {
  const n = createSceneNode(id, "rect");
  n.shapeData = { type: "rect", x, y, width: w, height: h } as never;
  return n;
}

function adopt(parent: SceneNode, child: SceneNode) {
  child.parent = parent;
  parent.children.push(child);
  return parent;
}

function bounds(node: SceneNode, paintSource = false) {
  return subtreeDeviceBounds(node, IDENTITY_MATRIX, BUF, BUF, paintSource);
}

test("a shape's box is its geometry, offset by its own transform", () => {
  const n = rect("r", 10, 20, 30, 40);
  n.transform.translateX = 100;
  n.transform.translateY = 200;
  expect(bounds(n)).toEqual(slop(110, 220, 30, 40));
});

test("a group has no box of its own but unions its children", () => {
  const g = createSceneNode("g", "group");
  adopt(g, rect("a", 0, 0, 10, 10));
  adopt(g, rect("b", 90, 40, 10, 10));
  expect(bounds(g)).toEqual(slop(0, 0, 100, 50));
});

test("a path resolves through its commands (getShapeBounds has no box for it)", () => {
  const n = createSceneNode("p", "path");
  n.shapeData = {
    type: "path",
    d: "",
    commands: [
      { type: "M", x: 5, y: 5 },
      { type: "L", x: 25, y: 45 },
    ],
  } as never;
  expect(bounds(n)).toEqual(slop(5, 5, 20, 40));
});

test("blur bleeds the box by ~3x its radius, scaled to device space", () => {
  const n = rect("r", 100, 100, 20, 20);
  n.filter = [{ type: "blur", radius: 10 }];
  // 3 x 10 = 30 device px on each side at scale 1.
  expect(bounds(n)).toEqual(slop(70, 70, 80, 80));

  // Under a 2x scale the same authored radius reaches twice as far, matching
  // the world scale the loop feeds filterToCSS.
  n.transform.scaleX = 2;
  n.transform.scaleY = 2;
  const b = bounds(n)!;
  expect(b.width).toBe(20 * 2 + 30 * 2 * 2 + SLOP * 2);
});

test("a blurred descendant widens its ancestor's box", () => {
  const g = createSceneNode("g", "group");
  const child = rect("c", 100, 100, 10, 10);
  child.filter = [{ type: "blur", radius: 5 }];
  adopt(g, child);
  // Without the descendant's own bleed this would be 100,100 10x10.
  expect(bounds(g)).toEqual(slop(85, 85, 40, 40));
});

test("a drop-shadow extends the box in the offset's direction", () => {
  const n = rect("r", 100, 100, 20, 20);
  n.filter = [{ type: "drop-shadow", dx: 10, dy: 0, blur: 0, color: "#000" }];
  expect(bounds(n)).toEqual(slop(100, 100, 30, 20));
});

test("the walk skips what the render walk skips", () => {
  const hidden = rect("h", 0, 0, 10, 10);
  hidden.hidden = true;
  expect(bounds(hidden)).toBeNull();

  const gone = rect("d", 0, 0, 10, 10);
  gone.displayNone = true;
  expect(bounds(gone)).toBeNull();

  // A mask source paints only via its dependent's composite — unless that
  // composite is what's asking (paintSource).
  const src = rect("s", 0, 0, 10, 10);
  src.isMaskSource = true;
  expect(bounds(src)).toBeNull();
  expect(bounds(src, true)).toEqual(slop(0, 0, 10, 10));
});

test("the region is clamped to the buffer, and null when fully outside it", () => {
  const partly = rect("p", -50, -50, 100, 100);
  expect(bounds(partly)).toEqual({ x: 0, y: 0, width: 52, height: 52 });

  const outside = rect("o", BUF + 10, 0, 10, 10);
  expect(bounds(outside)).toBeNull();
});

test("mask region: non-inverted intersects, inverted keeps the whole content", () => {
  const content = { x: 0, y: 0, width: 100, height: 100 };
  const mask = { x: 50, y: 50, width: 200, height: 200 };

  expect(maskDeviceBounds(content, mask, false)).toEqual({
    x: 50,
    y: 50,
    width: 50,
    height: 50,
  });

  // The trap: an inverted mask preserves content by being TRANSPARENT, so
  // content outside the mask survives and must not be intersected away.
  expect(maskDeviceBounds(content, mask, true)).toEqual(content);
});

test("mask region: disjoint content and mask composite to nothing", () => {
  const content = { x: 0, y: 0, width: 10, height: 10 };
  const mask = { x: 500, y: 500, width: 10, height: 10 };
  expect(maskDeviceBounds(content, mask, false)).toBeNull();
});

test("a text box is padded past its advance width and em square", () => {
  // getShapeBounds puts the em square above the baseline and sizes it by the
  // advance width; real glyphs ink outside both, and clipping that is visible.
  const n = createSceneNode("t", "text");
  n.shapeData = {
    type: "text",
    content: "A",
    x: 200,
    y: 300,
    fontSize: 100,
    fontFamily: "sans-serif",
    fontWeight: 400,
    anchor: "start",
    lineHeight: 0,
    letterSpacing: 0,
  } as never;
  const b = bounds(n)!;
  // The unpadded em square is y 200..300; the box must reach below the baseline
  // (descenders) and above the cap line (overshoot/accents).
  expect(b.y).toBeLessThan(200);
  expect(b.y + b.height).toBeGreaterThan(300);
});

// --- regressions: cases where the box under-reported and clipped real paint ---

test("a miter join's spike is inside the box (miterLimit, not just width)", () => {
  // The spike at a sharp vertex runs to miterLimit x width / 2 past the path;
  // padding by width alone chopped it off for ordinary sharp corners.
  const n = createSceneNode("m", "path");
  n.shapeData = {
    type: "path",
    d: "",
    commands: [
      { type: "M", x: 60, y: 150 },
      { type: "L", x: 260, y: 150 },
      { type: "L", x: 60, y: 192 },
      { type: "Z" },
    ],
  } as never;
  n.stroke = "#fff";
  n.strokeWidth = 30;
  n.strokeLineJoin = "miter";
  n.strokeMiterLimit = 10;

  const b = bounds(n)!;
  // miterLimit 10 x width 30 / 2 = 150 of reach, vs the old flat 30.
  expect(b.x + b.width).toBeGreaterThanOrEqual(260 + 150);
});

test("round/bevel joins don't pay the miter pad", () => {
  const mk = (join: "miter" | "round") => {
    const n = createSceneNode("j", "rect");
    n.shapeData = { type: "rect", x: 0, y: 0, width: 10, height: 10 } as never;
    n.stroke = "#fff";
    n.strokeWidth = 20;
    n.strokeMiterLimit = 10;
    n.strokeLineJoin = join;
    return bounds(n)!;
  };
  expect(mk("round").width).toBeLessThan(mk("miter").width);
});

test("a zero-length round-cap stroke still gets a box (it paints a dot)", () => {
  // Standard converted-Lottie dotted-line idiom: the box is a point, but the
  // cap paints a full-width dot. Culling it dropped the node entirely.
  const n = createSceneNode("dot", "path");
  n.shapeData = {
    type: "path",
    d: "",
    commands: [
      { type: "M", x: 200, y: 100 },
      { type: "L", x: 200, y: 100 },
    ],
  } as never;
  n.stroke = "#fff";
  n.strokeWidth = 40;
  n.strokeLineCap = "round";

  const b = bounds(n);
  expect(b).not.toBeNull();
  expect(b!.width).toBeGreaterThanOrEqual(40);
});

test("a zero-area shape with no stroke is still culled", () => {
  const n = createSceneNode("empty", "rect");
  n.shapeData = { type: "rect", x: 5, y: 5, width: 0, height: 0 } as never;
  expect(bounds(n)).toBeNull();
});

test("chained filter ops accumulate rather than taking the max", () => {
  // A filter list is a pipeline: drop-shadow displaces the ALREADY-blurred
  // image, so the reaches add. Taking the max cut the chain short, which shows
  // up as a hard edge once the node sits inside another composite's clip.
  const n = createSceneNode("f", "rect");
  n.shapeData = {
    type: "rect",
    x: 200,
    y: 200,
    width: 60,
    height: 60,
  } as never;
  n.filter = [
    { type: "blur", radius: 10 },
    { type: "drop-shadow", dx: 60, dy: 0, blur: 0, color: "red" },
  ];
  const b = bounds(n)!;
  // right edge 260 + blur 3x10 + shadow offset 60 = 350 (max() would give 290).
  expect(b.x + b.width).toBeGreaterThanOrEqual(350);
});

test("an image with no explicit size falls back to its crop, else unbounded", () => {
  const cropped = createSceneNode("img", "image");
  cropped.shapeData = {
    type: "image",
    x: 10,
    y: 20,
    width: 0,
    height: 0,
    src: "a.png",
    viewBox: { x: 0, y: 0, width: 40, height: 30 },
  } as never;
  expect(bounds(cropped)).toEqual(slop(10, 20, 40, 30));

  // No crop and no size: the natural size isn't known until the decode lands,
  // so the region must widen to the whole buffer, never cull the image.
  const unsized = createSceneNode("img2", "image");
  unsized.shapeData = {
    type: "image",
    x: 10,
    y: 20,
    width: 0,
    height: 0,
    src: "a.png",
    viewBox: null,
  } as never;
  expect(bounds(unsized)).toEqual({ x: 0, y: 0, width: BUF, height: BUF });
});
