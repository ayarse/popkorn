import { test, expect } from 'bun:test';
import { parse, buildSceneGraph, RenderLoop, multiplyMatrices, IDENTITY_MATRIX } from '@popcorn/player';
import type { Matrix3x3 } from '@popcorn/player';
import { SkiaRenderer } from '../src/skia-renderer';

type Call = {
  op: string;
  style?: number;
  m?: number[];
  blend?: number;
  filter?: unknown;
  dash?: number[];
};

// Minimal mock of the @shopify/react-native-skia `Skia` object + SkCanvas,
// recording the method calls the renderer makes. Lets this run under `bun test`
// with no native module installed. PaintStyle: 0 = Fill, 1 = Stroke.
function mockSkia() {
  const calls: Call[] = [];
  // How many native SkPaint objects the renderer allocated. Paint reuse means
  // this must stay flat (the two persistent fill/stroke paints) no matter how
  // many shapes or frames are drawn.
  const counters = { paints: 0, paths: 0, shaders: 0, dashes: 0 };

  const makePaint = () => {
    counters.paints++;
    const p: any = { __style: undefined as number | undefined };
    p.setAntiAlias = () => p;
    p.setStyle = (s: number) => { p.__style = s; return p; };
    p.setStrokeWidth = () => p;
    p.setStrokeCap = () => p;
    p.setStrokeJoin = () => p;
    p.setStrokeMiter = () => p;
    p.setColor = () => p;
    p.setAlphaf = () => p;
    p.setShader = () => p;
    p.setPathEffect = (e: any) => { p.__dash = e?.__dash; return p; };
    p.setBlendMode = (b: number) => { p.__blend = b; return p; };
    p.setColorFilter = (f: unknown) => { p.__filter = f; return p; };
    // reset() returns a persistent paint to defaults before it's reconfigured
    // for the next shape (mirrors SkPaint.reset()).
    p.reset = () => { p.__style = undefined; p.__dash = undefined; p.__blend = undefined; p.__filter = undefined; return p; };
    return p;
  };

  const makePath = () => {
    counters.paths++;
    const path: any = {};
    for (const m of ['moveTo', 'lineTo', 'cubicTo', 'quadTo', 'close', 'addCircle', 'setFillType']) {
      path[m] = () => path;
    }
    return path;
  };

  const canvas: any = {
    save: () => calls.push({ op: 'save' }),
    restore: () => calls.push({ op: 'restore' }),
    // saveLayer records the compositing paint's blend mode + colour filter, so a
    // mask test can assert the DstIn/DstOut (+luma) table.
    saveLayer: (p: any) => calls.push({ op: 'saveLayer', blend: p?.__blend, filter: p?.__filter }),
    concat: (m: number[]) => calls.push({ op: 'concat', m }),
    clipRect: () => calls.push({ op: 'clipRect' }),
    clipPath: () => calls.push({ op: 'clipPath' }),
    drawRect: (_r: unknown, p: any) => calls.push({ op: 'drawRect', style: p.__style }),
    drawRRect: (_r: unknown, p: any) => calls.push({ op: 'drawRRect', style: p.__style }),
    drawOval: (_r: unknown, p: any) => calls.push({ op: 'drawOval', style: p.__style }),
    drawCircle: (_x: number, _y: number, _r: number, p: any) => calls.push({ op: 'drawCircle', style: p.__style }),
    drawPath: (_path: unknown, p: any) => calls.push({ op: 'drawPath', style: p.__style, dash: p.__dash }),
  };

  const Skia: any = {
    Paint: makePaint,
    Color: () => new Float32Array([0, 0, 0, 1]),
    Path: { Make: makePath },
    XYWHRect: (x: number, y: number, w: number, h: number) => ({ x, y, w, h }),
    RRectXY: (rect: unknown, rx: number, ry: number) => ({ rect, rx, ry }),
    Shader: {
      MakeLinearGradient: () => { counters.shaders++; return {}; },
      MakeRadialGradient: () => { counters.shaders++; return {}; },
      MakeTwoPointConicalGradient: () => { counters.shaders++; return {}; },
    },
    // MakeDash echoes the interval array back so the renderer's even-ization is observable.
    PathEffect: { MakeDash: (arr: number[]) => { counters.dashes++; return { __dash: arr }; } },
    ColorFilter: { MakeMatrix: (matrix: number[]) => ({ __matrix: matrix }) },
  };

  return { Skia, canvas, calls, counters };
}

