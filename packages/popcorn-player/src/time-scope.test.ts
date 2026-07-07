import { test, expect } from 'bun:test';
import { parse } from '@popcorn/parser';
import { buildSceneGraph } from './scene/builder';
import { RenderLoop } from './runtime/loop';
import type { SceneNode, CircleData } from './scene/types';
import type { Renderer } from './renderer/interface';

// A do-nothing renderer: every method is a no-op returning 0 (getWidth/Height).
const stubRenderer = new Proxy({}, { get: () => () => 0 }) as unknown as Renderer;

const find = (n: SceneNode, id: string): SceneNode => {
  if (n.id === id) return n;
  for (const c of n.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined as unknown as SceneNode;
};
const cx = (root: SceneNode, id: string) => (find(root, id).shapeData as CircleData).cx;

// A circle whose cx sweeps 0 -> 100 over one second, held at both ends.
const anim = "r: 5px; cx: 0px; animation: move 1s linear 1; animation-fill-mode: both;";
const scene = `
  :root { width: 100px; height: 100px; }
  @keyframes move { 0% { cx: 0px; } 100% { cx: 100px; } }
  #plain { type: circle; ${anim} }
  #shifted { type: group; time-offset: 0.5s;
    > #a { type: circle; ${anim} }
  }
  #fast { type: group; time-scale: 2;
    > #b { type: circle; ${anim} }
  }
  #nested { type: group; time-offset: 0.5s;
    > #mid { type: group; time-scale: 2;
      > #c { type: circle; ${anim} }
    }
  }
  #remapped { type: group; time-remap: 0s 0s, 2s 1s;
    > #e { type: circle; ${anim} }
  }
  #held { type: group; time-remap: 0s 0s, 1s 1s;
    > #f { type: circle; ${anim} }
  }
  #stepped { type: group; time-remap: 0s 0s step-end, 1s 1s;
    > #g { type: circle; ${anim} }
  }
  #override { type: group; time-offset: 5s; time-remap: 0s 0s, 2s 1s;
    > #h { type: circle; ${anim} }
  }
`;

function loopAt(ms: number): SceneNode {
  const root = buildSceneGraph(parse(scene));
  const loop = new RenderLoop(stubRenderer);
  loop.setScene(root);
  loop.seek(ms); // not running -> resolves the scene at this instant
  return root;
}

test('time scoping: default (no props) samples at the raw timeline time', () => {
  expect(cx(loopAt(500), 'plain')).toBeCloseTo(50);
});

test('time-offset delays the subtree timeline', () => {
  // At t=500ms the shifted subtree is at local 0 (nothing started yet).
  expect(cx(loopAt(500), 'a')).toBeCloseTo(0);
  // At t=1000ms local is 500ms -> halfway.
  expect(cx(loopAt(1000), 'a')).toBeCloseTo(50);
});

test('time-scale compresses the subtree timeline', () => {
  // 2x speed: reaches the halfway value at t=250ms (local 500ms).
  expect(cx(loopAt(250), 'b')).toBeCloseTo(50);
});

test('nested scopes compose: offset then scale', () => {
  // local = (t - 500) * 2. At t=750ms -> 500ms -> halfway.
  expect(cx(loopAt(750), 'c')).toBeCloseTo(50);
});

test('time-remap maps the timeline through a linear curve (t -> t/2)', () => {
  // Curve 0s->0s, 2s->1s is linear halving: local = t/2.
  expect(cx(loopAt(500), 'e')).toBeCloseTo(25);   // local 250ms
  expect(cx(loopAt(1000), 'e')).toBeCloseTo(50);  // local 500ms
  expect(cx(loopAt(2000), 'e')).toBeCloseTo(100); // local 1000ms (end)
});

test('time-remap holds the last output beyond the curve domain', () => {
  // Curve ends at 1s->1s; past t=1000ms local stays 1000ms (anim end).
  expect(cx(loopAt(1500), 'f')).toBeCloseTo(100);
});

test('time-remap step-end holds the departing stop across the segment', () => {
  expect(cx(loopAt(500), 'g')).toBeCloseTo(0);    // step-end -> local held at 0
  expect(cx(loopAt(1000), 'g')).toBeCloseTo(100); // jumps at the next stop
});

test('time-remap subsumes time-offset (the remap defines local time)', () => {
  // Despite time-offset: 5s, the remap alone drives local time -> t/2.
  expect(cx(loopAt(1000), 'h')).toBeCloseTo(50);
});

test('invalid time-scale (<= 0) warns and falls back to 1', () => {
  const src = `
    :root { width: 100px; height: 100px; }
    @keyframes move { 0% { cx: 0px; } 100% { cx: 100px; } }
    #bad { type: group; time-scale: 0;
      > #d { type: circle; ${anim} }
    }
  `;
  const orig = console.warn;
  let warned = '';
  console.warn = (m?: unknown) => { warned = String(m); };
  const root = buildSceneGraph(parse(src));
  console.warn = orig;

  expect(warned).toContain('time-scale');
  expect(find(root, 'bad').timeScale).toBe(1);
});
