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

  const makePaint = () => {
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
    return p;
  };

  const makePath = () => {
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
      MakeLinearGradient: () => ({}),
      MakeRadialGradient: () => ({}),
      MakeTwoPointConicalGradient: () => ({}),
    },
    // MakeDash echoes the interval array back so the renderer's even-ization is observable.
    PathEffect: { MakeDash: (arr: number[]) => ({ __dash: arr }) },
    ColorFilter: { MakeMatrix: (matrix: number[]) => ({ __matrix: matrix }) },
  };

  return { Skia, canvas, calls };
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