test('paints a rect and a path with fill paint through the render loop', () => {
  const { Skia, canvas, calls } = mockSkia();

  const scene = buildSceneGraph(
    parse(`
      :root { width: 100px; height: 100px }
      #r { type: rect; width: 40px; height: 40px; fill: #f00 }
      #p { type: path; d: "M 0 0 L 20 0 L 20 20 Z"; fill: #00f }
    `)
  );

  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);

  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);
  rl.seek(0); // not running => renders exactly one frame synchronously

  const ops = calls.map((c) => c.op);
  // Root viewport transform + per-node save bracket.
  expect(ops).toContain('save');
  expect(ops).toContain('concat');

  // The rect and the path both painted, each with a Fill paint (style 0).
  const rect = calls.find((c) => c.op === 'drawRect');
  const path = calls.find((c) => c.op === 'drawPath');
  expect(rect?.style).toBe(0);
  expect(path?.style).toBe(0);

  // drawRect precedes drawPath (document paint order).
  expect(ops.indexOf('drawRect')).toBeLessThan(ops.indexOf('drawPath'));
});

// #1: setTransform is ABSOLUTE. SkCanvas only has relative concat, so the
// renderer mirrors the CTM and reaches the target via concat(invert(cur)·m). The
// product of every concat it emits must equal the requested absolute matrix.
test('setTransform yields the absolute matrix despite accumulated concats', () => {
  const { Skia, canvas, calls } = mockSkia();
  const r = new SkiaRenderer(Skia, { width: 100, height: 100 });
  r.setCanvas(canvas);
  r.beginFrame(); // resets the CTM mirror to identity (fresh recorder canvas)

  const A: Matrix3x3 = [2, 0, 10, 0, 2, 20, 0, 0, 1];
  const B: Matrix3x3 = [1, 0, 5, 0, 1, 7, 0, 0, 1];
  r.transform(A);
  r.transform(B);

  const target: Matrix3x3 = [3, 0, 40, 0, 3, 15, 0, 0, 1];
  r.setTransform(target);

  // Replaying every concat from identity reconstructs the live CTM.
  const ctm = calls
    .filter((c) => c.op === 'concat')
    .reduce<Matrix3x3>((acc, c) => multiplyMatrices(acc, c.m as Matrix3x3), IDENTITY_MATRIX);

  for (let i = 0; i < 9; i++) expect(ctm[i]).toBeCloseTo(target[i], 6);
});

// #2: a masked scene composites via nested saveLayers. Content layer first
// (source-over), then the mask layer carrying the DstIn blend, drawn between them.
test('a masked scene drives compositeMask with a DstIn mask layer', () => {
  const { Skia, canvas, calls } = mockSkia();

  const scene = buildSceneGraph(
    parse(`
      :root { width: 100px; height: 100px }
      #content { type: rect; width: 50px; height: 50px; fill: #f00; mask: #m alpha; }
      #m { type: circle; r: 25px; fill: #fff; }
    `)
  );

  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);
  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);
  rl.seek(0);

  const layers = calls.filter((c) => c.op === 'saveLayer');
  expect(layers.length).toBe(2);           // content layer + mask layer
  expect(layers[0].blend).toBeUndefined(); // content: plain source-over
  expect(layers[1].blend).toBe(6);         // mask: SkBlendMode.DstIn

  const ops = calls.map((c) => c.op);
  const first = ops.indexOf('saveLayer');
  const second = ops.indexOf('saveLayer', first + 1);
  // Content (rect) painted inside L1 before the mask layer opens; mask (circle)
  // painted inside L2 after it.
  expect(ops.indexOf('drawRect')).toBeGreaterThan(first);
  expect(ops.indexOf('drawRect')).toBeLessThan(second);
  expect(ops.indexOf('drawCircle')).toBeGreaterThan(second);
});

