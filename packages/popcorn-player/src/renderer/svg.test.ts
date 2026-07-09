import { test, expect } from 'bun:test';
import { pathToD, matrixToSVG, realizeGradientAttrs, diffAttr, maskModePlumbing, deviceRegionInUserSpace, SVGRenderer } from './svg';
import type { PathCommand, Matrix3x3, GradientData } from './types';
import type { Renderer } from './interface';
import { RenderLoop } from '../runtime/loop';
import { createSceneNode, snapshotNode } from '../scene/types';
import type { SceneNode } from '../scene/types';

// --- pathToD -----------------------------------------------------------------

test('pathToD: serializes the SVG path grammar 1:1', () => {
  const cmds: PathCommand[] = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 10, y: 20 },
    { type: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
    { type: 'Q', x1: 7, y1: 8, x: 9, y: 10 },
    { type: 'A', rx: 5, ry: 5, angle: 0, largeArc: true, sweep: false, x: 12, y: 13 },
    { type: 'Z' },
  ];
  expect(pathToD(cmds)).toBe('M0 0L10 20C1 2 3 4 5 6Q7 8 9 10A5 5 0 1 0 12 13Z');
});

test('pathToD: H/V/S/T and negative coords', () => {
  const cmds: PathCommand[] = [
    { type: 'M', x: -1, y: -2 },
    { type: 'H', x: 5 },
    { type: 'V', y: 6 },
    { type: 'S', x2: 1, y2: 2, x: 3, y: 4 },
    { type: 'T', x: 8, y: 9 },
  ];
  expect(pathToD(cmds)).toBe('M-1 -2H5V6S1 2 3 4T8 9');
});

// --- matrixToSVG -------------------------------------------------------------

test('matrixToSVG: uses Canvas setTransform arg order (a,b,c,d,e,f)', () => {
  // Matrix3x3 is [a, b, tx, c, d, ty, 0, 0, 1].
  const m: Matrix3x3 = [2, 3, 100, 4, 5, 200, 0, 0, 1];
  // SVG matrix(a,b,c,d,e,f) = (m0, m3, m1, m4, m2, m5).
  expect(matrixToSVG(m)).toBe('matrix(2,4,3,5,100,200)');
});

// --- realizeGradientAttrs ----------------------------------------------------

test('realizeGradientAttrs: explicit from/to linear uses userSpaceOnUse endpoints', () => {
  const g: GradientData = {
    type: 'linear-gradient', angle: 0,
    from: { x: 1, y: 2 }, to: { x: 3, y: 4 },
    stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
  };
  const r = realizeGradientAttrs(g, { x: 0, y: 0, width: 10, height: 10 });
  expect(r.tag).toBe('linearGradient');
  expect(r.coords).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
  expect(r.stops).toEqual([{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }]);
});

test('realizeGradientAttrs: angle-based linear matches Canvas bbox math', () => {
  // 90deg (points right): dx=sin=1, dy=-cos=0 -> horizontal across the box.
  const g: GradientData = { type: 'linear-gradient', angle: 90, stops: [{ offset: 0, color: 'red' }] };
  const r = realizeGradientAttrs(g, { x: 0, y: 0, width: 20, height: 10 });
  expect(r.coords.x1).toBeCloseTo(0, 6);
  expect(r.coords.x2).toBeCloseTo(20, 6);
  expect(r.coords.y1).toBeCloseTo(5, 6);
  expect(r.coords.y2).toBeCloseTo(5, 6);
});

test('realizeGradientAttrs: explicit radial with focal', () => {
  const g: GradientData = {
    type: 'radial-gradient', radius: 30, at: { x: 5, y: 6 }, focal: { x: 7, y: 8 },
    stops: [{ offset: 0, color: 'white' }, { offset: 1, color: 'black' }],
  };
  const r = realizeGradientAttrs(g, { x: 0, y: 0, width: 10, height: 10 });
  expect(r.tag).toBe('radialGradient');
  expect(r.coords).toEqual({ cx: 5, cy: 6, r: 30, fx: 7, fy: 8 });
});

