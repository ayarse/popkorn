import { test, expect } from 'bun:test';
import type { AnimationInstance, SceneNode } from '../scene/types';
import { createSceneNode } from '../scene/types';
import { computeSceneDuration } from './scheduler';

function anim(partial: Partial<AnimationInstance>): AnimationInstance {
  return {
    name: 'a',
    duration: 1000,
    timingFunction: 'linear',
    iterationCount: 1,
    direction: 'normal',
    delay: 0,
    fillMode: 'forwards',
    keyframes: [],
    ...partial,
  };
}

function node(id: string, animations: AnimationInstance[] = []): SceneNode {
  const n = createSceneNode(id, 'group');
  n.animations = animations;
  return n;
}

test('sceneDuration: finite = max(delay + duration × iterations)', () => {
  const root = node('root');
  const a = node('a', [anim({ duration: 1000, iterationCount: 2, delay: 500 })]); // 2500
  const b = node('b', [anim({ duration: 800, iterationCount: 1 })]);             // 800
  root.children.push(a, b);
  expect(computeSceneDuration(root)).toBe(2500);
});

test('sceneDuration: infinite iterations count as ONE iteration', () => {
  const root = node('root');
  root.children.push(node('spin', [anim({ duration: 3000, iterationCount: Infinity })]));
  expect(computeSceneDuration(root)).toBe(3000);
});

test('sceneDuration: no animations => 0', () => {
  const root = node('root');
  root.children.push(node('a'), node('b'));
  expect(computeSceneDuration(root)).toBe(0);
});
