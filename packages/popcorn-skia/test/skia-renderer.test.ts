import { test, expect } from 'bun:test';
import { parse, buildSceneGraph, RenderLoop } from '@popcorn/player';
import { SkiaRenderer } from '../src/skia-renderer';

// Minimal mock of the @shopify/react-native-skia `Skia` object + SkCanvas,
// recording the method calls the renderer makes. Lets this run under `bun test`
// with no native module installed. PaintStyle: 0 = Fill, 1 = Stroke.
function mockSkia() {
  const calls: Array<{ op: string; style?: number }> = [];

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
    p.setPathEffect = () => p;
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
    concat: () => calls.push({ op: 'concat' }),
    clipRect: () => calls.push({ op: 'clipRect' }),
    clipPath: () => calls.push({ op: 'clipPath' }),
    drawRect: (_r: unknown, p: any) => calls.push({ op: 'drawRect', style: p.__style }),
    drawRRect: (_r: unknown, p: any) => calls.push({ op: 'drawRRect', style: p.__style }),
    drawOval: (_r: unknown, p: any) => calls.push({ op: 'drawOval', style: p.__style }),
    drawCircle: (_x: number, _y: number, _r: number, p: any) => calls.push({ op: 'drawCircle', style: p.__style }),
    drawPath: (_path: unknown, p: any) => calls.push({ op: 'drawPath', style: p.__style }),
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
    PathEffect: { MakeDash: () => ({}) },
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