test('realizeGradientAttrs: bbox radial half-diagonal when no explicit geometry', () => {
  const g: GradientData = { type: 'radial-gradient', stops: [{ offset: 0, color: 'red' }] };
  const r = realizeGradientAttrs(g, { x: 0, y: 0, width: 6, height: 8 });
  expect(r.coords.cx).toBe(3);
  expect(r.coords.cy).toBe(4);
  expect(r.coords.r).toBeCloseTo(5, 6); // hypot(6,8)/2
});

test('realizeGradientAttrs: rgba/hex8 stops split into stop-color + stop-opacity', () => {
  const g: GradientData = {
    type: 'linear-gradient', angle: 0, from: { x: 0, y: 0 }, to: { x: 1, y: 1 },
    stops: [
      { offset: 0, color: 'rgba(255, 0, 0, 0.5)' },
      { offset: 1, color: '#00ff0080' },
    ],
  };
  const r = realizeGradientAttrs(g, { x: 0, y: 0, width: 1, height: 1 });
  expect(r.stops[0]).toEqual({ offset: 0, color: 'rgb(255, 0, 0)', opacity: 0.5 });
  expect(r.stops[1].color).toBe('rgb(0, 255, 0)');
  expect(r.stops[1].opacity).toBeCloseTo(128 / 255, 6);
});

// --- diffAttr ----------------------------------------------------------------

function fakeEl() {
  return {
    sets: [] as [string, string][],
    removes: [] as string[],
    setAttribute(n: string, v: string) { this.sets.push([n, v]); },
    removeAttribute(n: string) { this.removes.push(n); },
  };
}

test('diffAttr: writes only on change, removes on null, and caches', () => {
  const el = fakeEl();
  const cache = new Map<string, string>();

  diffAttr(el, cache, 'x', '1');
  diffAttr(el, cache, 'x', '1'); // unchanged -> no write
  expect(el.sets).toEqual([['x', '1']]);

  diffAttr(el, cache, 'x', '2'); // changed
  expect(el.sets).toEqual([['x', '1'], ['x', '2']]);

  diffAttr(el, cache, 'x', null); // remove
  expect(el.removes).toEqual(['x']);
  diffAttr(el, cache, 'x', null); // already absent -> no-op
  expect(el.removes).toEqual(['x']);
});

// --- maskModePlumbing --------------------------------------------------------

test('maskModePlumbing: non-inverted modes pick mask-type, no filter', () => {
  expect(maskModePlumbing('alpha')).toEqual({ maskType: 'alpha', filter: null });
  expect(maskModePlumbing('luminance')).toEqual({ maskType: 'luminance', filter: null });
});

test('maskModePlumbing: inverted modes normalize to an alpha mask + flip filter', () => {
  // Inverts always read the alpha channel; the filter writes the flipped
  // coverage (and, over the widened region, coverage 1 into empty area).
  expect(maskModePlumbing('alpha-invert')).toEqual({ maskType: 'alpha', filter: ['invertAlpha'] });
  expect(maskModePlumbing('luminance-invert')).toEqual({ maskType: 'alpha', filter: ['luminanceToAlpha', 'invertAlpha'] });
});

// --- deviceRegionInUserSpace -------------------------------------------------

test('deviceRegionInUserSpace: identity covers the device rect exactly', () => {
  const r = deviceRegionInUserSpace([1, 0, 0, 0, 1, 0, 0, 0, 1], 100, 60);
  expect(r).toEqual({ x: 0, y: 0, width: 100, height: 60 });
});

test('deviceRegionInUserSpace: inverse of a translate+scale maps the surface back', () => {
  // World = translate(20,10)·scale(2): inverse maps device (0,0)->(-10,-5),
  // (100,60)->(40,25). Region covers where the mask source can land in user space.
  const inv: Matrix3x3 = [0.5, 0, -10, 0, 0.5, -5, 0, 0, 1];
  const r = deviceRegionInUserSpace(inv, 100, 60);
  expect(r.x).toBeCloseTo(-10, 6);
  expect(r.y).toBeCloseTo(-5, 6);
  expect(r.width).toBeCloseTo(50, 6);
  expect(r.height).toBeCloseTo(30, 6);
});

