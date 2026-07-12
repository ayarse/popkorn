import { test, expect } from 'bun:test';
import { registerConformance, LUMA_COEFFICIENTS } from '@popkorn/player';
import type { ClipObs, ConformanceHarness, ConformanceTrace, PaintObs, MaskObs, NormGradient } from '@popkorn/player';
import type { MaskMode } from '@popkorn/player';
import { SkiaRenderer } from '../src/skia-renderer';

// =============================================================================
// Skia harness
// =============================================================================
//
// Skia is immediate-mode into an SkCanvas; the mock records the draw ops (with
// their reused fill/stroke paint's style, colour, shader and dash) plus the
// saveLayer compositing paints (blend + colour filter) that realize a track
// matte. Unlike the existing skia-renderer test's mock, `Color` echoes the CSS
// string so fill/gradient colours are observable, and the shader factories
// return normalized geometry so gradient realization can be cross-checked.

type SkColorMock = Float32Array & { __css: string };
interface DrawRecord { op: string; style?: number; colorCss?: string; shader?: NormGradient; dash?: number[]; dashOffset?: number; blend?: number }

// SkBlendMode int -> CSS mix-blend-mode keyword (SrcOver/undefined == normal).
const SK_BLEND_TO_CSS: Record<number, string> = {
  24: 'multiply', 14: 'screen', 15: 'overlay', 16: 'darken', 17: 'lighten',
  18: 'color-dodge', 19: 'color-burn', 20: 'hard-light', 21: 'soft-light',
  22: 'difference', 23: 'exclusion', 25: 'hue', 26: 'saturation', 27: 'color',
  28: 'luminosity',
};
interface LayerRecord { op: 'saveLayer'; blend?: number; filter?: unknown }

const SkBlend = { DstIn: 6, DstOut: 8 } as const;

