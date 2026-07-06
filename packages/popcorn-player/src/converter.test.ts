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