// --- fake-DOM structural tests for the retained SVGRenderer ------------------

class FakeElement {
  attrs = new Map<string, string>();
  childNodes: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  textContent = '';
  constructor(public tagName: string) {}
  get firstChild(): FakeElement | null { return this.childNodes[0] ?? null; }
  get nextSibling(): FakeElement | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  appendChild(c: FakeElement): FakeElement { c.remove(); c.parentNode = this; this.childNodes.push(c); return c; }
  insertBefore(c: FakeElement, ref: FakeElement | null): FakeElement {
    c.remove(); c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    return c;
  }
  replaceChild(n: FakeElement, o: FakeElement): FakeElement {
    const i = this.childNodes.indexOf(o);
    if (i >= 0) { n.remove(); n.parentNode = this; o.parentNode = null; this.childNodes[i] = n; }
    return o;
  }
  removeChild(c: FakeElement): FakeElement { const i = this.childNodes.indexOf(c); if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; } return c; }
  remove(): void { this.parentNode?.removeChild(this); }
  setAttribute(n: string, v: string): void { this.attrs.set(n, String(v)); }
  removeAttribute(n: string): void { this.attrs.delete(n); }
  getAttribute(n: string): string | null { return this.attrs.get(n) ?? null; }
  setAttributeNS(_ns: string, n: string, v: string): void { this.attrs.set(n, String(v)); }
  addEventListener(): void {}
}

function installFakeDom(): FakeElement {
  (globalThis as { document?: unknown }).document = {
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  };
  const svg = new FakeElement('svg');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '100');
  return svg;
}

// Depth-first search for the first descendant matching a predicate.
function findEl(root: FakeElement, pred: (e: FakeElement) => boolean): FakeElement | null {
  if (pred(root)) return root;
  for (const c of root.childNodes) { const hit = findEl(c, pred); if (hit) return hit; }
  return null;
}
function findAll(root: FakeElement, pred: (e: FakeElement) => boolean): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (e: FakeElement) => { if (pred(e)) out.push(e); for (const c of e.childNodes) walk(c); };
  walk(root);
  return out;
}
function makeRenderer(svg: FakeElement) {
  const r = new SVGRenderer(svg as unknown as SVGSVGElement);
  r.resize(100, 100);
  return { r, defs: svg.childNodes[0], rootG: svg.childNodes[1] };
}

test('compositeMask (alpha): builds an alpha <mask> and points the content wrapper at it', () => {
  const svg = installFakeDom();
  const { r, defs, rootG } = makeRenderer(svg);

  r.beginFrame();
  r.compositeMask(
    'alpha',
    () => { r.beginNode('n0'); r.drawRect(0, 0, 10, 10); r.endNode(); },
    () => { r.beginNode('n1'); r.drawCircle(5, 5, 5); r.endNode(); },
  );
  r.endFrame();

  const mask = findEl(defs, (e) => e.tagName === 'mask');
  expect(mask).toBeTruthy();
  expect(mask!.getAttribute('mask-type')).toBe('alpha');
  expect(mask!.getAttribute('style')).toBe('mask-type:alpha');
  expect(mask!.getAttribute('maskUnits')).toBe('userSpaceOnUse');
  expect(mask!.getAttribute('maskContentUnits')).toBe('userSpaceOnUse');
  // Region covers the whole device surface (identity CTM at the root).
  expect([mask!.getAttribute('x'), mask!.getAttribute('y'), mask!.getAttribute('width'), mask!.getAttribute('height')])
    .toEqual(['0', '0', '100', '100']);

  // A wrapper <g> in the tree references the mask and holds the content node.
  const wrapper = findEl(rootG, (e) => e.tagName === 'g' && e.getAttribute('mask') === `url(#${mask!.getAttribute('id')})`);
  expect(wrapper).toBeTruthy();
  expect(findEl(wrapper!, (e) => e.tagName === 'rect')).toBeTruthy();

  // The mask source (circle) lives inside the <mask>, not the tree.
  expect(findEl(mask!, (e) => e.tagName === 'circle')).toBeTruthy();
  expect(findEl(rootG, (e) => e.tagName === 'circle')).toBeNull();

  // No coverage filter for a non-inverted mode.
  expect(findEl(defs, (e) => e.tagName === 'filter')).toBeNull();
});