// #2 (mode table): each mask mode maps to the right blend + luminance filter.
test('compositeMask maps every mode to its blend mode and luma filter', () => {
  const cases: Array<[string, number, boolean]> = [
    ['alpha', 6, false],            // DstIn,  no filter
    ['alpha-invert', 8, false],     // DstOut, no filter
    ['luminance', 6, true],         // DstIn,  luma->alpha filter
    ['luminance-invert', 8, true],  // DstOut, luma->alpha filter
  ];
  for (const [mode, blend, hasFilter] of cases) {
    const { Skia, canvas, calls } = mockSkia();
    const r = new SkiaRenderer(Skia, { width: 100, height: 100 });
    r.setCanvas(canvas);
    r.beginFrame();
    r.compositeMask(mode as any, () => r.drawRect(0, 0, 10, 10), () => r.drawCircle(5, 5, 5));

    const layers = calls.filter((c) => c.op === 'saveLayer');
    expect(layers.length).toBe(2);
    expect(layers[1].blend).toBe(blend);
    expect(layers[1].filter != null).toBe(hasFilter);

    // Bracketed: three saves (outer + two layers) matched by three restores.
    expect(calls.filter((c) => c.op === 'save').length).toBe(1);
    expect(calls.filter((c) => c.op === 'restore').length).toBe(3);
  }
});

// Re-entrancy: a nested track matte inside drawContent reuses the single pooled
// mask paint. Configuring it before drawContent (as the copied code once did)
// let the nested matte clobber the outer's blend + luma filter; configuring it
// right before the outer's mask layer keeps each layer correct.
test('compositeMask is re-entrant: a nested matte does not corrupt the outer mask layer', () => {
  const { Skia, canvas, calls } = mockSkia();
  const r = new SkiaRenderer(Skia, { width: 100, height: 100 });
  r.setCanvas(canvas);
  r.beginFrame();

  let innerRan = false;
  r.compositeMask(
    'luminance', // outer: DstIn (6) + luma filter
    () => {
      // A nested matte with a DIFFERENT mode reuses the pooled mask paint.
      r.compositeMask('alpha-invert', () => { innerRan = true; }, () => {});
    },
    () => {},
  );

  expect(innerRan).toBe(true);

  // Two composites => four layers, each a content L1 + a mask L2, in the order
  // [outer L1, inner L1, inner L2, outer L2].
  const layers = calls.filter((c) => c.op === 'saveLayer');
  expect(layers.length).toBe(4);

  // The OUTER mask layer (last) must still carry the outer mode (luminance =>
  // DstIn + luma filter), not the nested alpha-invert that ran in between.
  const outerMask = layers[3];
  expect(outerMask.blend).toBe(6);            // DstIn
  expect(outerMask.filter != null).toBe(true);

  // The nested mask layer carries its own mode (alpha-invert => DstOut, no filter).
  expect(layers[2].blend).toBe(8);
  expect(layers[2].filter != null).toBe(false);

  // Balanced: two composites => two outer saves + three restores each.
  expect(calls.filter((c) => c.op === 'save').length).toBe(2);
  expect(calls.filter((c) => c.op === 'restore').length).toBe(6);
});

// Paint reuse: the renderer holds one persistent fill + one stroke paint and
// resets them per shape, so no SkPaint is allocated on the hot draw path. The
// only Paint() calls are the two in the constructor — flat across shapes/frames.
test('reuses paints instead of allocating per shape or per frame', () => {
  const { Skia, canvas, counters } = mockSkia();

  const scene = buildSceneGraph(
    parse(`
      :root { width: 100px; height: 100px }
      #a { type: rect; width: 40px; height: 40px; fill: #f00; stroke: #000; stroke-width: 2px }
      #b { type: circle; r: 20px; fill: #0f0; stroke: #00f; stroke-width: 1px }
      #c { type: rect; x: 10px; y: 10px; width: 10px; height: 10px; fill: #ff0 }
    `)
  );

  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  expect(counters.paints).toBe(2); // fill + stroke, allocated once in the constructor
  renderer.setCanvas(canvas);

  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);
  rl.seek(0);   // frame 1
  rl.seek(16);  // frame 2

  // Three shapes over two frames: without reuse this would be many allocations.
  // With reuse it stays at the two persistent paints.
  expect(counters.paints).toBe(2);
});

