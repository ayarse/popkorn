import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import { interpolateKeyframes } from "./animation/keyframes";
import { AnimationScheduler } from "./animation/scheduler";
import { transformPoint } from "./renderer/types";
import { hitTest } from "./runtime/hit-test";
import { buildSceneGraph } from "./scene/builder";
import { buildMotionPath, parsePath, samplePathAt } from "./scene/path-parser";
import { computeLocalMatrix } from "./scene/transform";
import type {
  AnimationInstance,
  CircleData,
  KeyframeData,
  SceneNode,
} from "./scene/types";
import { createSceneNode, resetNodeToBase, snapshotNode } from "./scene/types";

// --- helpers -----------------------------------------------------------------

const build = (src: string) => buildSceneGraph(parse(src));
const cx = (n: SceneNode) => (n.shapeData as CircleData).cx;
const r = (n: SceneNode) => (n.shapeData as CircleData).r;

function circleNode(): SceneNode {
  const n = createSceneNode("c", "circle");
  n.shapeData = { type: "circle", cx: 0, cy: 0, r: 0 };
  n.fill = "rgb(0, 0, 0)";
  n.base = snapshotNode(n);
  return n;
}

function makeAnim(partial: Partial<AnimationInstance>): AnimationInstance {
  return {
    name: "a",
    duration: 100,
    timingFunction: "linear",
    iterationCount: 1,
    direction: "normal",
    delay: 0,
    fillMode: "forwards",
    keyframes: [],
    ...partial,
  };
}

// --- (1) hold / step-end keyframes -------------------------------------------

test("step-end: holds the departing value across the segment, then jumps (number + color)", () => {
  const node = circleNode();
  const kf: KeyframeData[] = [
    {
      offset: 0,
      properties: { r: 0, fill: "rgb(0, 0, 0)" },
      easing: "step-end",
    },
    { offset: 1, properties: { r: 100, fill: "rgb(100, 0, 0)" } },
  ];

  // Anywhere inside the segment holds the first keyframe's value.
  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.5);
  expect(r(node)).toBe(0);
  expect(node.fill).toBe("rgb(0, 0, 0)");

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.99);
  expect(r(node)).toBe(0);
  expect(node.fill).toBe("rgb(0, 0, 0)");

  // At the next keyframe it jumps.
  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 1);
  expect(r(node)).toBe(100);
  expect(node.fill).toBe("rgb(100, 0, 0)");
});

test("skewX/skewY animate as number channels and land on the transform", () => {
  const node = circleNode();
  const kf: KeyframeData[] = [
    { offset: 0, properties: { skewX: 0, skewY: 0 } },
    { offset: 1, properties: { skewX: 30, skewY: -10 } },
  ];

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.5);
  expect(node.transform.skewX).toBeCloseTo(15, 6);
  expect(node.transform.skewY).toBeCloseTo(-5, 6);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 1);
  expect(node.transform.skewX).toBeCloseTo(30, 6);
  expect(node.transform.skewY).toBeCloseTo(-10, 6);
});

test("skew() shorthand in @keyframes drives skewX and skewY channels", () => {
  const scene = build(
    "@keyframes s { from { transform: skew(0deg, 0deg); } to { transform: skew(40deg, 20deg); } }" +
      "#r { type: rect; width: 10px; height: 10px; animation: s 1s; }",
  );
  const node = scene.children[0];
  resetNodeToBase(node);
  interpolateKeyframes(node, node.animations[0].keyframes, 0.5);
  expect(node.transform.skewX).toBeCloseTo(20, 6);
  expect(node.transform.skewY).toBeCloseTo(10, 6);
});

test("step-end parses from the animation shorthand and per-keyframe", () => {
  const root = build(`
    @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; animation-timing-function: step-end; } 100% { opacity: 1; } }
    #a { type: circle; r: 10px; animation: blink 1s step-end infinite; }
  `);
  const node = root.children[0];
  expect(node.animations[0].timingFunction).toBe("step-end");
  // The 50% keyframe's step-end easing.
  const mid = node.animations[0].keyframes.find((k) => k.offset === 0.5)!;
  expect(mid.easing).toBe("step-end");
});

