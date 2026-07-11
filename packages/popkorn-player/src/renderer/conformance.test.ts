import { expect, test } from "bun:test";
import type { MaskMode } from "../scene/types";
import { Canvas2DRenderer } from "./canvas2d";
import type {
  ConformanceHarness,
  ConformanceTrace,
  MaskObs,
  NormGradient,
  PaintObs,
} from "./conformance";
import { registerConformance } from "./conformance";
import { resolveGradient } from "./gradient-geometry";
import type { Renderer } from "./interface";
import { realizeGradientAttrs, SVGRenderer } from "./svg";
import type { GradientData } from "./types";

// =============================================================================
// Canvas2D harness
// =============================================================================
//
// Canvas2D is immediate-mode: it emits native ctx calls, so the recording ctx
// captures fill()/stroke() (with the live fillStyle/strokeStyle/lineDash) as
// paint events, and the compositeMask offscreen blits (gCO) + luminanceToAlpha
// getImageData passes as mask events. A recording buffer is minted per offscreen
// index (real ensureOffscreen returns null under bun), so the mask path runs
// headlessly — the same override the existing canvas2d-mask test uses.

type CanvasEvent =
  | { type: "paint"; index: string | number; obs: PaintObs }
  | { type: "blit"; srcIndex: number; dstIndex: string | number; gco: string }
  | { type: "luma"; index: number };

interface RecGradient {
  __grad: "linear" | "radial" | "conic";
  coords: number[];
  stops: { offset: number; color: string }[];
  addColorStop(offset: number, color: string): void;
}

function normRecGradient(g: RecGradient): NormGradient {
  return { type: g.__grad, coords: g.coords, stops: g.stops };
}

