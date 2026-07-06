import { test, expect } from 'bun:test';
import { parse } from '@popcorn/parser';
import { buildSceneGraph } from './scene/builder';
import { Converter, prop, normalizeKfs, splitProp, normalizeDoc } from '../../../tools/lottie2popcorn';

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

// ---------------------------------------------------------------------------
// Normalization layer — real-world minified/legacy encoding quirks.
// These fragments are synthetic (corpus-independent), matching how production
// bodymovin exports abbreviate/omit fields.
// ---------------------------------------------------------------------------

test('normalize: bare scalar k reads as a static single-element value', () => {
  const p = prop({ a: 0, k: 42 })!;
  expect(p.animated).toBe(false);
  expect(p.at(0)).toEqual([42]);
});

test('normalize: animation is inferred when `a` is absent but k is a keyframe array', () => {
  // No `a` field at all — bodymovin frequently omits it. k is [{t,s},…].
  const p = prop({ k: [{ t: 0, s: [0] }, { t: 10, s: [100] }] })!;
  expect(p.animated).toBe(true);
  expect(p.at(0)).toEqual([0]);
  expect(p.at(10)).toEqual([100]);
  expect(p.at(5)).toEqual([50]); // linear cross-sample midpoint
});

test('normalize: legacy `e` end-values fill an omitted arriving/final `s`', () => {
  // Old v4 export: each departing keyframe carries `e`; arriving frames (incl.
  // the final one) omit `s`. Expect start-value-per-keyframe reconstruction.
  const kfs = normalizeKfs([
    { t: 0, s: [0], e: [100] },
    { t: 10, e: [50] }, // s omitted -> prev.e = 100
    { t: 20 },          // s and e omitted -> prev.e = 50
  ]);
  expect(kfs.map((k) => k.s)).toEqual([[0], [100], [50]]);
});

test('normalize: scalar keyframe `s` is wrapped to an array', () => {
  const kfs = normalizeKfs([{ t: 0, s: 5 }, { t: 10, s: 9 }]);
  expect(kfs.map((k) => k.s)).toEqual([[5], [9]]);
});

test('normalize: out-of-order keyframes are sorted by t', () => {
  const kfs = normalizeKfs([{ t: 10, s: [1] }, { t: 0, s: [0] }]);
  expect(kfs.map((k) => k.t)).toEqual([0, 10]);
});

test('normalize: split position samples x/y onto the union keyframe grid', () => {
  // x animates on {0,10}, y animates on {0,5,10}. Union grid = {0,5,10}, and
  // each axis is linearly sampled at the foreign times.
  const p = splitProp({
    s: true,
    x: { a: 1, k: [{ t: 0, s: [0] }, { t: 10, s: [100] }] },
    y: { a: 1, k: [{ t: 0, s: [0] }, { t: 5, s: [20] }, { t: 10, s: [0] }] },
  });
  expect(p.animated).toBe(true);
  expect(p.kfs!.map((k) => k.t)).toEqual([0, 5, 10]);
  expect(p.at(0)).toEqual([0, 0]);
  expect(p.at(5)).toEqual([50, 20]); // x linearly interpolated at foreign t=5
  expect(p.at(10)).toEqual([100, 0]);
});

test('normalize: static split position keeps both axis values (not dropped to 0)', () => {
  const p = splitProp({ s: true, x: { a: 0, k: 55 }, y: { a: 0, k: 50 } });
  expect(p.animated).toBe(false);
  expect(p.at(0)).toEqual([55, 50]);
});

test('normalize: layer names are sanitized, deduped, and synthesized when absent', () => {
  const doc = {
    fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [
      { ty: 4, ind: 1, nm: 'Shape Layer', ks: {}, shapes: [] },
      { ty: 4, ind: 2, nm: 'Shape Layer', ks: {}, shapes: [] }, // duplicate name
      { ty: 4, ind: 3, nm: '🎉', ks: {}, shapes: [] },          // emoji-only
      { ty: 4, ind: 4, nm: '123abc', ks: {}, shapes: [] },      // leading digit
      { ty: 4, ind: 5, ks: {}, shapes: [] },                    // no nm at all
    ],
  };
  const css = new Converter().convert(doc);
  const ids = [...css.matchAll(/^#(\S+) \{/gm)].map((m) => m[1]);
  // No spaces, no leading digits, all unique, all valid idents.
  for (const id of ids) expect(id).toMatch(/^[a-zA-Z_][a-zA-Z0-9_-]*$/);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain('Shape-Layer');
  expect(ids).toContain('Shape-Layer-2'); // deterministic dedup suffix
});

test('normalize: missing layer `ind` gets a synthetic id and still converts', () => {
  const doc = {
    fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [{ ty: 4, ks: {}, shapes: [] }], // no ind
  };
  normalizeDoc(doc);
  expect(typeof doc.layers[0].ind).toBe('number');
  const c = new Converter();
  let css = '';
  expect(() => { css = c.convert(doc); }).not.toThrow();
  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

test('normalize: hidden shape items (hd:true) are skipped entirely', () => {
  const doc = {
    fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [{
      ty: 4, ind: 1, nm: 'L', ks: {},
      shapes: [{
        ty: 'gr',
        it: [
          { ty: 'rc', hd: true, s: { a: 0, k: [10, 10] }, p: { a: 0, k: [0, 0] } }, // hidden geometry
          { ty: 'el', s: { a: 0, k: [8, 8] }, p: { a: 0, k: [0, 0] } },             // visible
          { ty: 'fl', hd: true, c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } }, // hidden fill
          { ty: 'tr' },
        ],
      }],
    }],
  };
  const css = new Converter().convert(doc);
  // The hidden rect never appears; the visible ellipse does; the hidden fill
  // contributes no paint (so the ellipse falls back to fill: none).
  expect(css).not.toContain('type: rect');
  expect(css).toContain('type: ellipse');
  expect(css).toContain('fill: none');
});