test('compositeMask (luminance-invert): alpha mask + luminanceToAlpha->invert filter over the widened region', () => {
  const svg = installFakeDom();
  const { r, defs } = makeRenderer(svg);

  r.beginFrame();
  r.compositeMask(
    'luminance-invert',
    () => { r.beginNode('n0'); r.drawRect(0, 0, 10, 10); r.endNode(); },
    () => { r.beginNode('n1'); r.drawCircle(5, 5, 5); r.endNode(); },
  );
  r.endFrame();

  const mask = findEl(defs, (e) => e.tagName === 'mask')!;
  expect(mask.getAttribute('mask-type')).toBe('alpha'); // inverts read alpha
  const filter = findEl(defs, (e) => e.tagName === 'filter')!;
  expect(filter).toBeTruthy();
  expect(filter.getAttribute('filterUnits')).toBe('userSpaceOnUse');
  expect(filter.getAttribute('color-interpolation-filters')).toBe('sRGB');
  // Filter region matches the mask region (covers empty area -> coverage 1).
  expect(filter.getAttribute('width')).toBe('100');
  // Primitive chain: luminanceToAlpha then feFuncA table "1 0".
  const cm = findEl(filter, (e) => e.tagName === 'feColorMatrix')!;
  expect(cm.getAttribute('type')).toBe('luminanceToAlpha');
  const funcA = findEl(filter, (e) => e.tagName === 'feFuncA')!;
  expect(funcA.getAttribute('type')).toBe('table');
  expect(funcA.getAttribute('tableValues')).toBe('1 0');
  // The mask's inner group references the filter.
  const filterG = findEl(mask, (e) => e.tagName === 'g' && e.getAttribute('filter') === `url(#${filter.getAttribute('id')})`);
  expect(filterG).toBeTruthy();
});

test('compositeMask: an unvisited matte is swept from defs next frame', () => {
  const svg = installFakeDom();
  const { r, defs } = makeRenderer(svg);

  r.beginFrame();
  r.compositeMask('alpha', () => { r.beginNode('n0'); r.drawRect(0, 0, 10, 10); r.endNode(); }, () => { r.beginNode('n1'); r.drawCircle(5, 5, 5); r.endNode(); });
  r.endFrame();
  expect(findAll(defs, (e) => e.tagName === 'mask').length).toBe(1);

  // Next frame renders nothing -> the mask GCs.
  r.beginFrame();
  r.endFrame();
  expect(findAll(defs, (e) => e.tagName === 'mask').length).toBe(0);
});

