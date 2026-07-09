import { expect, test } from "bun:test";
import { parse } from "@popcorn/parser";
import type { LinearGradientData, RadialGradientData } from "./renderer/types";
import { hitTest } from "./runtime/hit-test";
import { buildSceneGraph } from "./scene/builder";
import { arcToEllipse } from "./scene/path-parser";
import type { SceneNode } from "./scene/types";
import { createSceneNode } from "./scene/types";

// --- helpers -----------------------------------------------------------------

function firstNode(css: string): SceneNode {
  return buildSceneGraph(parse(css)).children[0];
}

function rect(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): SceneNode {
  const node = createSceneNode(id, "rect");
  node.shapeData = { type: "rect", x, y, width: w, height: h, rx: 0, ry: 0 };
  return node;
}

// --- (1) elliptical arc center parameterization (SVG F.6.5 / F.6.6) ----------

test("arcToEllipse: semicircle resolves to the correct center and radii", () => {
  // (0,0) -> (100,0), r=50: endpoints are a diameter apart, so the only center
  // is the midpoint (50,0).
  const seg = arcToEllipse(0, 0, 50, 50, 0, false, false, 100, 0);
  expect(seg).not.toBeNull();
  expect(seg!.cx).toBeCloseTo(50, 6);
  expect(seg!.cy).toBeCloseTo(0, 6);
  expect(seg!.rx).toBeCloseTo(50, 6);
  expect(seg!.ry).toBeCloseTo(50, 6);
});

test("arcToEllipse: sweep flag flips arc direction", () => {
  const cw = arcToEllipse(0, 0, 50, 50, 0, false, true, 100, 0);
  const ccw = arcToEllipse(0, 0, 50, 50, 0, false, false, 100, 0);
  expect(cw!.counterclockwise).toBe(false);
  expect(ccw!.counterclockwise).toBe(true);
});

test("arcToEllipse: zero radius degenerates to a line (null)", () => {
  expect(arcToEllipse(0, 0, 0, 50, 0, false, false, 100, 0)).toBeNull();
  expect(arcToEllipse(0, 0, 50, 0, 0, false, false, 100, 0)).toBeNull();
});

test("arcToEllipse: coincident endpoints degenerate (null)", () => {
  expect(arcToEllipse(10, 10, 50, 50, 0, false, false, 10, 10)).toBeNull();
});

test("arcToEllipse: radii too small are scaled up (F.6.6)", () => {
  // Endpoints 100 apart need r >= 50; radii of 10 scale up to 50.
  const seg = arcToEllipse(0, 0, 10, 10, 0, false, false, 100, 0);
  expect(seg).not.toBeNull();
  expect(seg!.rx).toBeCloseTo(50, 6);
  expect(seg!.ry).toBeCloseTo(50, 6);
  expect(seg!.cx).toBeCloseTo(50, 6);
});

// --- (2) gradient fills in the builder ---------------------------------------

test("builder: linear-gradient parses angle and stops", () => {
  const node = firstNode(
    "#a { type: rect; width: 100px; height: 100px; fill: linear-gradient(90deg, #ff0000 0%, #0000ff 100%); }",
  );
  expect(node.fill).toBeNull(); // solid fill cleared in favor of the gradient
  const g = node.fillGradient as LinearGradientData;
  expect(g.type).toBe("linear-gradient");
  expect(g.angle).toBe(90);
  expect(g.stops).toHaveLength(2);
  expect(g.stops[0]).toEqual({ offset: 0, color: "#ff0000" });
  expect(g.stops[1]).toEqual({ offset: 1, color: "#0000ff" });
});

test("builder: linear-gradient defaults angle to 180deg (to bottom)", () => {
  const node = firstNode(
    "#a { type: rect; fill: linear-gradient(#fff 0%, #000 100%); }",
  );
  expect((node.fillGradient as LinearGradientData).angle).toBe(180);
});

test("builder: radial-gradient parses stops (no angle)", () => {
  const node = firstNode(
    "#b { type: circle; r: 50px; fill: radial-gradient(#ffffff 0%, #000000 100%); }",
  );
  const g = node.fillGradient as RadialGradientData;
  expect(g.type).toBe("radial-gradient");
  expect(g.stops).toHaveLength(2);
});

test("builder: rgba() color stops are preserved", () => {
  const node = firstNode(
    "#a { type: rect; fill: linear-gradient(0deg, rgba(255, 0, 0, 0.5) 0%, #00ff00 100%); }",
  );
  const g = node.fillGradient as LinearGradientData;
  expect(g.stops[0].color).toBe("rgba(255, 0, 0, 0.5)");
});

