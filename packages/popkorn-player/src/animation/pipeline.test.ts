import { expect, test } from "bun:test";
import { applyInteractionOverrides } from "../runtime/interaction";
import type {
  AnimationInstance,
  CircleData,
  KeyframeData,
  SceneNode,
} from "../scene/types";
import { createSceneNode, resetNodeToBase, snapshotNode } from "../scene/types";
import { interpolateKeyframes } from "./keyframes";
import { AnimationScheduler } from "./scheduler";

// --- helpers -----------------------------------------------------------------

function circleNode(): SceneNode {
  const n = createSceneNode("c", "circle");
  n.shapeData = { type: "circle", cx: 0, cy: 0, r: 10 };
  n.fill = "#000000";
  n.strokeWidth = 1;
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

const cx = (n: SceneNode) => (n.shapeData as CircleData).cx;
const r = (n: SceneNode) => (n.shapeData as CircleData).r;

// --- (1) registry-driven interpolation ---------------------------------------

test("registry: geometry + stroke-width lerp, color lerp for fill", () => {
  const node = circleNode();
  const kf: KeyframeData[] = [
    {
      offset: 0,
      properties: { r: 10, "stroke-width": 2, fill: "rgb(0, 0, 0)" },
    },
    {
      offset: 1,
      properties: { r: 20, "stroke-width": 6, cx: 100, fill: "rgb(100, 0, 0)" },
    },
  ];

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.5); // linear, no easing

  expect(r(node)).toBe(15); // number geometry
  expect(node.strokeWidth).toBe(4); // stroke-width
  expect(cx(node)).toBe(50); // cx present only at end -> lerps from base cx (0)
  expect(node.fill).toBe("rgb(50, 0, 0)"); // color lerp
});

test("registry: property absent from a keyframe falls back to the node base", () => {
  const node = circleNode(); // base r = 10
  const kf: KeyframeData[] = [
    { offset: 0, properties: {} }, // r absent -> base 10
    { offset: 1, properties: { r: 30 } }, // r = 30
  ];
  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.5);
  expect(r(node)).toBe(20); // (10 + 30) / 2
});

// --- (2) determinism / seek --------------------------------------------------

test("determinism: sampling at the same time twice is identical", () => {
  const node = circleNode();
  const anim = makeAnim({
    duration: 100,
    keyframes: [
      { offset: 0, properties: { r: 0 } },
      { offset: 1, properties: { r: 100 } },
    ],
  });
  node.animations = [anim];
  const sched = new AnimationScheduler();

  resetNodeToBase(node);
  sched.sampleNode(node, 37);
  const a = r(node);

  resetNodeToBase(node);
  sched.sampleNode(node, 37);
  const b = r(node);

  expect(a).toBe(b);
  expect(a).toBe(37);
});

test("seek: timeline maps deterministically and matches direct sampling", () => {
  const sched = new AnimationScheduler();
  sched.start(1000);
  expect(sched.time(1375)).toBe(375); // 375ms into a timeline started at now=1000

  // Seek to 375 while "now" is arbitrary -> time reads back 375.
  sched.seek(375, 5000);
  expect(sched.time(5000)).toBe(375);

  const node = circleNode();
  node.animations = [
    makeAnim({
      duration: 100,
      iterationCount: Infinity,
      keyframes: [
        { offset: 0, properties: { r: 0 } },
        { offset: 1, properties: { r: 100 } },
      ],
    }),
  ];

  // Sampling at the seeked time equals sampling at the raw time.
  resetNodeToBase(node);
  sched.sampleNode(node, sched.time(5000));
  const seeked = r(node);
  resetNodeToBase(node);
  sched.sampleNode(node, 375);
  const stepped = r(node);
  expect(seeked).toBe(stepped);
  expect(seeked).toBe(75); // 375 % 100 = 75
});

// --- (3) pipeline ordering: hover composes over a running animation ----------

test("ordering: hover delta composes on animated values, no drift after hover", () => {
  const node = circleNode();
  node.animations = [
    makeAnim({
      duration: 100,
      iterationCount: Infinity,
      keyframes: [
        { offset: 0, properties: { translateX: 0 } },
        { offset: 1, properties: { translateX: 100 } },
      ],
    }),
  ];
  node.hoverStyles = { transform: { translateX: 50 } }; // additive delta
  const sched = new AnimationScheduler();

  // Frame with hover active: base -> (no bindings) -> animation -> interaction.
  resetNodeToBase(node);
  sched.sampleNode(node, 40); // animated translateX = 40
  node.interactionState = "hover";
  applyInteractionOverrides(node);
  expect(node.transform.translateX).toBe(90); // 40 + 50

  // Next frame, hover ended: back to purely animated value, no accumulation.
  resetNodeToBase(node);
  sched.sampleNode(node, 40);
  node.interactionState = "normal";
  applyInteractionOverrides(node);
  expect(node.transform.translateX).toBe(40);
});

// --- (4) animation-fill-mode -------------------------------------------------

test("fill-mode forwards: holds final values after the animation ends", () => {
  const node = circleNode();
  node.animations = [
    makeAnim({
      fillMode: "forwards",
      keyframes: [
        { offset: 0, properties: { r: 0 } },
        { offset: 1, properties: { r: 100 } },
      ],
    }),
  ];
  const sched = new AnimationScheduler();

  resetNodeToBase(node);
  sched.sampleNode(node, 500); // well past duration 100
  expect(r(node)).toBe(100);
});

test("fill-mode none: reverts to base outside the active interval", () => {
  const node = circleNode(); // base r = 10
  node.animations = [
    makeAnim({
      fillMode: "none",
      keyframes: [
        { offset: 0, properties: { r: 0 } },
        { offset: 1, properties: { r: 100 } },
      ],
    }),
  ];
  const sched = new AnimationScheduler();

  resetNodeToBase(node);
  sched.sampleNode(node, 500); // after end, none -> untouched -> base
  expect(r(node)).toBe(10);
});

test("fill-mode backwards: applies the first keyframe during the delay", () => {
  const node = circleNode();
  (node.shapeData as CircleData).r = 999; // base distinct from first keyframe
  node.base = snapshotNode(node);
  node.animations = [
    makeAnim({
      delay: 100,
      fillMode: "backwards",
      keyframes: [
        { offset: 0, properties: { r: 0 } },
        { offset: 1, properties: { r: 100 } },
      ],
    }),
  ];
  const sched = new AnimationScheduler();

  resetNodeToBase(node);
  sched.sampleNode(node, 50); // still within the delay
  expect(r(node)).toBe(0); // first-keyframe value, not base 999
});
