import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import type { Renderer } from "../renderer/interface";
import type { Matrix3x3, PathCommand, ResolvedClip } from "../renderer/types";
import { buildSceneGraph } from "../scene/builder";
import { parsePath } from "../scene/path-parser";
import type { FillRule, MaskMode, SceneNode } from "../scene/types";
import { createSceneNode, snapshotNode } from "../scene/types";
import { hitTest, hitTestClick } from "./hit-test";
import { type ClickDetail, RenderLoop } from "./loop";

// These tests are DOM-free ON PURPOSE: they run headless where `Path2D` is
// undefined, which is exactly the React Native environment where the old
// scratch-context path hit-test silently missed every `type: path` shape.

// The lamp bulb outline from examples/popkorn/13-state-machine--lamp.css.
const BULB_D =
  "M 100 40 C 66 40 45 66 45 98 C 45 122 57 138 68 152 C 76 162 81 172 82 186 L 118 186 C 119 172 124 162 132 152 C 143 138 155 122 155 98 C 155 66 134 40 100 40 Z";

// A minimal all-no-op renderer; hit-testing never touches the renderer, so the
// end-to-end machine test only needs a live loop, not real paint.
function noopRenderer(): Renderer {
  return {
    clear() {},
    beginFrame() {},
    endFrame() {},
    drawRect() {},
    drawCircle() {},
    drawEllipse() {},
    drawPath(_c: PathCommand[]) {},
    drawText() {},
    drawImage() {},
    clip(_c: ResolvedClip) {},
    compositeMask(_m: MaskMode, c: () => void, m: () => void) {
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
    setOpacity() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    setTransform(_m: Matrix3x3) {},
    getWidth() {
      return 200;
    },
    getHeight() {
      return 200;
    },
  };
}

function pathNode(
  id: string,
  d: string,
  fillRule: FillRule = "nonzero",
): SceneNode {
  const n = createSceneNode(id, "path");
  n.shapeData = { type: "path", commands: parsePath(d) };
  n.fillRule = fillRule;
  n.interactive = true;
  n.base = snapshotNode(n);
  return n;
}

function withParent(child: SceneNode): SceneNode {
  const parent = createSceneNode("root", "group");
  parent.base = snapshotNode(parent);
  child.parent = parent;
  parent.children.push(child);
  return parent;
}

// --- Direct point-in-path geometry (pure math, no Path2D) -------------------

test("path hit-test: point inside a curved bulb outline hits headless", () => {
  const root = withParent(pathNode("bulb", BULB_D));
  // (100,100) is well inside the bulb; (10,10) is far outside its bounds.
  expect(hitTest(root, { x: 100, y: 100 })?.id).toBe("bulb");
  expect(hitTest(root, { x: 10, y: 10 })).toBeNull();
});

// A donut: outer square with an inner square wound the same direction. Under
// nonzero both loops wind together so the hole fills solid; under evenodd the
// inner loop cancels so the hole is empty. The point (50,50) sits in the hole.
const DONUT_D =
  "M 0 0 L 100 0 L 100 100 L 0 100 Z M 25 25 L 75 25 L 75 75 L 25 75 Z";

test("path hit-test: evenodd hole rejects where nonzero fills", () => {
  const hole = { x: 50, y: 50 };
  const evenodd = withParent(pathNode("d", DONUT_D, "evenodd"));
  expect(hitTest(evenodd, hole)).toBeNull(); // hole is empty under even-odd

  const nonzero = withParent(pathNode("d", DONUT_D, "nonzero"));
  // NOTE: both squares wind clockwise, so nonzero fills the hole solid.
  expect(hitTest(nonzero, hole)?.id).toBe("d");

  // A point in the ring (between the squares) is inside under either rule.
  expect(hitTest(evenodd, { x: 10, y: 50 })?.id).toBe("d");
  expect(hitTest(nonzero, { x: 10, y: 50 })?.id).toBe("d");
});

test("path clip: a curved clip region accepts inside and rejects outside", () => {
  // Node paints a big rect but is clipped to the bulb outline. The clip is
  // pure math now, so it gates hits headless.
  const node = createSceneNode("clipped", "rect");
  node.shapeData = { type: "rect", x: 0, y: 0, width: 200, height: 200 };
  node.interactive = true;
  node.clipPath = { type: "path", commands: parsePath(BULB_D) };
  node.base = snapshotNode(node);
  const root = withParent(node);

  expect(hitTest(root, { x: 100, y: 100 })?.id).toBe("clipped"); // inside bulb
  expect(hitTest(root, { x: 10, y: 10 })).toBeNull(); // in rect, outside clip
});

// --- Full-tree click resolution (hitTestClick) ------------------------------

test("hitTestClick: resolves the topmost shape even with no interactive nodes", () => {
  const root = buildSceneGraph(
    parse(`
      :root { width: 200px; height: 200px; }
      #bg  { type: rect; x: 0; y: 0; width: 200px; height: 200px; fill: #111; }
      #dot { type: circle; cx: 100px; cy: 100px; r: 30px; fill: #f00; }
    `),
  );
  // Nothing is interactive, so the legacy hit-tester credits no one...
  expect(hitTest(root, { x: 100, y: 100 })).toBeNull();
  // ...but click resolution still returns the topmost (later-painted) shape.
  const hit = hitTestClick(root, { x: 100, y: 100 });
  expect(hit?.node.id).toBe("dot");
  expect(hit?.path).toEqual(["root", "dot"]);
  // Over only the background rect, the rect itself is the hit.
  expect(hitTestClick(root, { x: 10, y: 10 })?.node.id).toBe("bg");
  // Outside every shape -> null.
  expect(hitTestClick(root, { x: 100, y: 100 })).not.toBeNull();
});

test("hitTestClick: credits the nearest interactive ancestor (cursor:pointer group)", () => {
  const root = buildSceneGraph(
    parse(`
      :root { width: 200px; height: 200px; }
      #btn {
        type: group;
        cursor: pointer;
        > #leaf { type: circle; cx: 100px; cy: 100px; r: 30px; fill: #f00; }
      }
    `),
  );
  const hit = hitTestClick(root, { x: 100, y: 100 });
  // Topmost shape is #leaf, but the click credits the cursor:pointer group.
  expect(hit?.node.id).toBe("btn");
  expect(hit?.path).toEqual(["root", "btn"]);
});

// --- Click-edge event synthesis for a machine-less scene --------------------

test("click edge fires popkorn:click for a machine-less scene", () => {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const prevRaf = g.requestAnimationFrame;
  const prevCancel = g.cancelAnimationFrame;
  const q: ((t: number) => void)[] = [];
  g.requestAnimationFrame = (cb) => q.push(cb);
  g.cancelAnimationFrame = () => {};
  try {
    const root = buildSceneGraph(
      parse(`
        :root { width: 200px; height: 200px; }
        #box { type: rect; x: 50px; y: 50px; width: 100px; height: 100px; fill: #fff; }
      `),
    );
    const loop = new RenderLoop(noopRenderer());
    let clicked: ClickDetail | null = null;
    loop.setClickCallback((d) => {
      clicked = d;
    });
    loop.setScene(root);
    loop.start(); // live frame 0, schedules frame 1

    const cursor = loop.getInputTracker().getState().cursor;
    cursor.x = 100; // inside #box
    cursor.y = 100;
    cursor.isDown = true;
    cursor.pressed = true; // press latched
    cursor.isDown = false; // release before the next frame samples

    q.shift()?.(16); // live frame 1 — down+up edge -> click

    expect(clicked).not.toBeNull();
    expect(clicked!.id).toBe("box");
    expect(clicked!.path).toEqual(["root", "box"]);
    expect(clicked!.x).toBe(100);
    expect(clicked!.y).toBe(100);
    loop.stop();
  } finally {
    g.requestAnimationFrame = prevRaf;
    g.cancelAnimationFrame = prevCancel;
  }
});

// --- End-to-end: RN drive path fires a machine click on a PATH shape --------

// Mirrors "tap between frames fires machine click" but the trigger target is a
// PATH node (the old harness used a circle, which is why this RN bug slipped
// through). Emulates PopkornView onTouch/onTouchEnd: set cursor + pressed latch,
// release, then pump one live frame.
test("machine click() on a PATH-shaped node fires from a device tap", () => {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const prevRaf = g.requestAnimationFrame;
  const prevCancel = g.cancelAnimationFrame;
  const q: ((t: number) => void)[] = [];
  g.requestAnimationFrame = (cb) => q.push(cb);
  g.cancelAnimationFrame = () => {};
  try {
    const root = buildSceneGraph(
      parse(`
        :root { width: 200px; height: 200px; }
        @machine m { initial: off; state off { to: on on click(#bulb); } state on {} }
        #bulb { type: path; d: "${BULB_D}"; fill: #fff; }
      `),
    );
    const loop = new RenderLoop(noopRenderer());
    loop.setScene(root);
    loop.start(); // live frame 0, schedules frame 1

    const cursor = loop.getInputTracker().getState().cursor;
    cursor.x = 100; // inside the bulb outline
    cursor.y = 100;
    cursor.isDown = true;
    cursor.pressed = true; // set by PopkornView.onTouch
    cursor.isDown = false; // onTouchEnd before the next frame samples

    q.shift()?.(16); // live frame 1 — detects the latched tap on the path

    expect(loop.getStateMachineRunner().currentState("m")).toBe("on");
    loop.stop();
  } finally {
    g.requestAnimationFrame = prevRaf;
    g.cancelAnimationFrame = prevCancel;
  }
});
