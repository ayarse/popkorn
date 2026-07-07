import { test, expect } from 'bun:test';
import { parse } from '@popcorn/parser';
import { buildSceneGraph } from './scene/builder';
import { AnimationScheduler } from './animation/scheduler';
import { resetNodeToBase } from './scene/types';
import type { SceneNode } from './scene/types';

// A comma-separated `animation` shorthand must build one AnimationInstance per
// group, each with its own keyframes/timing. This is the converter's per-channel
// emission target: transform channels with differing keyframe times/easing land
// as independent animations that layer without clobbering.

function findNode(root: SceneNode, id: string): SceneNode {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return undefined as unknown as SceneNode;
}

const SRC = `
:canvas { width: 100px; height: 100px; }

/* translate holds at its start value until 100% (step-end) */
@keyframes slide {
  0% { transform: translate(0px, 0px); animation-timing-function: step-end; }
  100% { transform: translate(100px, 0px); }
}
/* rotate eases linearly across the whole span */
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(90deg); }
}

#n {
  type: circle;
  r: 5px;
  animation: slide 1s linear 1, spin 1s linear 1;
}
`;

test('comma-list animation builds one instance per group', () => {
  const node = findNode(buildSceneGraph(parse(SRC)), 'n');
  expect(node.animations).toHaveLength(2);
  expect(node.animations.map((a) => a.name)).toEqual(['slide', 'spin']);
});

test('per-channel easing is independent (step-end translate vs linear rotate)', () => {
  const node = findNode(buildSceneGraph(parse(SRC)), 'n');
  const scheduler = new AnimationScheduler();

  resetNodeToBase(node);
  scheduler.sampleNode(node, 500); // halfway through both 1s animations

  // slide uses step-end: translateX still held at its 0% value.
  expect(node.transform.translateX).toBe(0);
  // spin is linear and untouched by slide: rotate is halfway.
  expect(node.transform.rotate).toBe(45);
});

test('the two animations touch distinct components (no clobber at the end)', () => {
  const node = findNode(buildSceneGraph(parse(SRC)), 'n');
  const scheduler = new AnimationScheduler();

  resetNodeToBase(node);
  scheduler.sampleNode(node, 1000);

  expect(node.transform.translateX).toBe(100);
  expect(node.transform.rotate).toBe(90);
});
