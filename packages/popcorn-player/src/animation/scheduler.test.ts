import { test, expect } from 'bun:test';
import type { AnimationInstance, SceneNode, KeyframeData, CircleData } from '../scene/types';
import { createSceneNode, snapshotNode, resetNodeToBase } from '../scene/types';
import {
  AnimationScheduler,
  animationsEndTime,
  sampleInstanceAtProgress,
  sampleNodeAtProgress,
} from './scheduler';

// --- helpers -----------------------------------------------------------------

function makeAnim(partial: Partial<AnimationInstance>): AnimationInstance {
  return {
    name: 'a',
    duration: 100,
    timingFunction: 'linear',
    iterationCount: 1,
    direction: 'normal',
    delay: 0,
    fillMode: 'forwards',
    composition: 'replace',
    keyframes: [],
    ...partial,
  };
}

function circleNode(): SceneNode {
  const n = createSceneNode('c', 'circle');
  n.shapeData = { type: 'circle', cx: 0, cy: 0, r: 10 };
  n.fill = '#000000';
  n.strokeWidth = 1;
  n.base = snapshotNode(n);
  return n;
}

const r = (n: SceneNode) => (n.shapeData as CircleData).r;

// --- (1) animationsEndTime ---------------------------------------------------

test('endTime: single finite instance = delay + duration * iterations', () => {
  expect(animationsEndTime([makeAnim({ duration: 200, iterationCount: 3, delay: 50 })])).toBe(650);
});

test('endTime: multi-instance takes the latest end', () => {
  const insts = [
    makeAnim({ duration: 100, iterationCount: 1 }),          // 100
    makeAnim({ duration: 200, iterationCount: 2, delay: 30 }), // 430
    makeAnim({ duration: 500, iterationCount: 1 }),          // 500
  ];
  expect(animationsEndTime(insts)).toBe(500);
});

test('endTime: any infinite instance => Infinity', () => {
  const insts = [
    makeAnim({ duration: 100, iterationCount: 1 }),
    makeAnim({ duration: 100, iterationCount: Infinity }),
  ];
  expect(animationsEndTime(insts)).toBe(Infinity);
});

test('endTime: empty list => Infinity (a state with no animations never completes)', () => {
  expect(animationsEndTime([])).toBe(Infinity);
});

// --- (2) entry-time anchoring: sampleNode(node, t - entryTime) ----------------

test('anchoring: sampling at t-entryTime equals sampling a state that began at 0', () => {
  const kf: KeyframeData[] = [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ];
  const anchored = circleNode();
  anchored.animations = [makeAnim({ duration: 100, keyframes: kf })];
  const fresh = circleNode();
  fresh.animations = [makeAnim({ duration: 100, keyframes: kf })];
  const sched = new AnimationScheduler();

  const entryTime = 1000;
  const localTime = 1040; // 40ms into the state

  resetNodeToBase(anchored);
  sched.sampleNode(anchored, localTime - entryTime); // = 40
  resetNodeToBase(fresh);
  sched.sampleNode(fresh, 40);

  expect(r(anchored)).toBe(r(fresh));
  expect(r(anchored)).toBe(40);
});

test('anchoring: before entry (negative shifted time), none/forwards => base', () => {
  const node = circleNode(); // base r = 10
  node.animations = [makeAnim({ fillMode: 'none', keyframes: [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ] })];
  const sched = new AnimationScheduler();

  const entryTime = 1000;
  resetNodeToBase(node);
  sched.sampleNode(node, 500 - entryTime); // -500: state not yet entered
  expect(r(node)).toBe(10); // untouched -> base
});

test('anchoring: before entry (negative shifted time), backwards fill => first keyframe', () => {
  const node = circleNode(); // base r = 10, distinct from first keyframe
  node.animations = [makeAnim({ fillMode: 'backwards', keyframes: [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ] })];
  const sched = new AnimationScheduler();

  const entryTime = 1000;
  resetNodeToBase(node);
  sched.sampleNode(node, 500 - entryTime); // -500: before entry
  expect(r(node)).toBe(0); // holds first-keyframe value, not base 10
});

// --- (3) progress sampling (animation-timeline) ------------------------------

test('progress: 0 / 0.5 / 1 map across one iteration', () => {
  const anim = makeAnim({ duration: 100, keyframes: [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ] });

  const at = (p: number) => {
    const n = circleNode();
    resetNodeToBase(n);
    sampleInstanceAtProgress(n, anim, p);
    return r(n);
  };

  expect(at(0)).toBe(0);
  expect(at(0.5)).toBe(50);
  expect(at(1)).toBe(100);
});

test('progress: clamps out-of-range values to [0,1]', () => {
  const anim = makeAnim({ duration: 100, keyframes: [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ] });

  const at = (p: number) => {
    const n = circleNode();
    resetNodeToBase(n);
    sampleInstanceAtProgress(n, anim, p);
    return r(n);
  };

  expect(at(-2)).toBe(0);   // clamps low
  expect(at(3)).toBe(100);  // clamps high
});

test('progress: delay and iterationCount are ignored (progress is the playhead)', () => {
  // A 5000ms delay and 10 iterations would matter on the clock; under progress
  // they are irrelevant — 0.25 maps to a quarter of ONE iteration.
  const anim = makeAnim({ duration: 100, delay: 5000, iterationCount: 10, keyframes: [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ] });
  const n = circleNode();
  resetNodeToBase(n);
  sampleInstanceAtProgress(n, anim, 0.25);
  expect(r(n)).toBe(25);
});

test('progress: direction reverse mirrors progress', () => {
  const anim = makeAnim({ duration: 100, direction: 'reverse', keyframes: [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ] });
  const n = circleNode();
  resetNodeToBase(n);
  sampleInstanceAtProgress(n, anim, 0.25);
  expect(r(n)).toBe(75); // 1 - 0.25
});

test('progress: sampleNodeAtProgress scrubs every animation on the node', () => {
  const n = circleNode();
  n.animations = [makeAnim({ duration: 100, keyframes: [
    { offset: 0, properties: { r: 0 } },
    { offset: 1, properties: { r: 100 } },
  ] })];
  resetNodeToBase(n);
  sampleNodeAtProgress(n, 0.5);
  expect(r(n)).toBe(50);
});
