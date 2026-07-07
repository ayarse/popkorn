import { test, expect } from 'bun:test';
import { Canvas2DRenderer } from './canvas2d';

// A stand-in 2D context that records the order and arguments of the calls
// beginFrame makes, so we can assert the clear happens in device space.
function mockCanvas(width: number, height: number) {
  const calls: Array<{ op: string; args: number[] }> = [];
  const ctx: any = {
    canvas: { width, height },
    globalAlpha: 1,
    setTransform(...args: number[]) { calls.push({ op: 'setTransform', args }); },
    clearRect(...args: number[]) { calls.push({ op: 'clearRect', args }); },
  };
  return { getContext: () => ctx, calls } as any;
}

test('beginFrame resets to identity BEFORE clearing the full backing canvas', () => {
  const canvas = mockCanvas(300, 200);
  const r = new Canvas2DRenderer(canvas);
  r.beginFrame();

  const ops = canvas.calls.map((c: any) => c.op);
  const setIdx = ops.indexOf('setTransform');
  const clrIdx = ops.indexOf('clearRect');

  // The identity reset must precede the clear — otherwise clearRect runs under
  // the leftover viewport transform and misses the letterbox band (stale ghost).
  expect(setIdx).toBeGreaterThanOrEqual(0);
  expect(clrIdx).toBeGreaterThan(setIdx);

  // The reset is the identity matrix, and the clear covers the whole device buffer.
  expect(canvas.calls[setIdx].args).toEqual([1, 0, 0, 1, 0, 0]);
  expect(canvas.calls[clrIdx].args).toEqual([0, 0, 300, 200]);
});

// A stand-in 2D context that only records the stroke state it is asked to set.
function mockStrokeCanvas() {
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    beginPath() {}, arc() {}, stroke() {}, fill() {},
    setLineDash() {},
  };
  return { getContext: () => ctx, ctx } as any;
}

test('strokePath applies lineJoin and miterLimit to the context', () => {
  const canvas = mockStrokeCanvas();
  const r = new Canvas2DRenderer(canvas);
  r.setStroke({ r: 0, g: 0, b: 0, a: 1 }, 16);
  r.setStrokeLineJoin('bevel');
  r.setStrokeMiterLimit(4);
  r.drawCircle(50, 50, 40);
  expect(canvas.ctx.lineJoin).toBe('bevel');
  expect(canvas.ctx.miterLimit).toBe(4);
});
