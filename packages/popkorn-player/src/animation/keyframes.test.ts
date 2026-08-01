import { expect, test } from "bun:test";
import type { CircleData, SceneNode } from "../scene/types";
import { createSceneNode, resetNodeToBase, snapshotNode } from "../scene/types";
import { buildKeyframeTracks, interpolateKeyframes } from "./keyframes";

function circleNode(): SceneNode {
  const n = createSceneNode("c", "circle");
  n.shapeData = { type: "circle", cx: 0, cy: 0, r: 10 };
  n.opacity = 1;
  n.base = snapshotNode(n);
  return n;
}

const r = (n: SceneNode) => (n.shapeData as CircleData).r;

test("implicit keyframes: single mid-timeline keyframe synthesizes 0%/100% from base", () => {
  const node = circleNode(); // base r = 10
  const kf = buildKeyframeTracks([{ offset: 0.5, properties: { r: 50 } }]);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0);
  expect(r(node)).toBe(10); // at t=0, synthesized start keyframe == base

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.25);
  expect(r(node)).toBe(30); // halfway between base (10) and keyframe (50), linear default

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.5);
  expect(r(node)).toBe(50); // exactly the authored keyframe

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 1);
  expect(r(node)).toBe(10); // back to base at the synthesized end keyframe
});

test("implicit keyframes: authored 0%/100% keyframes are unaffected at the edges", () => {
  const node = circleNode();
  const kf = buildKeyframeTracks([
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ]);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0);
  expect(r(node)).toBe(0);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 1);
  expect(r(node)).toBe(100);
});

test("sparse property interpolates across the keyframes that omit it", () => {
  const node = circleNode(); // base r = 10
  // `r` is keyed at 0% and 100% only; `opacity` at every keyframe. Per CSS, the
  // 50% keyframe is not part of the `r` track, so `r` runs 10 -> 50 unbroken.
  const kf = buildKeyframeTracks([
    { offset: 0, properties: { opacity: 0, r: 10 } },
    { offset: 0.5, properties: { opacity: 1 } },
    { offset: 1, properties: { opacity: 0, r: 50 } },
  ]);

  for (const [progress, expected] of [
    [0, 10],
    [0.25, 20],
    [0.5, 30],
    [0.75, 40],
    [1, 50],
  ] as const) {
    resetNodeToBase(node);
    interpolateKeyframes(node, kf, progress);
    expect(r(node)).toBeCloseTo(expected, 6);
  }

  // The dense property still samples off its own (identical) keyframes.
  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.25);
  expect(node.opacity).toBeCloseTo(0.5, 6);
});

test("per-keyframe easing follows the property's own track", () => {
  const node = circleNode();
  // The 50% keyframe declares only `opacity`, so its step-end belongs to the
  // opacity track alone; `r` keeps interpolating linearly through it.
  const kf = buildKeyframeTracks([
    { offset: 0, properties: { opacity: 0, r: 0 } },
    { offset: 0.5, properties: { opacity: 0.5 }, easing: "step-end" },
    { offset: 1, properties: { opacity: 1, r: 100 } },
  ]);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.75, "linear");
  expect(node.opacity).toBe(0.5); // held by the opacity track's step-end
  expect(r(node)).toBeCloseTo(75, 6); // unaffected: not on that track
});

test("step-end holds across a keyframe that omits the held property", () => {
  const node = circleNode();
  const kf = buildKeyframeTracks([
    { offset: 0, properties: { r: 0 }, easing: "step-end" },
    { offset: 0.5, properties: { opacity: 0.5 } },
    { offset: 1, properties: { r: 100 } },
  ]);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.75, "linear");
  expect(r(node)).toBe(0); // the r track's own departing stop holds to 100%

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 1);
  expect(r(node)).toBe(100);
});

test("additive composition: a sparse track adds across omissions, edges add 0", () => {
  const node = circleNode(); // base r = 10
  const kf = buildKeyframeTracks([
    { offset: 0, properties: { opacity: 1, r: 0 } },
    { offset: 0.5, properties: { opacity: 0.5 } },
    { offset: 1, properties: { opacity: 1, r: 40 } },
  ]);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0.5, "linear", "add");
  expect(r(node)).toBeCloseTo(30, 6); // base 10 + 20, not 10 + base

  // A track that starts past 0 synthesizes the additive identity, not base:
  // nothing is added at the timeline edge.
  const late = buildKeyframeTracks([{ offset: 0.5, properties: { r: 40 } }]);
  resetNodeToBase(node);
  interpolateKeyframes(node, late, 0, "linear", "add");
  expect(r(node)).toBe(10);

  resetNodeToBase(node);
  interpolateKeyframes(node, late, 0.25, "linear", "add");
  expect(r(node)).toBeCloseTo(30, 6); // base 10 + half of 40
});
