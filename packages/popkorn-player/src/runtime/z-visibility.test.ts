import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import type { Renderer } from "../renderer/interface";
import type {
  Color,
  GradientData,
  Matrix3x3,
  PathCommand,
  ResolvedClip,
  TrimDescriptor,
} from "../renderer/types";
import { buildSceneGraph } from "../scene/builder";
import type {
  FillRule,
  MaskMode,
  SceneNode,
  StrokeLineCap,
  TextAnchor,
} from "../scene/types";
import { createSceneNode, snapshotNode } from "../scene/types";
import { hitTest } from "./hit-test";
import { RenderLoop } from "./loop";
import { createVariableResolver } from "./variables";

// Build a scene from CSS, wire :root vars into a fresh resolver, and drive it
// through a recording renderer so a test can read paint order + host var toggles.
function loadWithResolver(src: string) {
  const ast = parse(src);
  const resolver = createVariableResolver();
  resolver.setVariables(ast.variables);
  const r = recordingRenderer();
  const loop = new RenderLoop(r, undefined, undefined, resolver);
  const root = buildSceneGraph(ast);
  loop.setScene(root);
  return { loop, r, resolver, root };
}

// Recording renderer: captures the fill colour active at each shape draw, so a
// test can read back the exact paint order of leaf nodes.
function recordingRenderer(): Renderer & { drawn: string[] } {
  let fill: Color | null = null;
  const push = () => {
    if (fill) (r.drawn as string[]).push(String(fill));
  };
  const r: Renderer & { drawn: string[] } = {
    drawn: [],
    clear() {},
    beginFrame() {},
    endFrame() {},
    drawRect() {
      push();
    },
    drawCircle() {
      push();
    },
    drawEllipse() {
      push();
    },
    drawPath(_c: PathCommand[]) {
      push();
    },
    drawText() {},
    drawImage() {},
    clip(_c: ResolvedClip) {},
    compositeMask(_m: MaskMode, c: () => void, m: () => void) {
      c();
      m();
    },
    setFill(c: Color | null) {
      fill = c;
    },
    setFillGradient(_g: GradientData | null) {},
    setStroke(_c: Color | null, _w: number) {},
    setStrokeGradient(_g: GradientData | null) {},
    setStrokeLineCap(_c: StrokeLineCap) {},
    setStrokeLineJoin() {},
    setStrokeMiterLimit() {},
    setTrim(_t: TrimDescriptor | null) {},
    setDash() {},
    setFillRule(_r: FillRule) {},
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
      return 100;
    },
    getHeight() {
      return 100;
    },
  };
  return r;
}

function leaf(id: string, fill: string, z: number, x = 0): SceneNode {
  const n = createSceneNode(id, "rect");
  n.shapeData = { type: "rect", x, y: 0, width: 100, height: 100 };
  n.fill = fill;
  n.zIndex = z;
  n.interactive = true;
  n.base = snapshotNode(n);
  return n;
}

test("z-index: siblings paint in ascending z, document order breaks ties", () => {
  const parent = createSceneNode("p", "group");
  parent.base = snapshotNode(parent);
  // Document order a,b,c,d; z-indexes shuffle them.
  const a = leaf("a", "#a1", 0);
  const b = leaf("b", "#b2", -1);
  const c = leaf("c", "#c3", 0); // ties with a at z=0 -> keep doc order after a
  const d = leaf("d", "#d4", 2);
  for (const n of [a, b, c, d]) {
    n.parent = parent;
    parent.children.push(n);
  }

  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(parent);
  loop.seek(0);

  // ascending z: b(-1), then z=0 ties a,c in doc order, then d(2).
  expect(r.drawn).toEqual(["#b2", "#a1", "#c3", "#d4"]);
});

test("z-index: hit-testing picks the highest-z sibling at a shared point", () => {
  const parent = createSceneNode("p", "group");
  parent.base = snapshotNode(parent);
  const back = leaf("back", "#back", 5); // higher z = on top
  const front = leaf("front", "#front", -3);
  back.parent = parent;
  front.parent = parent;
  parent.children.push(back, front); // doc order would put front on top without z

  // Both cover the point; z-index must decide (back has higher z -> topmost).
  const hit = hitTest(parent, { x: 50, y: 50 });
  expect(hit?.id).toBe("back");
});

test("visibility: node outside [from,until) is skipped by render and hit-test", () => {
  const parent = createSceneNode("p", "group");
  parent.base = snapshotNode(parent);
  const n = leaf("win", "#win", 0);
  n.visibleFrom = 1000; // ms
  n.visibleUntil = 2000;
  n.parent = parent;
  parent.children.push(n);

  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(parent);

  loop.seek(500); // before window
  expect(r.drawn).toEqual([]);
  expect(hitTest(parent, { x: 50, y: 50 })).toBeNull();

  loop.seek(1500); // inside window
  expect(r.drawn).toEqual(["#win"]);
  expect(hitTest(parent, { x: 50, y: 50 })?.id).toBe("win");

  loop.seek(2000); // at `until` is exclusive -> hidden again
  expect(hitTest(parent, { x: 50, y: 50 })).toBeNull();
});

test("visibility interacts with looping: a wrapped time re-reveals the node", () => {
  const parent = createSceneNode("p", "group");
  parent.base = snapshotNode(parent);
  const n = leaf("win", "#win", 0);
  n.visibleFrom = 0;
  n.visibleUntil = 1000; // visible only in the first second of the loop
  // Give the scene a finite duration via an animation on the node so the loop
  // has something to wrap against.
  n.animations = [
    {
      keyframes: [
        { offset: 0, properties: { opacity: 1 } },
        { offset: 1, properties: { opacity: 1 } },
      ],
      delay: 0,
      duration: 3000,
      iterationCount: 1,
      direction: "normal",
      fillMode: "both",
      timingFunction: "linear",
    } as any,
  ];
  n.parent = parent;
  parent.children.push(n);

  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setLoop(true);
  loop.setScene(parent);

  // t = 3500ms wraps to 500ms (< 1000) => visible again after the loop point.
  loop.seek(3500);
  expect(r.drawn).toEqual(["#win"]);
});