test("builder: gradients are allowed on stroke", () => {
  const node = firstNode(
    "#a { type: rect; stroke: linear-gradient(45deg, #000 0%, #fff 100%); }",
  );
  expect(node.stroke).toBeNull();
  expect((node.strokeGradient as LinearGradientData).type).toBe(
    "linear-gradient",
  );
});

test("builder: invalid gradient falls back without throwing", () => {
  // No color stops -> not a usable gradient; fill stays unset, no gradient.
  const node = firstNode("#a { type: rect; fill: linear-gradient(90deg); }");
  expect(node.fillGradient).toBeNull();
  expect(node.fill).toBeNull();
});

// --- (3) clip-path parsing ---------------------------------------------------

test("builder: clip-path circle() parses radius and center", () => {
  const node = firstNode(
    "#g { type: group; clip-path: circle(50px at 100px 120px); }",
  );
  expect(node.clipPath).toEqual({ type: "circle", r: 50, x: 100, y: 120 });
});

test("builder: clip-path inset() parses four insets", () => {
  const node = firstNode(
    "#g { type: group; clip-path: inset(10px 20px 30px 40px); }",
  );
  expect(node.clipPath).toEqual({
    type: "inset",
    top: 10,
    right: 20,
    bottom: 30,
    left: 40,
  });
});

test("builder: clip-path path() parses commands", () => {
  const node = firstNode(
    "#g { type: group; clip-path: path('M0 0 L100 0 L0 100 Z'); }",
  );
  expect(node.clipPath?.type).toBe("path");
  if (node.clipPath?.type === "path") {
    expect(node.clipPath.commands.length).toBeGreaterThan(0);
  }
});

// --- (4) hit-test respects clip regions --------------------------------------

test("hitTest: circle clip on a group rejects points outside the region", () => {
  const group = createSceneNode("g", "group");
  group.clipPath = { type: "circle", r: 50, x: 100, y: 100 };
  const child = rect("c", 0, 0, 400, 400);
  child.interactive = true;
  child.parent = group;
  group.children.push(child);

  // Inside both the clip circle and the child rect -> hit.
  expect(hitTest(group, { x: 100, y: 100 })).toBe(child);
  // Inside the rect but outside the clip circle -> descendant unreachable.
  expect(hitTest(group, { x: 300, y: 300 })).toBeNull();
});

test("hitTest: inset clip on a rect rejects points outside the inset box", () => {
  const node = rect("r", 0, 0, 200, 200);
  node.interactive = true;
  node.clipPath = { type: "inset", top: 50, right: 50, bottom: 50, left: 50 };

  // Center is inside the inset box (50,50)-(150,150).
  expect(hitTest(node, { x: 100, y: 100 })).toBe(node);
  // (20,20) is inside the rect but outside the inset region.
  expect(hitTest(node, { x: 20, y: 20 })).toBeNull();
});

const hasPath2D = typeof Path2D !== "undefined";

test.skipIf(!hasPath2D)(
  "hitTest: path clip rejects points outside the path",
  () => {
    const group = createSceneNode("g", "group");
    group.clipPath = {
      type: "path",
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 100, y: 0 },
        { type: "L", x: 0, y: 100 },
        { type: "Z" },
      ],
    };
    const child = rect("c", 0, 0, 200, 200);
    child.interactive = true;
    child.parent = group;
    group.children.push(child);

    // (10,10) is inside the lower-left triangle clip; (90,90) is outside it.
    expect(hitTest(group, { x: 10, y: 10 })).toBe(child);
    expect(hitTest(group, { x: 90, y: 90 })).toBeNull();
  },
);

test.skipIf(!hasPath2D)(
  "hitTest: multi-path (unioned) clip passes inside any subpath",
  () => {
    // Two disjoint boxes concatenated into one command list (mask add-mode).
    const group = firstNode(
      "#g { type: group; clip-path: path('M0 0 L20 0 L20 20 L0 20 Z') path('M80 80 L100 80 L100 100 L80 100 Z'); }",
    );
    const child = rect("c", 0, 0, 200, 200);
    child.interactive = true;
    child.parent = group;
    group.children.push(child);

    expect(hitTest(group, { x: 10, y: 10 })).toBe(child); // inside first box
    expect(hitTest(group, { x: 90, y: 90 })).toBe(child); // inside second box
    expect(hitTest(group, { x: 50, y: 50 })).toBeNull(); // between them -> rejected
  },
);