// --- (2) arc-length sampler --------------------------------------------------

test("sampler: straight line is exact for point and tangent", () => {
  const mp = buildMotionPath(parsePath("M 0 0 L 100 0"));
  expect(mp.length).toBeCloseTo(100, 6);
  const s = samplePathAt(mp, 0.25);
  expect(s.x).toBeCloseTo(25, 6);
  expect(s.y).toBeCloseTo(0, 6);
  expect(s.angle).toBeCloseTo(0, 6);

  // Vertical line -> tangent points down (+y), angle = PI/2.
  const v = samplePathAt(buildMotionPath(parsePath("M 0 0 L 0 100")), 0.5);
  expect(v.angle).toBeCloseTo(Math.PI / 2, 6);
});

test("sampler: quarter circle within tolerance", () => {
  // Quarter arc, radius 100, centre (0,0), from (100,0) to (0,100).
  const mp = buildMotionPath(parsePath("M 100 0 A 100 100 0 0 1 0 100"));
  expect(mp.length).toBeCloseTo((Math.PI / 2) * 100, 0); // ~157, chord-flattened
  const mid = samplePathAt(mp, 0.5);
  expect(mid.x).toBeCloseTo(Math.SQRT1_2 * 100, 0); // ~70.7
  expect(mid.y).toBeCloseTo(Math.SQRT1_2 * 100, 0);
});

// --- (3) offset-distance drives the local matrix -----------------------------

test("offset-distance animates via the registry and moves the local matrix", () => {
  const node = createSceneNode("n", "rect");
  node.shapeData = {
    type: "rect",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rx: 0,
    ry: 0,
  };
  node.offsetPath = buildMotionPath(parsePath("M 0 0 L 100 0"));
  node.base = snapshotNode(node);

  const kf: KeyframeData[] = [
    { offset: 0, properties: { "offset-distance": 0 } },
    { offset: 1, properties: { "offset-distance": 1 } },
  ];
  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.5);
  expect(node.offsetDistance).toBeCloseTo(0.5, 6);

  // Local matrix places the node's origin 50px along the path.
  const p = transformPoint(computeLocalMatrix(node), 0, 0);
  expect(p.x).toBeCloseTo(50, 6);
  expect(p.y).toBeCloseTo(0, 6);
});

test("offset-rotate auto applies the path tangent to the local matrix", () => {
  const node = createSceneNode("n", "rect");
  node.shapeData = {
    type: "rect",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rx: 0,
    ry: 0,
  };
  node.offsetPath = buildMotionPath(parsePath("M 0 0 L 0 100")); // vertical, tangent PI/2
  node.offsetDistance = 0.5;
  node.offsetRotate = { auto: true, angle: 0 };

  const m = computeLocalMatrix(node);
  // Rotation by PI/2: [cos, -sin] = [0, -1]; translation is the path point (0,50).
  expect(m[0]).toBeCloseTo(0, 6);
  expect(m[1]).toBeCloseTo(-1, 6);
  expect(m[2]).toBeCloseTo(0, 6);
  expect(m[5]).toBeCloseTo(50, 6);
});

test("offset-distance 0 places the node at the path START, not identity", () => {
  const node = createSceneNode("n", "rect");
  node.shapeData = {
    type: "rect",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rx: 0,
    ry: 0,
  };
  node.offsetPath = buildMotionPath(parsePath("M 40 40 L 100 40"));
  // Per CSS, offset-distance:0 sits the node at the path's first point (40,40) —
  // not at the identity offset. (A node holding its first keyframe before its
  // offset-distance animation begins must show there, not collapse to origin.)
  const p = transformPoint(computeLocalMatrix(node), 0, 0);
  expect(p.x).toBeCloseTo(40, 6);
  expect(p.y).toBeCloseTo(40, 6);
});

test("no offset-path leaves the node at its authored position", () => {
  const node = createSceneNode("n", "rect");
  node.shapeData = {
    type: "rect",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rx: 0,
    ry: 0,
  };
  // No motion path -> the sampled placement is skipped entirely (identity).
  const p = transformPoint(computeLocalMatrix(node), 0, 0);
  expect(p.x).toBeCloseTo(0, 6);
  expect(p.y).toBeCloseTo(0, 6);
});

