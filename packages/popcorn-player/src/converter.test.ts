import { expect, test } from "bun:test";
import { parse } from "@popcorn/parser";
import {
  Converter,
  normalizeDoc,
  normalizeKfs,
  prop,
  splitProp,
} from "../../../tools/lottie2popcorn";
import { buildSceneGraph } from "./scene/builder";

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
            ty: "gr",
            it: [
              {
                ty: "sh",
                ks: {
                  a: 1,
                  k: [
                    {
                      t: 0,
                      s: [
                        shape([
                          [0, 0],
                          [10, 0],
                          [10, 10],
                        ]),
                      ],
                    },
                    {
                      t: 30,
                      s: [
                        shape([
                          [0, 0],
                          [20, 0],
                          [20, 20],
                        ]),
                      ],
                    },
                  ],
                },
              },
              {
                ty: "gf",
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
              { ty: "tr" },
            ],
          },
        ],
      },
    ],
  };
}

test("converter: animated path + gradient stops are no longer blocked and validate", () => {
  const c = new Converter();
  const css = c.convert(synthetic());

  // Neither feature blocks the layer anymore.
  expect([...c.blocked]).toEqual([]);

  // Emitted @keyframes carry per-frame path strings and gradient strings.
  expect(css).toContain("@keyframes");
  expect(css).toMatch(/\d+%\s*\{[^}]*d: '/);
  expect(css).toMatch(/\d+%\s*\{[^}]*linear-gradient\(/);

  // The output parses and builds a scene graph without throwing.
  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

// A shape layer carrying an animated layer mask (masksProperties with an
// animated bezier pt). The mask should drive a keyframed clip-path, not bake.
function animatedMaskDoc() {
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
        masksProperties: [
          {
            mode: "a",
            pt: {
              a: 1,
              k: [
                {
                  t: 0,
                  s: [
                    shape([
                      [0, 0],
                      [10, 0],
                      [10, 10],
                    ]),
                  ],
                },
                {
                  t: 30,
                  s: [
                    shape([
                      [0, 0],
                      [20, 0],
                      [20, 20],
                    ]),
                  ],
                },
              ],
            },
          },
        ],
        shapes: [
          {
            ty: "gr",
            it: [
              { ty: "rc", s: { a: 0, k: [50, 50] }, p: { a: 0, k: [25, 25] } },
              { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
              { ty: "tr" },
            ],
          },
        ],
      },
    ],
  };
}

test("converter: an animated mask emits a keyframed clip-path (not baked)", () => {
  const c = new Converter();
  const css = c.convert(animatedMaskDoc());

  // No longer a "baked to first frame" warning; nothing blocks the layer.
  expect(c.warnings.join("\n")).not.toContain("baked to first frame");
  expect([...c.blocked]).toEqual([]);

  // A static base clip plus a @keyframes whose blocks carry a clip-path. The
  // clip value may be a literal path() or a hoisted var() (path dedup collapses
  // the base + 0% keyframe, which share t=0 geometry, into one :root var).
  expect(css).toMatch(/clip-path: (path\(|var\()/);
  expect(css).toMatch(/\d+%\s*\{[^}]*clip-path: (path\(|var\()/);

  // Two distinct clip endpoints survive (the morph): x grows 10 -> 20, so the
  // t=0 and t=30 shapes are different tokens even after dedup.
  const clips = new Set(
    css.match(/clip-path: (path\('[^']*'\)|var\(--\w+\))/g) ?? [],
  );
  expect(clips.size).toBeGreaterThanOrEqual(2);

  // The hoisted var() must resolve to a real command list, not an empty morph.
  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

// A group with two closed contours (outer ring + inner hole) sharing ONE fill.
// Lottie fills all a group's paths as a single nonzero region, so the inner,
// opposite-wound contour cuts a hole. Emitting each contour as its own solid
// fill would fill the hole in (the classic "outline renders as a solid blob").
function holeDoc() {
  const outer = shape([
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ]);
  const inner = shape([
    [-5, 5],
    [5, 5],
    [5, -5],
    [-5, -5],
  ]); // reverse winding
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
            ty: "gr",
            it: [
              { ty: "sh", ks: { a: 0, k: outer } },
              { ty: "sh", ks: { a: 0, k: inner } },
              { ty: "fl", c: { a: 0, k: [0, 0, 0, 1] }, o: { a: 0, k: 100 } },
              { ty: "tr" },
            ],
          },
        ],
      },
    ],
  };
}

test("converter: sibling contours sharing one fill merge into a nonzero compound path", () => {
  const c = new Converter();
  const css = c.convert(holeDoc());

  // Both contours land in ONE path `d` (two `M` subpaths), not two solid fills.
  const dMatch = css.match(/d: '([^']*)'/g) ?? [];
  expect(dMatch.length).toBe(1);
  expect((dMatch[0].match(/M /g) ?? []).length).toBe(2);

  // A single fill, filled nonzero so the inner subpath reads as a hole.
  expect((css.match(/fill: #000000/g) ?? []).length).toBe(1);
  expect(css).toContain("fill-rule: nonzero");

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
        id: "comp_0",
        layers: [
          {
            ty: 4,
            ind: 1,
            nm: "Inner",
            ks: {
              o: {
                a: 1,
                k: [
                  { t: 0, s: [0] },
                  { t: 30, s: [100] },
                ],
              },
            },
            shapes: [
              {
                ty: "gr",
                it: [
                  {
                    ty: "rc",
                    s: { a: 0, k: [10, 10] },
                    p: { a: 0, k: [0, 0] },
                  },
                  {
                    ty: "fl",
                    c: { a: 0, k: [1, 0, 0, 1] },
                    o: { a: 0, k: 100 },
                  },
                  { ty: "tr" },
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
        nm: "Instance",
        refId: "comp_0",
        st: 15, // 15/30fps -> 0.5s
        sr: 0.5, // stretch 0.5 -> plays 2x -> time-scale 2
        w: 100,
        h: 100,
        ks: { p: { a: 0, k: [10, 20, 0] } },
      },
    ],
  };
}

test("converter: precomp expands into a namespaced group with time scoping + clip", () => {
  const c = new Converter();
  const css = c.convert(precompDoc());

  expect([...c.blocked]).toEqual([]);

  // Layer st -> time-offset, sr stretch -> time-scale (1/sr).
  expect(css).toContain("time-offset: 0.5s");
  expect(css).toContain("time-scale: 2");

  // Precomp clips to its comp box.
  expect(css).toContain("clip-path: path('M0 0 H100 V100 H0 Z')");

  // Instance transform from ks.p is on the group.
  expect(css).toContain("transform: translate(10px, 20px)");

  // The asset's layer is expanded as a nested child, id-namespaced by the
  // instance so multiple instances never collide.
  expect(css).toMatch(/#Instance-Inner/);

  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

test("converter: precomp reference cycle is blocked cleanly (no throw)", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    assets: [
      {
        id: "comp_0",
        layers: [{ ty: 0, ind: 1, refId: "comp_0", w: 100, h: 100, ks: {} }],
      },
    ],
    layers: [{ ty: 0, ind: 1, refId: "comp_0", w: 100, h: 100, ks: {} }],
  };
  const c = new Converter();
  let css = "";
  expect(() => {
    css = c.convert(doc);
  }).not.toThrow();
  expect([...c.blocked]).toContain("precomp cycle");
  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

test("converter: animated trim path (tm) emits trim-end keyframes and validates", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ind: 1,
        nm: "L",
        ks: {},
        shapes: [
          {
            ty: "gr",
            it: [
              { ty: "el", s: { a: 0, k: [8, 8] }, p: { a: 0, k: [0, 0] } },
              { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
              {
                ty: "tm",
                s: { a: 0, k: 0 },
                e: {
                  a: 1,
                  k: [
                    { t: 0, s: [0] },
                    { t: 30, s: [100] },
                  ],
                },
                o: { a: 0, k: 0 },
              },
              { ty: "tr" },
            ],
          },
        ],
      },
    ],
  };
  const css = new Converter().convert(doc);

  // The static trim-start is decl'd once; the animated trim-end is a channel.
  expect(css).toContain("trim-start: 0%");
  expect(css).toMatch(/@keyframes[^}]*\{[\s\S]*?0%\s*\{[^}]*trim-end: 0%/);
  expect(css).toMatch(/100%\s*\{[^}]*trim-end: 100%/);

  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

test("converter: animated trim (tm) sibling to a group propagates to descendants", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ind: 1,
        nm: "L",
        ks: {},
        shapes: [
          {
            ty: "gr",
            it: [
              { ty: "el", s: { a: 0, k: [8, 8] }, p: { a: 0, k: [0, 0] } },
              { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
              { ty: "tr" },
            ],
          },
          {
            ty: "tm",
            s: { a: 0, k: 0 },
            e: {
              a: 1,
              k: [
                { t: 0, s: [0] },
                { t: 30, s: [100] },
              ],
            },
            o: { a: 0, k: 0 },
          },
        ],
      },
    ],
  };
  const css = new Converter().convert(doc);

  expect(css).toContain("trim-start: 0%");
  expect(css).toMatch(/trim-end: 0%/);
  expect(css).toMatch(/trim-end: 100%/);

  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

// ---------------------------------------------------------------------------
// Normalization layer — real-world minified/legacy encoding quirks.
// These fragments are synthetic (corpus-independent), matching how production
// bodymovin exports abbreviate/omit fields.
// ---------------------------------------------------------------------------

test("normalize: bare scalar k reads as a static single-element value", () => {
  const p = prop({ a: 0, k: 42 })!;
  expect(p.animated).toBe(false);
  expect(p.at(0)).toEqual([42]);
});

test("normalize: animation is inferred when `a` is absent but k is a keyframe array", () => {
  // No `a` field at all — bodymovin frequently omits it. k is [{t,s},…].
  const p = prop({
    k: [
      { t: 0, s: [0] },
      { t: 10, s: [100] },
    ],
  })!;
  expect(p.animated).toBe(true);
  expect(p.at(0)).toEqual([0]);
  expect(p.at(10)).toEqual([100]);
  expect(p.at(5)).toEqual([50]); // linear cross-sample midpoint
});

test("normalize: legacy `e` end-values fill an omitted arriving/final `s`", () => {
  // Old v4 export: each departing keyframe carries `e`; arriving frames (incl.
  // the final one) omit `s`. Expect start-value-per-keyframe reconstruction.
  const kfs = normalizeKfs([
    { t: 0, s: [0], e: [100] },
    { t: 10, e: [50] }, // s omitted -> prev.e = 100
    { t: 20 }, // s and e omitted -> prev.e = 50
  ]);
  expect(kfs.map((k) => k.s)).toEqual([[0], [100], [50]]);
});

test("normalize: scalar keyframe `s` is wrapped to an array", () => {
  const kfs = normalizeKfs([
    { t: 0, s: 5 },
    { t: 10, s: 9 },
  ]);
  expect(kfs.map((k) => k.s)).toEqual([[5], [9]]);
});

test("normalize: out-of-order keyframes are sorted by t", () => {
  const kfs = normalizeKfs([
    { t: 10, s: [1] },
    { t: 0, s: [0] },
  ]);
  expect(kfs.map((k) => k.t)).toEqual([0, 10]);
});

test("normalize: split position samples x/y onto the union keyframe grid", () => {
  // x animates on {0,10}, y animates on {0,5,10}. Union grid = {0,5,10}, and
  // each axis is linearly sampled at the foreign times.
  const p = splitProp({
    s: true,
    x: {
      a: 1,
      k: [
        { t: 0, s: [0] },
        { t: 10, s: [100] },
      ],
    },
    y: {
      a: 1,
      k: [
        { t: 0, s: [0] },
        { t: 5, s: [20] },
        { t: 10, s: [0] },
      ],
    },
  });
  expect(p.animated).toBe(true);
  expect(p.kfs!.map((k) => k.t)).toEqual([0, 5, 10]);
  expect(p.at(0)).toEqual([0, 0]);
  expect(p.at(5)).toEqual([50, 20]); // x linearly interpolated at foreign t=5
  expect(p.at(10)).toEqual([100, 0]);
});

test("normalize: static split position keeps both axis values (not dropped to 0)", () => {
  const p = splitProp({ s: true, x: { a: 0, k: 55 }, y: { a: 0, k: 50 } });
  expect(p.animated).toBe(false);
  expect(p.at(0)).toEqual([55, 50]);
});

test("normalize: layer names are sanitized, deduped, and synthesized when absent", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      { ty: 4, ind: 1, nm: "Shape Layer", ks: {}, shapes: [] },
      { ty: 4, ind: 2, nm: "Shape Layer", ks: {}, shapes: [] }, // duplicate name
      { ty: 4, ind: 3, nm: "🎉", ks: {}, shapes: [] }, // emoji-only
      { ty: 4, ind: 4, nm: "123abc", ks: {}, shapes: [] }, // leading digit
      { ty: 4, ind: 5, ks: {}, shapes: [] }, // no nm at all
    ],
  };
  const css = new Converter().convert(doc);
  const ids = [...css.matchAll(/^#(\S+) \{/gm)].map((m) => m[1]);
  // No spaces, no leading digits, all unique, all valid idents.
  for (const id of ids) expect(id).toMatch(/^[a-zA-Z_][a-zA-Z0-9_-]*$/);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain("Shape-Layer");
  expect(ids).toContain("Shape-Layer-2"); // deterministic dedup suffix
});

test("normalize: missing layer `ind` gets a synthetic id and still converts", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [{ ty: 4, ks: {}, shapes: [] }], // no ind
  };
  normalizeDoc(doc);
  expect(typeof doc.layers[0].ind).toBe("number");
  const c = new Converter();
  let css = "";
  expect(() => {
    css = c.convert(doc);
  }).not.toThrow();
  expect(() => buildSceneGraph(parse(css))).not.toThrow();
});

test("normalize: hidden shape items (hd:true) are skipped entirely", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ind: 1,
        nm: "L",
        ks: {},
        shapes: [
          {
            ty: "gr",
            it: [
              {
                ty: "rc",
                hd: true,
                s: { a: 0, k: [10, 10] },
                p: { a: 0, k: [0, 0] },
              }, // hidden geometry
              { ty: "el", s: { a: 0, k: [8, 8] }, p: { a: 0, k: [0, 0] } }, // visible
              {
                ty: "fl",
                hd: true,
                c: { a: 0, k: [1, 0, 0, 1] },
                o: { a: 0, k: 100 },
              }, // hidden fill
              { ty: "tr" },
            ],
          },
        ],
      },
    ],
  };
  const css = new Converter().convert(doc);
  // The hidden rect never appears; the visible ellipse does; the hidden fill
  // contributes no paint (so the ellipse falls back to fill: none).
  expect(css).not.toContain("type: rect");
  expect(css).toContain("type: ellipse");
  expect(css).toContain("fill: none");
});

// --- merge paths (mm) ------------------------------------------------------

// A shape group whose drawables are unioned by a following mm modifier, then
// painted by the group's fill. Modes 1/2 union; 3/4/5 block.
function mergeDoc(drawables: any[], mm: number) {
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
        nm: "L",
        ks: {},
        shapes: [
          {
            ty: "gr",
            it: [
              ...drawables,
              { ty: "mm", mm },
              { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
              { ty: "tr" },
            ],
          },
        ],
      },
    ],
  };
}

test("merge: static rect+ellipse union into one path with two subpaths", () => {
  const doc = mergeDoc(
    [
      { ty: "rc", s: { a: 0, k: [10, 10] }, p: { a: 0, k: [0, 0] } },
      { ty: "el", s: { a: 0, k: [8, 8] }, p: { a: 0, k: [20, 0] } },
    ],
    1,
  );
  const c = new Converter();
  const css = c.convert(doc);
  // One merged path node, not separate rect/ellipse nodes.
  expect(css).toContain("type: path");
  expect(css).not.toContain("type: rect");
  expect(css).not.toContain("type: ellipse");
  // Two subpaths concatenated in a single `d` (nonzero winding = visual union).
  const ms = css.match(/M /g) || [];
  expect(ms.length).toBe(2);
  expect(css).toContain("fill-rule: nonzero");
  // The group fill still applies to the merged result.
  expect(css).toContain("fill: #ff0000");
  expect(c.blocked.size).toBe(0);
  // The emitted CSS is valid and builds.
  expect(buildSceneGraph(parse(css))).toBeTruthy();
});

test("merge: a star in a merge is baked from the player polystar math", () => {
  const doc = mergeDoc(
    [
      { ty: "rc", s: { a: 0, k: [10, 10] }, p: { a: 0, k: [30, 0] } },
      {
        ty: "sr",
        sy: 1,
        pt: { a: 0, k: 5 },
        or: { a: 0, k: 50 },
        ir: { a: 0, k: 25 },
        os: { a: 0, k: 0 },
        is: { a: 0, k: 0 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [0, 0] },
      },
    ],
    1,
  );
  const css = new Converter().convert(doc);
  expect(css).toContain("type: path");
  expect(css).not.toContain("type: star");
  // First polystar vertex sits straight up (-90deg): (cx, cy - outerRadius).
  expect(css).toContain("M 0 -50");
});

test("merge: mode 3 (subtract) stays blocked", () => {
  const doc = mergeDoc(
    [
      { ty: "rc", s: { a: 0, k: [10, 10] }, p: { a: 0, k: [0, 0] } },
      { ty: "el", s: { a: 0, k: [8, 8] }, p: { a: 0, k: [20, 0] } },
    ],
    3,
  );
  const c = new Converter();
  c.convert(doc);
  expect([...c.blocked]).toContain("merge mode 3 (mm)");
});

test("merge: single input passes through for any mode (a no-op union)", () => {
  // adrock-style: one shape before an intersect (mode 4) mm — still convertible.
  const doc = mergeDoc(
    [
      {
        ty: "sh",
        ks: {
          a: 0,
          k: shape([
            [0, 0],
            [10, 0],
            [10, 10],
          ]),
        },
      },
    ],
    4,
  );
  const c = new Converter();
  const css = c.convert(doc);
  expect(c.blocked.size).toBe(0);
  expect(css).toContain("type: path");
});

test("merge: animated geometry unions via a morphing d channel", () => {
  const doc = mergeDoc(
    [
      {
        ty: "sh",
        ks: {
          a: 1,
          k: [
            {
              t: 0,
              s: [
                shape([
                  [0, 0],
                  [10, 0],
                  [10, 10],
                ]),
              ],
            },
            {
              t: 30,
              s: [
                shape([
                  [0, 0],
                  [20, 0],
                  [20, 20],
                ]),
              ],
            },
          ],
        },
      },
      { ty: "rc", s: { a: 0, k: [10, 10] }, p: { a: 0, k: [40, 0] } },
    ],
    1,
  );
  const css = new Converter().convert(doc);
  expect(css).toContain("type: path");
  expect(css).toContain("@keyframes");
  // The merged (static rect + animated triangle) still reads as two subpaths.
  expect((css.match(/M /g) || []).length).toBeGreaterThanOrEqual(2);
  expect(buildSceneGraph(parse(css))).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Color normalization — some production exports use 0-255 integer color
// components instead of the standard 0-1 floats.
// ---------------------------------------------------------------------------

function fillDoc(c: number[]) {
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
        nm: "L",
        ks: {},
        shapes: [
          {
            ty: "gr",
            it: [
              { ty: "el", s: { a: 0, k: [8, 8] }, p: { a: 0, k: [0, 0] } },
              { ty: "fl", c: { a: 0, k: c }, o: { a: 0, k: 100 } },
              { ty: "tr" },
            ],
          },
        ],
      },
    ],
  };
}

test("normalize: 0-255 integer color components are rescaled to 0-1", () => {
  const css = new Converter().convert(fillDoc([255, 0, 0]));
  expect(css).toContain("fill: #ff0000");
});

test("normalize: a legitimate 0-1 color with a component exactly at 1.0 is not rescaled", () => {
  const css = new Converter().convert(fillDoc([1, 1, 0]));
  expect(css).toContain("fill: #ffff00");
});

// ---------------------------------------------------------------------------
// Visibility windows (layer ip/op narrower than the comp) — Lottie sticker
// exports swap a different layer in per time slice.
// ---------------------------------------------------------------------------

const rectShape = () => ({
  ty: "gr",
  it: [
    {
      ty: "rc",
      p: { a: 0, k: [0, 0] },
      s: { a: 0, k: [10, 10] },
      r: { a: 0, k: 0 },
    },
    { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
    { ty: "tr" },
  ],
});

test("visibility: a layer windowed narrower than the comp emits visible-from/until", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 90,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ind: 1,
        nm: "mid",
        ip: 30,
        op: 60,
        ks: {},
        shapes: [rectShape()],
      },
      {
        ty: 4,
        ind: 2,
        nm: "full",
        ip: 0,
        op: 90,
        ks: {},
        shapes: [rectShape()],
      },
    ],
  };
  const c = new Converter();
  const css = c.convert(doc);
  // Windowed layer (frames 30..60 -> 1s..2s) carries both props; the full-span
  // layer carries neither. Compare within each layer's own block.
  const block = (id: string) =>
    css.slice(
      css.indexOf(`#${id} {`),
      css.indexOf("}", css.indexOf(`#${id} {`)),
    );
  expect(block("mid")).toContain("visible-from: 1s");
  expect(block("mid")).toContain("visible-until: 2s");
  expect(block("full")).not.toContain("visible-");
  // The old "pops in" warning is gone.
  expect(c.warnings.join()).not.toContain("pops in");
  expect(buildSceneGraph(parse(css))).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Parenting -> z-index (Lottie parent is transform-only; the child keeps its
// own global paint-stack slot). Boxer-style: a parent with its own shapes plus
// a parented child that sits BELOW it in the stack -> nested with negative z.
// ---------------------------------------------------------------------------

test("parenting: a child stacked below its parent nests with a negative z-index", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      // array order 0 = frontmost. torso (ind 2) is above backArm (ind 3).
      {
        ty: 4,
        ind: 1,
        nm: "frontArm",
        parent: 2,
        ks: {},
        shapes: [rectShape()],
      },
      { ty: 4, ind: 2, nm: "torso", parent: 4, ks: {}, shapes: [rectShape()] },
      {
        ty: 4,
        ind: 3,
        nm: "backArm",
        parent: 2,
        ks: {},
        shapes: [rectShape()],
      },
      { ty: 4, ind: 4, nm: "body", ks: {}, shapes: [rectShape()] },
    ],
  };
  const css = new Converter().convert(doc);
  // backArm nested under torso, stacked one slot behind torso -> z-index -1.
  expect(css).toMatch(/#torso-[\s\S]*#backArm[\s\S]*z-index: -1/);
  // frontArm is one slot in front of torso -> z-index +1.
  expect(css).toMatch(/#frontArm[\s\S]*z-index: 1/);
  expect(buildSceneGraph(parse(css))).toBeTruthy();
});

