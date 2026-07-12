import { expect, test } from "bun:test";
import type { CircleData, KeyframeData, SceneNode } from "../scene/types";
import { createSceneNode, resetNodeToBase, snapshotNode } from "../scene/types";
import { interpolateKeyframes } from "./keyframes";

function circleNode(): SceneNode {
  const n = createSceneNode("c", "circle");
  n.shapeData = { type: "circle", cx: 0, cy: 0, r: 10 };
  n.base = snapshotNode(n);
  return n;
}

const r = (n: SceneNode) => (n.shapeData as CircleData).r;

test("implicit keyframes: single mid-timeline keyframe synthesizes 0%/100% from base", () => {
  const node = circleNode(); // base r = 10
  const kf: KeyframeData[] = [{ offset: 0.5, properties: { r: 50 } }];

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
  const kf: KeyframeData[] = [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ];

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 0);
  expect(r(node)).toBe(0);

  resetNodeToBase(node);
  interpolateKeyframes(node, kf, 1);
  expect(r(node)).toBe(100);
});