test("visibility is evaluated in the node’s incoming (pre-time-offset) scope", () => {
  // A layer's visibility lives in its parent comp's timeline, so time-offset on
  // the SAME node must not shift its own window.
  const parent = createSceneNode("p", "group");
  parent.base = snapshotNode(parent);
  const n = leaf("win", "#win", 0);
  n.visibleFrom = 500;
  n.visibleUntil = 1500;
  n.timeOffset = 500; // scopes its CONTENT only, not its own visibility
  n.parent = parent;
  parent.children.push(n);

  const r = recordingRenderer();
  const loop = new RenderLoop(r);
  loop.setScene(parent);

  loop.seek(1000); // within [500,1500) regardless of timeOffset
  expect(r.drawn).toEqual(["#win"]);
});

// --- display (Feature A) ----------------------------------------------------

test("display: none statically removes the node and its subtree from render + hit-test", () => {
  const { loop, r, root } = loadWithResolver(
    `#g { display: none; cursor: pointer;
       > #child { type: rect; width: 100; height: 100; fill: #cc0000; cursor: pointer; }
     }
     #vis { type: rect; width: 100; height: 100; fill: #00cc00; cursor: pointer; }`,
  );
  loop.seek(0);
  // #g (group) and its #child paint nothing; only the visible sibling draws.
  expect(r.drawn).toEqual(["#00cc00"]);
  // Neither the hidden group nor its child can be hit; the sibling wins.
  expect(hitTest(root, { x: 50, y: 50 })?.id).toBe("vis");
});

test("display: var() toggles a node in and out of render AND hit-test per frame", () => {
  const { loop, r, resolver, root } = loadWithResolver(
    `:root { --alive: 1; }
     #e { type: rect; width: 100; height: 100; fill: #e00000; display: var(--alive); cursor: pointer; }`,
  );
  loop.seek(0);
  expect(r.drawn).toEqual(["#e00000"]);
  expect(hitTest(root, { x: 50, y: 50 })?.id).toBe("e");

  r.drawn.length = 0;
  resolver.setVariable("alive", 0); // 0 => none: gone from both walks this frame
  loop.seek(0);
  expect(r.drawn).toEqual([]);
  expect(hitTest(root, { x: 50, y: 50 })).toBeNull();

  r.drawn.length = 0;
  resolver.setVariable("alive", 1); // non-zero => visible again
  loop.seek(0);
  expect(r.drawn).toEqual(["#e00000"]);
  expect(hitTest(root, { x: 50, y: 50 })?.id).toBe("e");
});

// --- bindable / animatable z-index (Feature B) ------------------------------

test("z-index: a per-frame var change reorders paint and the reversed hit order", () => {
  const { loop, r, resolver, root } = loadWithResolver(
    `#back { type: rect; width: 100; height: 100; fill: #0000bb; cursor: pointer; z-index: var(--zback); }
     #front { type: rect; width: 100; height: 100; fill: #00bb00; cursor: pointer; }`,
  );
  resolver.setVariable("zback", 0);
  loop.seek(0);
  // Both at z 0: document order back, front — front paints last (on top).
  expect(r.drawn).toEqual(["#0000bb", "#00bb00"]);
  expect(hitTest(root, { x: 50, y: 50 })?.id).toBe("front");

  r.drawn.length = 0;
  resolver.setVariable("zback", 5); // lift #back above #front this frame
  loop.seek(0);
  expect(r.drawn).toEqual(["#00bb00", "#0000bb"]); // #back now paints last
  expect(hitTest(root, { x: 50, y: 50 })?.id).toBe("back"); // and wins the hit
});

test("z-index: a static scene keeps its authored order across frames", () => {
  const { loop, r } = loadWithResolver(
    `#a { type: rect; width: 100; height: 100; fill: #aa0000; z-index: 2; }
     #b { type: rect; width: 100; height: 100; fill: #00aa00; z-index: 1; }`,
  );
  loop.seek(0);
  expect(r.drawn).toEqual(["#00aa00", "#aa0000"]); // ascending z: b(1) then a(2)
  r.drawn.length = 0;
  loop.seek(100);
  expect(r.drawn).toEqual(["#00aa00", "#aa0000"]); // unchanged
});

test("z-index animates as a rounded integer, reordering across the timeline", () => {
  const { loop, r, root } = loadWithResolver(
    `@keyframes lift { from { z-index: 0; } to { z-index: 4; } }
     #a { type: rect; width: 100; height: 100; fill: #aa0000; animation: lift 1000ms linear; }
     #b { type: rect; width: 100; height: 100; fill: #00aa00; z-index: 2; }`,
  );
  loop.seek(0); // a z=0 < b z=2 => a behind b
  expect(r.drawn).toEqual(["#aa0000", "#00aa00"]);

  // Mid-tween the sampled real value is rounded to an integer (CSS <integer>).
  loop.seek(625); // 0..4 linear => 2.5 => rounds to 3
  const a = root.children.find((c) => c.id === "a")!;
  expect(a.zIndex).toBe(3);

  r.drawn.length = 0;
  loop.seek(1000); // a z=4 > b z=2 => a on top
  expect(r.drawn).toEqual(["#00aa00", "#aa0000"]);
});