function recCtx(
  width: number,
  height: number,
  index: string | number,
  log: CanvasEvent[],
): any {
  let dash: number[] = [];
  const ctx: any = {
    canvas: { width, height, __index: index },
    fillStyle: "#000000",
    strokeStyle: "#000000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 4,
    lineDashOffset: 0,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    // path building — geometry is irrelevant to the semantics under test
    beginPath() {},
    rect() {},
    roundRect() {},
    arc() {},
    ellipse() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    closePath() {},
    clip() {},
    save() {},
    restore() {},
    setTransform() {},
    transform() {},
    clearRect() {},
    putImageData() {},
    setLineDash(a: number[]) {
      dash = a.slice();
    },
    measureText() {
      return { width: 0 };
    },
    getImageData(_x: number, _y: number, w: number, h: number) {
      if (typeof index === "number") log.push({ type: "luma", index });
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
    createLinearGradient(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ): RecGradient {
      const g: RecGradient = {
        __grad: "linear",
        coords: [x1, y1, x2, y2],
        stops: [],
        addColorStop(o, c) {
          this.stops.push({ offset: o, color: c });
        },
      };
      return g;
    },
    createRadialGradient(
      x0: number,
      y0: number,
      _r0: number,
      x1: number,
      y1: number,
      r1: number,
    ): RecGradient {
      // Canvas args are (fx,fy,0, cx,cy,r); normalize to [cx,cy,r,fx,fy].
      const g: RecGradient = {
        __grad: "radial",
        coords: [x1, y1, r1, x0, y0],
        stops: [],
        addColorStop(o, c) {
          this.stops.push({ offset: o, color: c });
        },
      };
      return g;
    },
    createConicGradient(startAngle: number, x: number, y: number): RecGradient {
      // Canvas args are (startAngle, cx, cy); normalize to [cx,cy,startAngle].
      const g: RecGradient = {
        __grad: "conic",
        coords: [x, y, startAngle],
        stops: [],
        addColorStop(o, c) {
          this.stops.push({ offset: o, color: c });
        },
      };
      return g;
    },
    fill(_rule?: string) {
      const style = ctx.fillStyle;
      const obs: PaintObs =
        style && style.__grad
          ? { kind: "fill", gradient: normRecGradient(style) }
          : { kind: "fill", color: style };
      log.push({ type: "paint", index, obs });
    },
    stroke() {
      const style = ctx.strokeStyle;
      const obs: PaintObs =
        style && style.__grad
          ? {
              kind: "stroke",
              gradient: normRecGradient(style),
              dashArray: dash.slice(),
              dashOffset: ctx.lineDashOffset,
            }
          : {
              kind: "stroke",
              color: style,
              dashArray: dash.slice(),
              dashOffset: ctx.lineDashOffset,
            };
      log.push({ type: "paint", index, obs });
    },
    fillText() {},
    strokeText() {},
    drawImage(src: any) {
      if (src && typeof src.__index === "number") {
        log.push({
          type: "blit",
          srcIndex: src.__index,
          dstIndex: index,
          gco: ctx.globalCompositeOperation,
        });
      }
    },
  };
  return ctx;
}

function canvasTrace(
  log: CanvasEvent[],
  width: number,
  height: number,
): ConformanceTrace {
  const paints = log
    .filter(
      (e): e is Extract<CanvasEvent, { type: "paint" }> =>
        e.type === "paint" && e.index === "main",
    )
    .map((e) => e.obs);
  // Mask modes: each destination-in/out blit is one composite's mask-apply step.
  // luma passes since the previous mode-blit scope this composite (buffers are
  // reused across sequential composites, so membership must be order-scoped).
  const masks: MaskObs[] = [];
  let recentLuma = new Set<number>();
  for (const e of log) {
    if (e.type === "luma") recentLuma.add(e.index);
    else if (e.type === "blit" && e.gco.startsWith("destination")) {
      const luma = recentLuma.has(e.srcIndex);
      const invert = e.gco === "destination-out";
      masks.push({ mode: canvasMode(luma, invert) });
      recentLuma = new Set();
    }
  }
  return { paints, masks, width, height };
}

function canvasMode(luma: boolean, invert: boolean): MaskMode {
  if (luma) return invert ? "luminance-invert" : "luminance";
  return invert ? "alpha-invert" : "alpha";
}

const canvasHarness: ConformanceHarness = {
  backend: "canvas2d",
  run(ops) {
    const log: CanvasEvent[] = [];
    const W = 20,
      H = 20;
    const main = recCtx(W, H, "main", log);
    const r = new Canvas2DRenderer({ getContext: () => main } as any);
    const buffers = new Map<number, any>();
    (r as any).ensureOffscreen = (i: number) => {
      let b = buffers.get(i);
      if (!b) {
        b = recCtx(main.canvas.width, main.canvas.height, i, log);
        buffers.set(i, b);
      }
      return b;
    };
    r.beginFrame();
    ops(r);
    r.endFrame();
    return canvasTrace(log, r.getWidth(), r.getHeight());
  },
};

// =============================================================================
// SVG harness
// =============================================================================
//
// SVG is retained: after a frame it holds a <g>/shape/def tree, so the trace is
// read back from the DOM. Paint order is a single `paint-order` attribute (not
// two calls), so the paints array is synthesized from each shape's fill/stroke
// attrs in that order. Mask modes are reverse-mapped from mask-type + the
// coverage-filter primitive chain.

class FakeElement {
  attrs = new Map<string, string>();
  childNodes: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  textContent = "";
  constructor(public tagName: string) {}
  get firstChild(): FakeElement | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): FakeElement | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  appendChild(c: FakeElement): FakeElement {
    c.remove();
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  insertBefore(c: FakeElement, ref: FakeElement | null): FakeElement {
    c.remove();
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    return c;
  }
  replaceChild(n: FakeElement, o: FakeElement): FakeElement {
    const i = this.childNodes.indexOf(o);
    if (i >= 0) {
      n.remove();
      n.parentNode = this;
      o.parentNode = null;
      this.childNodes[i] = n;
    }
    return o;
  }
  removeChild(c: FakeElement): FakeElement {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
      c.parentNode = null;
    }
    return c;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, String(v));
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
  getAttribute(n: string): string | null {
    return this.attrs.get(n) ?? null;
  }
  setAttributeNS(_ns: string, n: string, v: string): void {
    this.attrs.set(n, String(v));
  }
  addEventListener(): void {}
}

function installFakeDom(): FakeElement {
  (globalThis as { document?: unknown }).document = {
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  };
  const svg = new FakeElement("svg");
  svg.setAttribute("width", "100");
  svg.setAttribute("height", "100");
  return svg;
}

function findAll(
  root: FakeElement,
  pred: (e: FakeElement) => boolean,
): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (e: FakeElement) => {
    if (pred(e)) out.push(e);
    for (const c of e.childNodes) walk(c);
  };
  walk(root);
  return out;
}
function findEl(
  root: FakeElement,
  pred: (e: FakeElement) => boolean,
): FakeElement | null {
  return findAll(root, pred)[0] ?? null;
}

