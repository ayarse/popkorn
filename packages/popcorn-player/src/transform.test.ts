import { test, expect } from 'bun:test';
import { createSceneNode } from './scene/types';
import type { SceneNode } from './scene/types';
import { computeLocalMatrix, computeWorldMatrix } from './scene/transform';
import { transformPoint } from './renderer/types';
import { hitTest } from './runtime/hit-test';

// --- helpers -----------------------------------------------------------------

function rect(id: string, x: number, y: number, w: number, h: number): SceneNode {
  const node = createSceneNode(id, 'rect');
  node.shapeData = { type: 'rect', x, y, width: w, height: h, rx: 0, ry: 0 };
  return node;
}

function setTransform(
  node: SceneNode,
  t: Partial<{ tx: number; ty: number; rotate: number; sx: number; sy: number }>
): void {
  node.transform.translateX = t.tx ?? 0;
  node.transform.translateY = t.ty ?? 0;
  node.transform.rotate = t.rotate ?? 0;
  node.transform.scaleX = t.sx ?? 1;
  node.transform.scaleY = t.sy ?? 1;
}

// Matrices are compared with a tolerance because rotation introduces tiny fp error.
function expectMatrix(actual: number[], expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 6);
  }
}

// --- (a) computeLocalMatrix: TRS order + transform-origin --------------------

test('computeLocalMatrix: translate -> rotate -> scale order', () => {
  const node = rect('r', 0, 0, 100, 100);
  setTransform(node, { tx: 10, ty: 20, rotate: 90, sx: 2, sy: 2 });

  // T(10,20) * R(90) * S(2,2)
  expectMatrix(computeLocalMatrix(node), [0, -2, 10, 2, 0, 20, 0, 0, 1]);
});

test('computeLocalMatrix: transform-origin pivot stays fixed under rotation', () => {
  const node = rect('r', 0, 0, 100, 100);
  node.transform.transformOrigin = { x: { value: 50, unit: 'px' }, y: { value: 50, unit: 'px' } };
  setTransform(node, { rotate: 90 });

  // T(50,50) * R(90) * T(-50,-50)
  const m = computeLocalMatrix(node);
  expectMatrix(m, [0, -1, 100, 1, 0, 0, 0, 0, 1]);

  // The pivot (50,50) maps to itself.
  const pivot = transformPoint(m, 50, 50);
  expect(pivot.x).toBeCloseTo(50, 6);
  expect(pivot.y).toBeCloseTo(50, 6);
});

test('computeLocalMatrix: percentage transform-origin resolves against the bbox', () => {
  const node = rect('r', 0, 0, 100, 100);
  node.transform.transformOrigin = { x: { value: 50, unit: '%' }, y: { value: 50, unit: '%' } };
  setTransform(node, { rotate: 90 });
  // 50% of a 100x100 box at origin (0,0) === (50,50) px, same as the pixel case above.
  expectMatrix(computeLocalMatrix(node), [0, -1, 100, 1, 0, 0, 0, 0, 1]);
});

// --- (b) computeWorldMatrix: parent composition ------------------------------

test('computeWorldMatrix: parent rotation composes with child translation', () => {
  const parent = rect('p', 0, 0, 10, 10);
  setTransform(parent, { rotate: 90 });
  const child = rect('c', 0, 0, 10, 10);
  setTransform(child, { tx: 10, ty: 0 });

  const parentWorld = computeWorldMatrix(parent);
  const childWorld = computeWorldMatrix(child, parentWorld);

  // R(90) * T(10,0): child's local origin lands at (0,10) in world space.
  const origin = transformPoint(childWorld, 0, 0);
  expect(origin.x).toBeCloseTo(0, 6);
  expect(origin.y).toBeCloseTo(10, 6);
});

// --- (c) hit-test agrees with the matrix path --------------------------------

test('hitTest: rotated + origin-shifted rect matches the world matrix', () => {
  const node = rect('r', 0, 0, 100, 100);
  node.interactive = true;
  node.transform.transformOrigin = { x: { value: 50, unit: 'px' }, y: { value: 50, unit: 'px' } };
  setTransform(node, { tx: 200, ty: 200, rotate: 37, sx: 1.5, sy: 0.8 });

  const world = computeWorldMatrix(node);

  // A local point inside the rect, mapped to screen space, must hit.
  const inside = transformPoint(world, 25, 75);
  expect(hitTest(node, inside)).toBe(node);

  // A local point well outside the rect, mapped to screen space, must miss.
  const outside = transformPoint(world, 300, 300);
  expect(hitTest(node, outside)).toBeNull();
});

test('hitTest: non-interactive node is never hit', () => {
  const node = rect('r', 0, 0, 100, 100);
  node.interactive = false;
  expect(hitTest(node, { x: 50, y: 50 })).toBeNull();
});

// --- path hit-testing (needs Path2D + a canvas context) ----------------------

const hasPath2D = typeof Path2D !== 'undefined';

test.skipIf(!hasPath2D)('hitTest: path point-in-path (triangle)', () => {
  const node = createSceneNode('t', 'path');
  node.interactive = true;
  node.shapeData = {
    type: 'path',
    d: 'M0 0 L100 0 L0 100 Z',
    commands: [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 0, y: 100 },
      { type: 'Z' },
    ],
  };

  // (10,10) is inside the lower-left triangle; (90,90) is outside.
  expect(hitTest(node, { x: 10, y: 10 })).toBe(node);
  expect(hitTest(node, { x: 90, y: 90 })).toBeNull();
});

test.skipIf(!hasPath2D)('hitTest: evenodd fill-rule leaves a hole (donut)', () => {
  const node = createSceneNode('donut', 'path');
  node.interactive = true;
  node.fillRule = 'evenodd';
  // Outer 100x100 square with an inner 40..60 square subpath; evenodd punches
  // the inner square out, so a point in the hole must miss.
  node.shapeData = {
    type: 'path',
    d: 'M0 0 H100 V100 H0 Z M40 40 H60 V60 H40 Z',
    commands: [
      { type: 'M', x: 0, y: 0 }, { type: 'H', x: 100 }, { type: 'V', y: 100 }, { type: 'H', x: 0 }, { type: 'Z' },
      { type: 'M', x: 40, y: 40 }, { type: 'H', x: 60 }, { type: 'V', y: 60 }, { type: 'H', x: 40 }, { type: 'Z' },
    ],
  };

  expect(hitTest(node, { x: 10, y: 10 })).toBe(node);   // in the ring -> hit
  expect(hitTest(node, { x: 50, y: 50 })).toBeNull();   // in the hole -> miss

  // With the default nonzero rule the hole is filled, so the center hits.
  node.fillRule = 'nonzero';
  expect(hitTest(node, { x: 50, y: 50 })).toBe(node);
});