// Static-scene signal: isStatic() tells an embedder when it may stop repainting.
// It must be honest — anything that keeps the scene changing keeps it non-static.
test('isStatic reports only genuinely settled scenes', () => {
  const { Skia } = mockSkia();
  const make = (src: string) => {
    const rl = new RenderLoop(new SkiaRenderer(Skia, { width: 100, height: 100 }));
    rl.setScene(buildSceneGraph(parse(src)));
    return rl;
  };

  // A one-shot scene with no animation settles immediately.
  const stat = make(`:root { width: 100px; height: 100px } #r { type: rect; width: 10px; height: 10px; fill: #000 }`);
  expect(stat.isStatic()).toBe(true);

  // An infinite animation never settles, even past one iteration.
  const inf = make(`
    :root { width: 100px; height: 100px }
    @keyframes spin { from { rotate: 0deg } to { rotate: 360deg } }
    #r { type: rect; width: 10px; height: 10px; fill: #000; animation: spin 1s linear infinite }
  `);
  inf.seek(5000);
  expect(inf.isStatic()).toBe(false);

  // A cursor-reactive scene (input()/var() binding) is never static.
  const react = make(`
    :root { width: 100px; height: 100px; --cx: input(cursor.x) }
    #r { type: circle; r: 10px; cx: var(--cx); fill: #000 }
  `);
  react.seek(9999);
  expect(react.isStatic()).toBe(false);
});

// Static-skip mechanism: once a settled scene's canvas is unbound (what
// PopcornView does after delivering the resting frame) the renderer records no
// further draw ops — the paint/JSI work stops until state changes.
test('unbinding the canvas halts renderer draw calls', () => {
  const { Skia, canvas, calls } = mockSkia();

  const scene = buildSceneGraph(
    parse(`:root { width: 100px; height: 100px } #r { type: rect; width: 40px; height: 40px; fill: #f00 }`)
  );
  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);
  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);

  rl.seek(0); // resting frame delivered — paints the rect
  expect(calls.some((c) => c.op === 'drawRect')).toBe(true);
  expect(rl.isStatic()).toBe(true);

  // Go dormant: unbind and repaint — no new draw ops recorded.
  calls.length = 0;
  renderer.setCanvas(null as any);
  rl.redraw();
  expect(calls.some((c) => c.op === 'drawRect')).toBe(false);
});

// #3: an odd-length dash array is even-ized (duplicated) before MakeDash, which
// requires an even interval count.
test('setDash even-izes an odd dash array', () => {
  const { Skia, canvas, calls } = mockSkia();
  const r = new SkiaRenderer(Skia, { width: 100, height: 100 });
  r.setCanvas(canvas);
  r.beginFrame();

  r.setStroke({ r: 0, g: 0, b: 0, a: 1 }, 2);
  r.setDash([4, 2, 1], 0); // odd length -> [4,2,1,4,2,1]
  r.drawPath([{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }] as any);

  const stroked = calls.find((c) => c.op === 'drawPath' && c.dash);
  expect(stroked?.dash).toEqual([4, 2, 1, 4, 2, 1]);
});

// #1: a static path's commands array is reference-stable across frames (the
// reset walk shares the base array), so the SkPath is built once and cached —
// Path.Make must not grow on frame 2.
test('caches the SkPath for a static path across frames', () => {
  const { Skia, canvas, counters } = mockSkia();
  const scene = buildSceneGraph(
    parse(`:root { width: 100px; height: 100px } #p { type: path; d: "M 0 0 L 20 0 L 20 20 Z"; fill: #00f }`)
  );
  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);
  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);

  rl.seek(0);
  const afterFrame1 = counters.paths;
  expect(afterFrame1).toBeGreaterThan(0); // built once
  rl.seek(16);
  expect(counters.paths).toBe(afterFrame1); // frame 2 hit the cache, no rebuild
});

// #1: an animated `d` swaps a fresh commands array every frame, so the cache
// misses and the SkPath rebuilds — geometry can never go stale.
test('rebuilds the SkPath for an animated (morphing) path each frame', () => {
  const { Skia, canvas, counters } = mockSkia();
  const scene = buildSceneGraph(
    parse(`
      :root { width: 100px; height: 100px }
      @keyframes morph { from { d: "M 0 0 L 10 0 L 10 10 Z" } to { d: "M 0 0 L 20 0 L 20 20 Z" } }
      #p { type: path; d: "M 0 0 L 10 0 L 10 10 Z"; fill: #000; animation: morph 1s linear }
    `)
  );
  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);
  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);

  rl.seek(250);
  const afterFrame1 = counters.paths;
  rl.seek(750); // a different interpolated instant => fresh commands array
  expect(counters.paths).toBeGreaterThan(afterFrame1);
});