test('compositeMask: a source shared by two masked nodes gets an independent copy per mask, with live transforms in each', () => {
  const svg = installFakeDom();
  const { r, defs } = makeRenderer(svg);

  // Two masked nodes (nA, nB) sharing ONE mask source (scene key 'nSrc'), the way
  // loop.renderMask re-renders the same source subtree inside each dependent's
  // composite. Before the per-mask key namespacing, the source's retained <g> was
  // yanked from mask A's <mask> into mask B's each frame — only B kept content.
  const paint = (srcLocal: Matrix3x3) => {
    r.beginFrame();
    for (const contentKey of ['nA', 'nB']) {
      r.compositeMask(
        'alpha',
        () => { r.beginNode(contentKey); r.drawRect(0, 0, 10, 10); r.endNode(); },
        () => {
          r.beginNode('nSrc');
          r.save(); r.transform(srcLocal);
          r.drawCircle(5, 5, 5);
          r.restore(); r.endNode();
        },
      );
    }
    r.endFrame();
  };

  paint([1, 0, 10, 0, 1, 0, 0, 0, 1]); // source local = translate(10,0)

  // One <mask> per masked node, each holding its OWN copy of the source circle.
  const masks = findAll(defs, (e) => e.tagName === 'mask');
  expect(masks.length).toBe(2);
  const circles = masks.map((m) => findEl(m, (e) => e.tagName === 'circle'));
  expect(circles.every((c) => c !== null)).toBe(true);
  // The source-node <g> (the circle's parent) carries the source transform in both.
  for (const c of circles) expect(c!.parentNode!.getAttribute('transform')).toBe('matrix(1,0,0,1,10,0)');

  // Next frame, a new source transform updates BOTH copies (neither is stale).
  paint([1, 0, 20, 0, 1, 0, 0, 0, 1]);
  const masks2 = findAll(defs, (e) => e.tagName === 'mask');
  expect(masks2.length).toBe(2);
  for (const m of masks2) {
    const c = findEl(m, (e) => e.tagName === 'circle');
    expect(c).toBeTruthy();
    expect(c!.parentNode!.getAttribute('transform')).toBe('matrix(1,0,0,1,20,0)');
  }
});

test('compositeFilter: wraps content in a CSS-filtered group; nests a matte inside', () => {
  const svg = installFakeDom();
  const { r, defs, rootG } = makeRenderer(svg);

  expect(r.supportsFilter()).toBe(true);
  expect(r.filtersUseUserSpace()).toBe(true);

  r.beginFrame();
  // A filtered node whose subtree is itself matted (filter is the outer wrapper).
  r.compositeFilter('blur(2px)', () => {
    r.compositeMask(
      'alpha',
      () => { r.beginNode('n0'); r.drawRect(0, 0, 10, 10); r.endNode(); },
      () => { r.beginNode('n1'); r.drawCircle(5, 5, 5); r.endNode(); },
    );
  });
  r.endFrame();

  // Outer wrapper carries the CSS filter as a style (not the presentation attr).
  const filtered = findEl(rootG, (e) => e.tagName === 'g' && e.getAttribute('style') === 'filter: blur(2px)');
  expect(filtered).toBeTruthy();
  // The mask wrapper is nested INSIDE the filtered group (mask composited first).
  const maskId = findEl(defs, (e) => e.tagName === 'mask')!.getAttribute('id');
  const maskWrapper = findEl(filtered!, (e) => e.tagName === 'g' && e.getAttribute('mask') === `url(#${maskId})`);
  expect(maskWrapper).toBeTruthy();
  expect(findEl(maskWrapper!, (e) => e.tagName === 'rect')).toBeTruthy();
});

test('setSize: writes a device-px viewBox so DPR scaling inverts on the CSS box', () => {
  const svg = installFakeDom();
  const { r } = makeRenderer(svg);
  r.resize(1411, 1140);
  expect(svg.getAttribute('width')).toBe('1411');
  expect(svg.getAttribute('height')).toBe('1140');
  expect(svg.getAttribute('viewBox')).toBe('0 0 1411 1140');
});

test('rebuild on the same <svg>: exactly one defs + one root <g>, no duplicate ids', () => {
  const svg = installFakeDom();
  const grad: GradientData = {
    type: 'linear-gradient', angle: 0, from: { x: 0, y: 0 }, to: { x: 10, y: 10 },
    stops: [{ offset: 0, color: 'red' }, { offset: 1, color: 'blue' }],
  };
  const paintGradientScene = (r: SVGRenderer) => {
    r.beginFrame();
    r.beginNode('n0');
    r.setFillGradient(grad);
    r.drawRect(0, 0, 10, 10);
    r.endNode();
    r.endFrame();
  };

  const first = makeRenderer(svg).r;
  paintGradientScene(first);
  // Second renderer over the SAME element (a scene swap in the component).
  const second = makeRenderer(svg).r;
  paintGradientScene(second);

  // Old defs/root <g> were cleared: exactly one of each survives.
  expect(svg.childNodes.filter((e) => e.tagName === 'defs').length).toBe(1);
  expect(svg.childNodes.filter((e) => e.tagName === 'g').length).toBe(1);

  // Every id in the surface is unique (generation prefix defeats key collisions).
  const ids = findAll(svg, (e) => e.getAttribute('id') !== null).map((e) => e.getAttribute('id')!);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
});