const SHAPE_TAGS = new Set([
  "rect",
  "circle",
  "ellipse",
  "path",
  "text",
  "image",
]);

function svgGradientById(
  defs: FakeElement,
  ref: string,
): NormGradient | undefined {
  const m = ref.match(/^url\(#(.+)\)$/);
  if (!m) return undefined;
  const el = findEl(defs, (e) => e.getAttribute("id") === m[1]);
  if (!el) return undefined;
  const num = (n: string) => Number(el.getAttribute(n));
  const stops = el.childNodes
    .filter((c) => c.tagName === "stop")
    .map((s) => ({
      offset: Number(s.getAttribute("offset")),
      color: s.getAttribute("stop-color") as string,
    }));
  return el.tagName === "linearGradient"
    ? {
        type: "linear",
        coords: [num("x1"), num("y1"), num("x2"), num("y2")],
        stops,
      }
    : {
        type: "radial",
        coords: [num("cx"), num("cy"), num("r"), num("fx"), num("fy")],
        stops,
      };
}

function svgTrace(svg: FakeElement, r: SVGRenderer): ConformanceTrace {
  const defs = svg.childNodes[0];
  const rootG = svg.childNodes[1];
  const paints: PaintObs[] = [];
  for (const el of findAll(rootG, (e) => SHAPE_TAGS.has(e.tagName))) {
    const fillAttr = el.getAttribute("fill");
    const strokeAttr = el.getAttribute("stroke");
    const dashAttr = el.getAttribute("stroke-dasharray");
    const dashArray = dashAttr ? dashAttr.split(" ").map(Number) : [];
    const dashOffAttr = el.getAttribute("stroke-dashoffset");
    const dashOffset = dashOffAttr ? Number(dashOffAttr) : 0;
    const order =
      el.getAttribute("paint-order") === "stroke"
        ? ["stroke", "fill"]
        : ["fill", "stroke"];
    for (const kind of order) {
      if (kind === "fill" && fillAttr && fillAttr !== "none") {
        const grad = fillAttr.startsWith("url(")
          ? svgGradientById(defs, fillAttr)
          : undefined;
        paints.push(
          grad
            ? { kind: "fill", gradient: grad }
            : { kind: "fill", color: fillAttr },
        );
      } else if (kind === "stroke" && strokeAttr && strokeAttr !== "none") {
        const grad = strokeAttr.startsWith("url(")
          ? svgGradientById(defs, strokeAttr)
          : undefined;
        paints.push(
          grad
            ? { kind: "stroke", gradient: grad, dashArray, dashOffset }
            : { kind: "stroke", color: strokeAttr, dashArray, dashOffset },
        );
      }
    }
  }

  const masks: MaskObs[] = findAll(defs, (e) => e.tagName === "mask").map(
    (mask) => ({ mode: svgMaskMode(defs, mask) }),
  );
  return { paints, masks, width: r.getWidth(), height: r.getHeight() };
}

function svgMaskMode(defs: FakeElement, mask: FakeElement): MaskMode {
  // luminance leaves NO mask-type attr; every other mode normalizes to an alpha
  // mask plus an optional coverage filter (see maskModePlumbing).
  if (mask.getAttribute("mask-type") !== "alpha") return "luminance";
  const filterG = findEl(
    mask,
    (e) => e.tagName === "g" && e.getAttribute("filter") !== null,
  );
  const filterRef = filterG?.getAttribute("filter");
  if (!filterRef) return "alpha";
  const m = filterRef.match(/^url\(#(.+)\)$/);
  const filter = m ? findEl(defs, (e) => e.getAttribute("id") === m[1]) : null;
  const hasLuma = filter
    ? findEl(
        filter,
        (e) =>
          e.tagName === "feColorMatrix" &&
          e.getAttribute("type") === "luminanceToAlpha",
      ) !== null
    : false;
  return hasLuma ? "luminance-invert" : "alpha-invert";
}

const svgHarness: ConformanceHarness = {
  backend: "svg",
  run(ops) {
    const svg = installFakeDom();
    const r = new SVGRenderer(svg as unknown as SVGSVGElement);
    r.resize(100, 100);
    r.beginFrame();
    ops(r);
    r.endFrame();
    return svgTrace(svg, r);
  },
};

// =============================================================================
// Run the shared conformance table against both player-package backends.
// =============================================================================

registerConformance({ test, expect }, canvasHarness);
registerConformance({ test, expect }, svgHarness);

// =============================================================================
// Expected divergences (documented, NOT unified — a silent change fails here).
// =============================================================================

// SVG has no headless text metrics, so it sizes a text node's gradient box by a
// 0.6em advance approximation, where Canvas2D uses measureText. This is a
// deliberate divergence: the two backends realize DIFFERENT gradient geometry
// for the same text fill.
// NOTE: the cross-backend text-gradient GEOMETRY check is DROPPED — Canvas's
// measureText is unavailable under bun (recCtx returns width 0), so there is no
// headless truth to compare SVG's approximation against. We pin SVG's own rule.
test("divergence [svg] text gradient bounds use the 0.6em advance approximation", () => {
  const svg = installFakeDom();
  const r = new SVGRenderer(svg as unknown as SVGSVGElement);
  r.resize(100, 100);
  const g: GradientData = {
    type: "linear-gradient",
    angle: 90,
    stops: [
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ],
  };

  r.beginFrame();
  r.setFill(null);
  r.setFillGradient(g);
  r.drawText("ABCD", 10, 40, 20, "sans-serif", "normal", "start");
  r.endFrame();

  const defs = svg.childNodes[0] as FakeElement;
  const grad = svgGradientById(
    defs,
    `url(#${(findEl(defs, (e) => e.tagName === "linearGradient") as FakeElement).getAttribute("id")})`,
  )!;
  // Bounds mirror svg.ts drawText: width = len*fontSize*0.6, height = fontSize,
  // box origin (x, y-fontSize). Assert the gradient matches resolveGradient over
  // that approximate box, proving the backend consumes the 0.6em rule.
  const approxBox = {
    x: 10,
    y: 40 - 20,
    width: "ABCD".length * 20 * 0.6,
    height: 20,
  };
  const rg = resolveGradient(g, approxBox);
  const expected = rg.type === "linear" ? [rg.x1, rg.y1, rg.x2, rg.y2] : [];
  for (let i = 0; i < expected.length; i++)
    expect(grad.coords[i]).toBeCloseTo(expected[i], 4);
});

// SVG has no conic-gradient primitive, so the backend degrades a conic paint to
// a flat fill of its middle stop (see svg.conicFallbackColor). Deliberate: the
// same GradientData paints an angular sweep on Canvas/Skia but a solid on SVG.
test("divergence [svg] conic gradient degrades to a flat middle-stop fill", () => {
  const g: GradientData = {
    type: "conic-gradient",
    from: 0,
    stops: [
      { offset: 0, color: "#ff0000" },
      { offset: 0.5, color: "#00ff00" },
      { offset: 1, color: "#0000ff" },
    ],
  };
  const s = svgHarness.run((r) => {
    r.setFill(null);
    r.setFillGradient(g);
    r.drawRect(0, 0, 20, 10);
  });
  const fill = s.paints.find((p) => p.kind === "fill");
  // Middle stop (index floor((3-1)/2) = 1) is #00ff00; NOT a url() gradient ref.
  expect(fill?.gradient).toBeUndefined();
  expect(fill?.color).toBe("#00ff00");
});

// A sanity check that the canvas + svg gradient realizations genuinely agree on
// the shared resolveGradient output (the anti-drift the table enforces per-case;
// this is a direct, backend-to-backend cross-check on one gradient).
test("canvas and svg realize identical linear-gradient endpoints", () => {
  const g: GradientData = {
    type: "linear-gradient",
    angle: 45,
    stops: [
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ],
  };
  const box = { x: 0, y: 0, width: 20, height: 10 };
  const c = canvasHarness.run((r) => {
    r.setFill(null);
    r.setFillGradient(g);
    r.drawRect(0, 0, 20, 10);
  });
  const s = svgHarness.run((r) => {
    r.setFill(null);
    r.setFillGradient(g);
    r.drawRect(0, 0, 20, 10);
  });
  const cg = c.paints.find((p) => p.kind === "fill")!.gradient!;
  const sg = s.paints.find((p) => p.kind === "fill")!.gradient!;
  const attrs = realizeGradientAttrs(g, box); // shared realizer both consume
  expect(attrs.tag).toBe("linearGradient");
  for (let i = 0; i < 4; i++) expect(cg.coords[i]).toBeCloseTo(sg.coords[i], 4);
});
