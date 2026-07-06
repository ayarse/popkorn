import { test, expect } from 'bun:test';
import { parse } from '@popcorn/parser';
import { buildSceneGraph } from './scene/builder';
import { Converter } from '../../../tools/lottie2popcorn';

// A closed triangle bezier shape (matching vertex/tangent counts guaranteed).
const shape = (v: number[][]) => ({
  v,
  i: v.map(() => [0, 0]),
  o: v.map(() => [0, 0]),
  c: true,
});

// Minimal Lottie doc: one shape layer whose group carries an animated bezier
// path (sh a:1) and an animated gradient fill (gf with g.k.a:1).
function synthetic() {
  return {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ind: 1,
        ks: {},
        shapes: [
          {
            ty: 'gr',
            it: [
              {
                ty: 'sh',
                ks: {
                  a: 1,
                  k: [
                    { t: 0, s: [shape([[0, 0], [10, 0], [10, 10]])] },
                    { t: 30, s: [shape([[0, 0], [20, 0], [20, 20]])] },
                  ],
                },
              },
              {
                ty: 'gf',
                t: 1,
                s: { a: 0, k: [0, 0] },
                e: { a: 0, k: [10, 0] },
                g: {
                  p: 2,
                  k: {
                    a: 1,
                    k: [
                      { t: 0, s: [0, 0, 0, 0, 1, 1, 1, 1] },
                      { t: 30, s: [0, 1, 0, 0, 1, 0, 1, 1] },
                    ],
                  },
                },
              },
              { ty: 'tr' },
            ],
          },
        ],
      },
    ],
  };
}

test('converter: animated path + gradient stops are no longer blocked and validate', () => {
  const c = new Converter();
  const css = c.convert(synthetic());

  // Neither feature blocks the layer anymore.
  expect([...c.blocked]).toEqual([]);

  // Emitted @keyframes carry per-frame path strings and gradient strings.
  expect(css).toContain('@keyframes');
  expect(css).toMatch(/\d+%\s*\{[^}]*d: '/);
  expect(css).toMatch(/\d+%\s*\{[^}]*linear-gradient\(/);

  // The output parses and builds a scene graph without throwing.
  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

// A precomp (ty 0) instance of an asset holding one animated (opacity) layer.
function precompDoc() {
  return {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    assets: [
      {
        id: 'comp_0',
        layers: [
          {
            ty: 4,
            ind: 1,
            nm: 'Inner',
            ks: { o: { a: 1, k: [{ t: 0, s: [0] }, { t: 30, s: [100] }] } },
            shapes: [
              {
                ty: 'gr',
                it: [
                  { ty: 'rc', s: { a: 0, k: [10, 10] }, p: { a: 0, k: [0, 0] } },
                  { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
                  { ty: 'tr' },
                ],
              },
            ],
          },
        ],
      },
    ],
    layers: [
      {
        ty: 0,
        ind: 1,
        nm: 'Instance',
        refId: 'comp_0',
        st: 15, // 15/30fps -> 0.5s
        sr: 0.5, // stretch 0.5 -> plays 2x -> time-scale 2
        w: 100,
        h: 100,
        ks: { p: { a: 0, k: [10, 20, 0] } },
      },
    ],
  };
}

test('converter: precomp expands into a namespaced group with time scoping + clip', () => {
  const c = new Converter();
  const css = c.convert(precompDoc());

  expect([...c.blocked]).toEqual([]);

  // Layer st -> time-offset, sr stretch -> time-scale (1/sr).
  expect(css).toContain('time-offset: 0.5s');
  expect(css).toContain('time-scale: 2');

  // Precomp clips to its comp box.
  expect(css).toContain("clip-path: path('M0 0 H100 V100 H0 Z')");

  // Instance transform from ks.p is on the group.
  expect(css).toContain('transform: translate(10px, 20px)');

  // The asset's layer is expanded as a nested child, id-namespaced by the
  // instance so multiple instances never collide.
  expect(css).toMatch(/#Instance-Inner/);

  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

test('converter: precomp reference cycle is blocked cleanly (no throw)', () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    assets: [
      { id: 'comp_0', layers: [{ ty: 0, ind: 1, refId: 'comp_0', w: 100, h: 100, ks: {} }] },
    ],
    layers: [{ ty: 0, ind: 1, refId: 'comp_0', w: 100, h: 100, ks: {} }],
  };
  const c = new Converter();
  let css = '';
  expect(() => { css = c.convert(doc); }).not.toThrow();
  expect([...c.blocked]).toContain('precomp cycle');
  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});