// #3: a static gradient is deep-copied per frame (identity unstable), but its
// serialized value + bounds are stable, so the SkShader is built once.
test('caches the gradient shader for a static gradient across frames', () => {
  const { Skia, canvas, counters } = mockSkia();
  const scene = buildSceneGraph(
    parse(`
      :root { width: 100px; height: 100px }
      #g { type: rect; width: 40px; height: 40px; fill: linear-gradient(#f00 0%, #00f 100%) }
    `)
  );
  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);
  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);

  rl.seek(0);
  expect(counters.shaders).toBe(1); // built once
  rl.seek(16);
  expect(counters.shaders).toBe(1); // frame 2 hit the shader cache
});

// #4: the dash PathEffect is memoized by interval-contents + offset, so a static
// dashed stroke builds it once across frames.
test('caches the dash PathEffect across frames', () => {
  const { Skia, canvas, counters } = mockSkia();
  const scene = buildSceneGraph(
    parse(`
      :root { width: 100px; height: 100px }
      #d { type: path; d: "M 0 0 L 40 0"; stroke: #000; stroke-width: 2px; stroke-dasharray: 5px 3px }
    `)
  );
  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);
  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);

  rl.seek(0);
  expect(counters.dashes).toBe(1); // built once
  rl.seek(16);
  expect(counters.dashes).toBe(1); // frame 2 hit the dash cache
});

// #2: a paused (dynamic) loop freezes the timeline, and the dormancy PopcornView
// relies on — deliver one frame, unbind the canvas, record nothing further until
// time moves — rests on these renderer/loop primitives: currentTime holds while
// paused, and an unbound canvas records no draws; resume + rebind draws again.
// (PopcornView's frameCallback is the integrator; it can't mount headless.)
test('a paused loop freezes time and unbinding halts draws until resume', () => {
  const { Skia, canvas, calls } = mockSkia();
  const scene = buildSceneGraph(
    parse(`
      :root { width: 100px; height: 100px }
      @keyframes spin { from { rotate: 0deg } to { rotate: 360deg } }
      #r { type: rect; width: 10px; height: 10px; fill: #000; animation: spin 1s linear infinite }
    `)
  );
  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);
  const rl = new RenderLoop(renderer);
  rl.setScene(scene);
  rl.setSceneSize(100, 100);
  rl.setLoop(true);

  rl.seek(200);
  rl.pause();
  expect(rl.paused).toBe(true);
  const frozen = rl.currentTime;

  // Deliver the frozen frame, then go dormant (unbind) — subsequent ticks record
  // nothing and the timeline hasn't moved.
  calls.length = 0;
  renderer.setCanvas(null as any);
  rl.redraw();
  rl.redraw();
  expect(rl.currentTime).toBe(frozen);                  // time held while paused
  expect(calls.some((c) => c.op.startsWith('draw'))).toBe(false); // dormant: no draws

  // Resume + rebind: draws flow again.
  rl.resume();
  renderer.setCanvas(canvas);
  rl.redraw();
  expect(calls.some((c) => c.op.startsWith('draw'))).toBe(true);
});

// hasPendingImages(): the seam PopcornView polls after a settle/freeze to
// decide whether to schedule a wake-up for a still-decoding file://http(s)
// image (see PopcornView's `wakeWhenImagesSettle`). data: URIs decode
// synchronously via fromBase64 and never appear here.
test('hasPendingImages reports true while a non-data image decode is in flight', async () => {
  const { Skia, canvas } = mockSkia();
  let resolveFetch: (() => void) | undefined;
  Skia.Data = {
    fromBase64: () => ({}),
    fromURI: (_uri: string) =>
      new Promise((resolve) => {
        resolveFetch = () => resolve({});
      }),
  };
  Skia.Image = { MakeImageFromEncoded: () => ({}) };

  const renderer = new SkiaRenderer(Skia, { width: 100, height: 100 });
  renderer.setCanvas(canvas);
  renderer.beginFrame();

  expect(renderer.hasPendingImages()).toBe(false);
  renderer.drawImage('file:///photo.png', 0, 0, 10, 10); // kicks off the async decode
  expect(renderer.hasPendingImages()).toBe(true);

  resolveFetch?.();
  await renderer.whenImagesSettled();
  expect(renderer.hasPendingImages()).toBe(false);
});