// --- loop-level beginNode/endNode bracket ------------------------------------

// Records the beginNode/endNode stream so we can assert nesting + key stability.
type Ev = { t: 'begin'; key: string } | { t: 'end' };
function bracketRecorder(): Renderer & { evs: Ev[]; keysInOrder: string[] } {
  const noop = () => {};
  return {
    evs: [],
    keysInOrder: [],
    beginNode(key: string) { this.evs.push({ t: 'begin', key }); this.keysInOrder.push(key); },
    endNode() { this.evs.push({ t: 'end' }); },
    clear: noop, beginFrame: noop, endFrame: noop,
    drawRect: noop, drawCircle: noop, drawEllipse: noop, drawPath: noop, drawText: noop, drawImage: noop,
    clip: noop,
    compositeMask: (_m, drawContent, drawMask) => { drawContent(); drawMask(); },
    setFill: noop, setFillGradient: noop, setStroke: noop, setStrokeGradient: noop,
    setStrokeLineCap: noop, setStrokeLineJoin: noop, setStrokeMiterLimit: noop,
    setTrim: noop, setDash: noop, setFillRule: noop, setPaintOrder: noop, setOpacity: noop,
    save: noop, restore: noop, transform: noop, setTransform: noop,
    getWidth: () => 100, getHeight: () => 100,
  } as unknown as Renderer & { evs: Ev[]; keysInOrder: string[] };
}

// r(group) -> [ g1(group) -> [ c1(circle) ], c2(circle-with-same-id-as-c1) ]
function nestedScene(): SceneNode {
  const r = createSceneNode('r', 'group');
  const g1 = createSceneNode('g1', 'group');
  const c1 = createSceneNode('dot', 'circle');
  c1.shapeData = { type: 'circle', cx: 0, cy: 0, r: 5 };
  const c2 = createSceneNode('dot', 'circle'); // deliberately duplicate id
  c2.shapeData = { type: 'circle', cx: 10, cy: 10, r: 5 };
  for (const n of [r, g1, c1, c2]) n.base = snapshotNode(n);
  c1.parent = g1; g1.children.push(c1);
  g1.parent = r; c2.parent = r;
  r.children.push(g1, c2);
  return r;
}

test('render walk brackets nodes with nested, stable keys across seeks', () => {
  const renderer = bracketRecorder();
  const loop = new RenderLoop(renderer);
  loop.setScene(nestedScene());

  loop.seek(0);
  const first = renderer.evs.slice();

  // Nesting mirrors the tree: begin r, begin g1, begin c1, end, end(g1), begin c2, end, end(r).
  const shape = first.map((e) => (e.t === 'begin' ? `+${e.key}` : '-'));
  expect(shape).toEqual([
    '+n0', '+n1', '+n2', '-', '-', '+n3', '-', '-',
  ]);

  // Duplicate scene ids still get distinct, stable keys (c1=n2, c2=n3).
  expect(renderer.keysInOrder).toEqual(['n0', 'n1', 'n2', 'n3']);

  // Balanced brackets.
  let depth = 0, maxDepth = 0;
  for (const e of first) { if (e.t === 'begin') { depth++; maxDepth = Math.max(maxDepth, depth); } else depth--; }
  expect(depth).toBe(0);
  expect(maxDepth).toBe(3);

  // Keys are identical on a second seek (retained backend can reuse elements).
  renderer.evs.length = 0;
  renderer.keysInOrder.length = 0;
  loop.seek(100);
  expect(renderer.evs).toEqual(first);
});