function mockSkia() {
  const draws: DrawRecord[] = [];
  const layers: LayerRecord[] = [];
  const clips: ClipObs[] = [];

  const makePaint = () => {
    const p: any = {};
    p.setAntiAlias = () => p;
    p.setStyle = (s: number) => { p.__style = s; return p; };
    p.setStrokeWidth = () => p;
    p.setStrokeCap = () => p;
    p.setStrokeJoin = () => p;
    p.setStrokeMiter = () => p;
    p.setAlphaf = () => p;
    p.setColor = (c: SkColorMock) => { p.__colorCss = c?.__css; return p; };
    p.setShader = (s: NormGradient) => { p.__shader = s; return p; };
    p.setPathEffect = (e: any) => { p.__dash = e?.__dash; p.__dashOffset = e?.__dashOffset; return p; };
    p.setBlendMode = (b: number) => { p.__blend = b; return p; };
    p.setColorFilter = (f: unknown) => { p.__filter = f; return p; };
    p.reset = () => { p.__style = undefined; p.__colorCss = undefined; p.__shader = undefined; p.__dash = undefined; p.__dashOffset = undefined; p.__blend = undefined; p.__filter = undefined; return p; };
    return p;
  };

  const makePath = () => {
    const path: any = { setFillType: () => path };
    for (const m of ['moveTo', 'lineTo', 'cubicTo', 'quadTo', 'close', 'addCircle', 'ellipse']) path[m] = () => path;
    return path;
  };

  // Snapshot the paint's observable fields at draw time (the paint is reused +
  // reset for the next shape, so we must not hold a live reference).
  const record = (op: string, p: any) => { draws.push({ op, style: p.__style, colorCss: p.__colorCss, shader: p.__shader, dash: p.__dash, dashOffset: p.__dashOffset, blend: p.__blend }); };

  const canvas: any = {
    save: () => {}, restore: () => {}, concat: () => {},
    clipRect: (rect: { x: number; y: number; w: number; h: number }) => clips.push({ type: 'rect', x: rect.x, y: rect.y, width: rect.w, height: rect.h }),
    clipPath: () => clips.push({ type: 'path' }),
    saveLayer: (p: any) => layers.push({ op: 'saveLayer', blend: p?.__blend, filter: p?.__filter }),
    drawRect: (_r: unknown, p: any) => record('drawRect', p),
    drawRRect: (_r: unknown, p: any) => record('drawRRect', p),
    drawOval: (_r: unknown, p: any) => record('drawOval', p),
    drawCircle: (_x: number, _y: number, _r: number, p: any) => record('drawCircle', p),
    drawPath: (_path: unknown, p: any) => record('drawPath', p),
    drawText: (_t: string, _x: number, _y: number, p: any) => record('drawText', p),
    drawImageRect: (_img: unknown, _src: unknown, _dest: unknown, _p: any) => draws.push({ op: 'drawImageRect' }),
  };

  const stops = (colors: SkColorMock[], pos: number[]) => colors.map((c, i) => ({ offset: pos[i], color: c.__css }));

  const Skia: any = {
    Paint: makePaint,
    Color: (css: string) => Object.assign(new Float32Array([0, 0, 0, 1]), { __css: css }) as SkColorMock,
    Path: { Make: makePath },
    XYWHRect: (x: number, y: number, w: number, h: number) => ({ x, y, w, h }),
    RRectXY: (rect: unknown, rx: number, ry: number) => ({ rect, rx, ry }),
    Shader: {
      MakeLinearGradient: (p0: any, p1: any, colors: SkColorMock[], pos: number[]): NormGradient =>
        ({ type: 'linear', coords: [p0.x, p0.y, p1.x, p1.y], stops: stops(colors, pos) }),
      MakeRadialGradient: (c: any, r: number, colors: SkColorMock[], pos: number[]): NormGradient =>
        ({ type: 'radial', coords: [c.x, c.y, r, c.x, c.y], stops: stops(colors, pos) }),
      MakeTwoPointConicalGradient: (f: any, _r0: number, c: any, r: number, colors: SkColorMock[], pos: number[]): NormGradient =>
        ({ type: 'radial', coords: [c.x, c.y, r, f.x, f.y], stops: stops(colors, pos) }),
      // Sweep args: (cx, cy, colors, pos, mode, localMatrix, flags, startDeg, endDeg).
      // Reverse-map to the shared conic form [cx, cy, startAngle(radians)].
      MakeSweepGradient: (cx: number, cy: number, colors: SkColorMock[], pos: number[], _m: number, _lm: unknown, _f: number, startDeg: number): NormGradient =>
        ({ type: 'conic', coords: [cx, cy, (startDeg * Math.PI) / 180], stops: stops(colors, pos) }),
    },
    PathEffect: { MakeDash: (arr: number[], offset?: number) => ({ __dash: arr, __dashOffset: offset ?? 0 }) },
    ColorFilter: { MakeMatrix: (matrix: number[]) => ({ __matrix: matrix }) },
    // A system font manager + font whose measureText reports a fixed advance,
    // so anchor placement and gradient-box geometry are observable in tests.
    FontMgr: { System: () => ({ matchFamilyStyle: (_n: string, _s: unknown) => ({ __typeface: true }) }) },
    Font: (_typeface: unknown, size: number) => ({ __size: size, measureText: (t: string) => ({ width: t.length * size * 0.5 }) }),
    Data: {
      fromBase64: (b64: string) => ({ __b64: b64 }),
      fromURI: (uri: string) => Promise.resolve({ __uri: uri }),
    },
    Image: { MakeImageFromEncoded: (_data: unknown) => ({ width: () => 4, height: () => 4 }) },
  };

  return { Skia, canvas, draws, layers, clips };
}

function skiaMode(blend: number, hasFilter: boolean): MaskMode {
  const invert = blend === SkBlend.DstOut;
  if (hasFilter) return invert ? 'luminance-invert' : 'luminance';
  return invert ? 'alpha-invert' : 'alpha';
}

