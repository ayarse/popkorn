import { test, expect } from 'bun:test';
import { Canvas2DRenderer } from './canvas2d';

// A stand-in 2D context that records drawImage calls so we can assert paints.
function mockImageCanvas() {
  const drawCalls: any[][] = [];
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    drawImage(...args: any[]) { drawCalls.push(args); },
  };
  return { getContext: () => ctx, drawCalls } as any;
}

test('whenImagesSettled resolves immediately when no images are pending', async () => {
  const r = new Canvas2DRenderer(mockImageCanvas());
  await r.whenImagesSettled(); // must not hang
});

// The worker path only kicks in when there is no Image constructor (as in bun)
// but fetch + createImageBitmap exist. Stub the decode primitives and verify the
// load settles, caches, and paints the bitmap at its intrinsic size on re-draw.
test('worker path (fetch + createImageBitmap) decodes, settles, and caches', async () => {
  if (typeof Image !== 'undefined') return; // only exercises the worker branch

  const bitmap = { width: 32, height: 16 } as unknown as ImageBitmap;
  const origFetch = globalThis.fetch;
  const origCIB = (globalThis as any).createImageBitmap;
  let fetched = '';
  (globalThis as any).fetch = async (src: string) => {
    fetched = src;
    return { blob: async () => ({}) } as any;
  };
  (globalThis as any).createImageBitmap = async () => bitmap;

  try {
    const canvas = mockImageCanvas();
    const r = new Canvas2DRenderer(canvas);
    const src = 'data:image/png;base64,AAAA';

    // First draw kicks off the decode; nothing paints yet.
    r.drawImage(src, 0, 0, 0, 0);
    expect(canvas.drawCalls.length).toBe(0);

    await r.whenImagesSettled();
    expect(fetched).toBe(src);

    // Re-draw: the decoded bitmap paints at its intrinsic size (w/h <= 0).
    r.drawImage(src, 5, 7, 0, 0);
    expect(canvas.drawCalls.length).toBe(1);
    expect(canvas.drawCalls[0]).toEqual([bitmap, 5, 7, 32, 16]);
  } finally {
    globalThis.fetch = origFetch;
    (globalThis as any).createImageBitmap = origCIB;
  }
});