// --- (4) hit-test shares the motion-path matrix ------------------------------

test("hit-test agrees with the render matrix for a node mid-path", () => {
  const root = createSceneNode("root", "group");
  const rect = createSceneNode("r", "rect");
  rect.shapeData = {
    type: "rect",
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rx: 0,
    ry: 0,
  };
  rect.offsetPath = buildMotionPath(parsePath("M 0 0 L 100 0"));
  rect.offsetDistance = 0.5; // placed at x+50, no rotation (tangent angle 0)
  rect.interactive = true; // hit-test only records interactive nodes
  rect.parent = root;
  root.children.push(rect);

  // The offset moved the box to world x [50,70]; a point there hits it.
  expect(hitTest(root, { x: 60, y: 10 })).toBe(rect);
  // The authored position (x [0,20]) is now empty.
  expect(hitTest(root, { x: 10, y: 10 })).toBe(null);
});

// --- (5) negative animation-delay --------------------------------------------

test("negative delay: value at t=0 equals a zero-delay animation at t=|delay|", () => {
  const kf: KeyframeData[] = [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ];
  const sched = new AnimationScheduler();

  const a = circleNode();
  a.animations = [
    makeAnim({
      delay: -450,
      duration: 100,
      iterationCount: Infinity,
      keyframes: kf,
    }),
  ];
  resetNodeToBase(a);
  sched.sampleNode(a, 0);

  const b = circleNode();
  b.animations = [
    makeAnim({
      delay: 0,
      duration: 100,
      iterationCount: Infinity,
      keyframes: kf,
    }),
  ];
  resetNodeToBase(b);
  sched.sampleNode(b, 450);

  expect(r(a)).toBeCloseTo(r(b), 6);
  expect(r(a)).toBeCloseTo(50, 6); // 450 % 100 = 50
});

test("negative delay: iteration accounting includes the skipped part (alternate)", () => {
  const kf: KeyframeData[] = [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ];
  const node = circleNode();
  // local = 0 - (-125) = 125 -> iteration 1 (odd) -> alternate reverses.
  node.animations = [
    makeAnim({
      delay: -125,
      duration: 100,
      iterationCount: Infinity,
      direction: "alternate",
      keyframes: kf,
    }),
  ];
  resetNodeToBase(node);
  new AnimationScheduler().sampleNode(node, 0);
  // Odd iteration reverses progress 0.25 -> 0.75 -> r = 75. A naive "restart at
  // t=0" would land in iteration 0 (r = 25), so 75 proves the skip is counted.
  expect(r(node)).toBeCloseTo(75, 6);
});

test("negative delay: backwards fill never shows (animation already active at t=0)", () => {
  const node = circleNode();
  (node.shapeData as CircleData).r = 999; // base distinct from the first keyframe
  node.base = snapshotNode(node);
  node.animations = [
    makeAnim({
      delay: -50,
      duration: 100,
      fillMode: "backwards",
      keyframes: [
        { offset: 0, properties: { r: 0 } },
        { offset: 1, properties: { r: 100 } },
      ],
    }),
  ];
  resetNodeToBase(node);
  new AnimationScheduler().sampleNode(node, 0);
  expect(r(node)).toBeCloseTo(50, 6); // active value, not first-keyframe 0 or base 999
});

// --- (6) offset-path parses end-to-end ---------------------------------------

test("builder: offset-path / offset-distance / offset-rotate parse onto the node", () => {
  const root = build(`
    #plane {
      type: rect; width: 20px; height: 20px;
      offset-path: path('M 0 0 L 100 0');
      offset-distance: 25%;
      offset-rotate: auto 90deg;
    }
  `);
  const node = root.children[0];
  expect(node.offsetPath).not.toBeNull();
  expect(node.offsetPath!.length).toBeCloseTo(100, 6);
  expect(node.offsetDistance).toBeCloseTo(0.25, 6);
  expect(node.offsetRotate).toEqual({ auto: true, angle: 90 });
  // Base captured the authored distance so per-frame reset restores it.
  expect(node.base.offsetDistance).toBeCloseTo(0.25, 6);
  void cx;
});