function skiaTrace(draws: DrawRecord[], layers: LayerRecord[], clips: ClipObs[], width: number, height: number): ConformanceTrace {
  const paints: PaintObs[] = draws.map((d) => {
    const kind = d.style === 1 ? 'stroke' : 'fill';
    const base: PaintObs = d.shader ? { kind, gradient: d.shader } : { kind, color: d.colorCss };
    if (kind === 'stroke') { base.dashArray = d.dash ?? []; base.dashOffset = d.dashOffset ?? 0; }
    const blend = d.blend !== undefined ? SK_BLEND_TO_CSS[d.blend] : undefined;
    if (blend) base.blend = blend as PaintObs['blend'];
    return base;
  });
  // The mask-carrying layer is the one whose paint set a blend mode.
  const masks: MaskObs[] = layers.filter((l) => l.blend !== undefined).map((l) => ({ mode: skiaMode(l.blend!, l.filter != null) }));
  return { paints, masks, clips, width, height };
}

const skiaHarness: ConformanceHarness = {
  backend: 'skia',
  run(ops) {
    const { Skia, canvas, draws, layers, clips } = mockSkia();
    const r = new SkiaRenderer(Skia, { width: 20, height: 20 });
    r.setCanvas(canvas);
    r.beginFrame();
    ops(r);
    r.endFrame();
    return skiaTrace(draws, layers, clips, r.getWidth(), r.getHeight());
  },
};

registerConformance({ test, expect }, skiaHarness);

// =============================================================================
// Expected divergences (documented, NOT unified).
// =============================================================================

// Skia's luminance matte is a colour-matrix (RGB -> alpha via Rec.709 luma). A
// linear matrix cannot express luma*alpha, so unlike Canvas2D (which multiplies
// the mask's own alpha in the luminanceToAlpha pixel pass) Skia IGNORES the
// mask's source alpha. Pin the matrix so a silent change (e.g. someone "fixing"
// it to add an alpha term that Skia can't honour) fails here.
test('divergence [skia] luminance matte uses a pure luma->alpha matrix (ignores source alpha)', () => {
  const { Skia, canvas, layers } = mockSkia();
  const r = new SkiaRenderer(Skia, { width: 20, height: 20 });
  r.setCanvas(canvas);
  r.beginFrame();
  r.compositeMask('luminance', () => r.drawRect(0, 0, 10, 10), () => r.drawRect(0, 0, 8, 8));

  const maskLayer = layers.find((l) => l.blend !== undefined && l.filter != null)!;
  const matrix = (maskLayer.filter as { __matrix: number[] }).__matrix;
  // 4x5 RGBA row-major; the alpha row writes luma into alpha with NO alpha-in
  // -> alpha-out term (index 18 = the A->A coefficient) — the documented limit.
  expect(matrix[15]).toBeCloseTo(LUMA_COEFFICIENTS.r, 6);
  expect(matrix[16]).toBeCloseTo(LUMA_COEFFICIENTS.g, 6);
  expect(matrix[17]).toBeCloseTo(LUMA_COEFFICIENTS.b, 6);
  expect(matrix[18]).toBe(0); // no source-alpha contribution (the divergence)
});

// Text now paints: a filled text node draws once through the system font
// manager, with the fill colour carried on the reused fill paint. (Previously a
// deliberate no-op; the capability landed, so the pin is a real paint assertion.)
test('[skia] drawText paints a filled glyph run', () => {
  const { Skia, canvas, draws } = mockSkia();
  const r = new SkiaRenderer(Skia, { width: 20, height: 20 });
  r.setCanvas(canvas);
  r.beginFrame();
  r.setFill('#ff0000');
  r.drawText('hello', 0, 10, 12, 'sans-serif', 'normal', 'start');
  const text = draws.filter((d) => d.op === 'drawText');
  expect(text.length).toBe(1);
  expect(text[0].colorCss).toBe('#ff0000');
});

// Images now decode + paint. A data: URI decodes synchronously (fromBase64), so
// the first frame after drawImage already paints it (an http URI would go async
// and paint in on a later frame once whenImagesSettled resolves).
test('[skia] drawImage decodes a data URI and paints it', () => {
  const { Skia, canvas, draws } = mockSkia();
  const r = new SkiaRenderer(Skia, { width: 20, height: 20 });
  r.setCanvas(canvas);
  r.beginFrame();
  r.drawImage('data:image/png;base64,AAAA', 0, 0, 10, 10);
  expect(draws.filter((d) => d.op === 'drawImageRect').length).toBe(1);
});
