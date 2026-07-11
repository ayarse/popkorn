import { afterEach, expect, test } from 'bun:test';
import { parse, buildSceneGraph, hitTest, setTextMeasurer } from '@popkorn/player';
import { SkiaRenderer } from '../src/skia-renderer';

// The SkiaRenderer registers a PROCESS-GLOBAL text measurer in its constructor,
// so reset it after each test to keep files independent (bun shares module state).
afterEach(() => setTextMeasurer(null));

// A text scene with the node made interactive so hitTest returns it. The box the
// hit-test uses comes straight from the registered measurer (getShapeBounds).
function textScene() {
  const scene = buildSceneGraph(
    parse(`:root { width: 100px; height: 100px } #t { type: text; content: "AB"; x: 10px; y: 40px; font-size: 20px }`),
  );
  const node = scene.children[0];
  node.interactive = true; // bare text isn't interactive; hitTest only returns interactive nodes
  return { scene, node };
}

// Constructor only calls skia.Paint() (x2). The measurer closure isn't invoked
// until text is measured, so these minimal mocks suffice.
const headlessSkia = () => ({ Paint: () => ({}) }) as any;

// Font-capable mock: a system font manager whose SkFont reports a fixed advance
// per character, distinct from the 0.6*em headless estimate.
const ADVANCE = 5; // measured width for "AB" = 10; estimate = 0.6*20*2 = 24
const fontSkia = () =>
  ({
    Paint: () => ({}),
    FontMgr: { System: () => ({ matchFamilyStyle: () => ({}) }) },
    Font: () => ({ measureText: (t: string) => ({ width: ADVANCE * t.length }) }),
  }) as any;

test('constructing a SkiaRenderer registers a text measurer without throwing headless', () => {
  expect(() => new SkiaRenderer(headlessSkia(), { width: 100, height: 100 })).not.toThrow();

  // No system font manager => the measurer returns null and the scene falls back
  // to the em-estimate (width 24). A point at x=25 is inside the estimate box.
  const { scene, node } = textScene();
  expect(hitTest(scene, { x: 25, y: 30 })).toBe(node); // inside estimate [10,34]
});

test('the registered measurer feeds the scene layer the Skia glyph advance', () => {
  new SkiaRenderer(fontSkia(), { width: 100, height: 100 });

  const { scene, node } = textScene();
  // Measured box width = ADVANCE*2 = 10 -> box spans x in [10,20], y in [20,40].
  expect(hitTest(scene, { x: 15, y: 30 })).toBe(node); // inside measured box
  // x=25 is inside the 0.6*em ESTIMATE box (up to 34) but outside the measured
  // box (up to 20): a miss here proves the Skia advance drives the box, not the
  // estimate — the exact drift the bug caused.
  expect(hitTest(scene, { x: 25, y: 30 })).toBe(null);
});