test("parenting: an unrelated drawable interleaving the subtree warns (unrepresentable)", () => {
  // Shape 2 is parented to Shape 4, but Shape 3 (unrelated) sits between them
  // in the global stack -> exact order cannot be reproduced while nested.
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      { ty: 4, ind: 1, nm: "child", parent: 4, ks: {}, shapes: [rectShape()] },
      { ty: 4, ind: 2, nm: "unrelated", ks: {}, shapes: [rectShape()] },
      { ty: 4, ind: 3, nm: "other", ks: {}, shapes: [rectShape()] },
      { ty: 4, ind: 4, nm: "parent", ks: {}, shapes: [rectShape()] },
    ],
  };
  const c = new Converter();
  c.convert(doc);
  expect(
    c.warnings.some((w) => /subtree stack order is approximate/.test(w)),
  ).toBe(true);
});

test("parenting: a null interleaver does NOT warn (nulls paint nothing)", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      { ty: 4, ind: 1, nm: "child", parent: 4, ks: {}, shapes: [rectShape()] },
      { ty: 3, ind: 2, nm: "ctrlNull", ks: {} },
      { ty: 4, ind: 4, nm: "parent", ks: {}, shapes: [rectShape()] },
    ],
  };
  const c = new Converter();
  c.convert(doc);
  expect(
    c.warnings.some((w) => /subtree stack order is approximate/.test(w)),
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// Group stroke over nested filled segments: Lottie draws it as ONE stroke of the
// combined paths, painted BENEATH the fills (only the outer edge shows). It is
// hoisted into a single stroke-only node behind the fills — NOT stamped onto
// every segment, which would draw a heavy seam at every interior boundary.
// ---------------------------------------------------------------------------

test("stroke: an outer-group stroke hoists to one stroke-only node behind the fills", () => {
  const doc = {
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ind: 1,
        nm: "tail",
        ks: {},
        shapes: [
          // Two filled segment groups, then one layer-level stroke (16px, round).
          {
            ty: "gr",
            it: [
              {
                ty: "sh",
                ks: {
                  a: 0,
                  k: {
                    v: [
                      [0, 0],
                      [10, 0],
                      [10, 10],
                    ],
                    i: [
                      [0, 0],
                      [0, 0],
                      [0, 0],
                    ],
                    o: [
                      [0, 0],
                      [0, 0],
                      [0, 0],
                    ],
                    c: true,
                  },
                },
              },
              { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
              { ty: "tr" },
            ],
          },
          {
            ty: "gr",
            it: [
              {
                ty: "sh",
                ks: {
                  a: 0,
                  k: {
                    v: [
                      [10, 0],
                      [20, 0],
                      [20, 10],
                    ],
                    i: [
                      [0, 0],
                      [0, 0],
                      [0, 0],
                    ],
                    o: [
                      [0, 0],
                      [0, 0],
                      [0, 0],
                    ],
                    c: true,
                  },
                },
              },
              { ty: "fl", c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 } },
              { ty: "tr" },
            ],
          },
          {
            ty: "st",
            c: { a: 0, k: [0, 0, 0, 1] },
            w: { a: 0, k: 16 },
            lc: 2,
            o: { a: 0, k: 100 },
          },
        ],
      },
    ],
  };
  const css = new Converter().convert(doc);
  // Exactly ONE stroke (16px round) — the hoisted stroke-only node — not one per
  // segment. The segments themselves are fill-only.
  expect((css.match(/stroke-width: 16px/g) || []).length).toBe(1);
  expect((css.match(/stroke-linecap: round/g) || []).length).toBe(1);
  // The stroke node carries no fill and unions both segment subpaths (two M cmds).
  const strokeRule = css.match(/#[\w-]*stroke\b[^}]*\}/s)?.[0] ?? "";
  expect(strokeRule).toContain("fill: none");
  expect(strokeRule).toContain("stroke-width: 16px");
  expect((strokeRule.match(/M /g) || []).length).toBeGreaterThanOrEqual(2);
  // No segment fill leaks a stroke declaration.
  expect(css).not.toMatch(/fill: #ff0000;[^}]*stroke:/s);
  expect(buildSceneGraph(parse(css))).toBeTruthy();
});
