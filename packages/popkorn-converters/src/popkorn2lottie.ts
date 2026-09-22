// Popkorn -> Lottie by sampling the live runtime per frame (no CSS re-mapping). Browser-safe.
import { parse, type Value, type VariableDefinition } from "@popkorn/parser";
import {
  AnimationScheduler,
  applyCommandsToPath,
  buildSceneGraph,
  computeLocalMatrix,
  computePathBounds,
  computeSceneDuration,
  type GradientData,
  type Matrix3x3,
  type PathCommand,
  type PathSink,
  parseColor,
  polystarToCommands,
  type Renderer,
  RenderLoop,
  readsInput,
  resolveGradient,
  resolveTransformOrigin,
  roundedRectPath,
  type SceneNode,
  type ShapeData,
} from "@popkorn/player";

export type LottieJson = Record<string, unknown>;

type Vec = number[];
type Item = Record<string, unknown>;

interface Contour {
  c: boolean;
  v: Vec[];
  i: Vec[];
  o: Vec[];
}

interface Snap {
  m: Matrix3x3;
  anchor: Vec;
  alpha: number;
  fill: string | null;
  stroke: string | null;
  fillG: GradientData | null;
  strokeG: GradientData | null;
  strokeWidth: number;
  trim: Vec; // [start, end, offset] fractions
  dashOffset: number;
  shape: ShapeData;
}

interface Rec {
  node: SceneNode;
  snaps: Snap[];
  order: SceneNode[]; // children in frame-0 paint order
  orderKey: string;
}

const MAX_FRAMES = 3600;
// Keyframe-reduction tolerances: px/deg/% channels, opacity (0-100), colors (0-1).
const EPS = 0.05;
const EPS_OPACITY = 0.25;
const EPS_COLOR = 0.002;
const r3 = (x: number) => {
  const v = Math.round(x * 1000) / 1000;
  return Object.is(v, -0) || !Number.isFinite(v) ? 0 : v;
};

/** Headless renderer: the walk only needs to resolve state, not paint. */
function nullRenderer(w: number, h: number): Renderer {
  const noop = () => {};
  return new Proxy({} as Renderer, {
    get: (_, k) =>
      k === "getWidth"
        ? () => w
        : k === "getHeight"
          ? () => h
          : k === "supportsFilter"
            ? () => true
            : noop,
  });
}

// Geometry: PathCommand[] -> Lottie contours (cubic vertices + tangents)

class ContourSink implements PathSink {
  contours: Contour[] = [];
  private cur: Contour | null = null;
  private x = 0;
  private y = 0;

  private start(x: number, y: number) {
    this.cur = { c: false, v: [[x, y]], i: [[0, 0]], o: [[0, 0]] };
    this.contours.push(this.cur);
    this.x = x;
    this.y = y;
  }
  private ensure(): Contour {
    if (!this.cur) this.start(this.x, this.y);
    return this.cur!;
  }
  moveTo(x: number, y: number) {
    this.start(x, y);
  }
  lineTo(x: number, y: number) {
    const c = this.ensure();
    c.v.push([x, y]);
    c.i.push([0, 0]);
    c.o.push([0, 0]);
    this.x = x;
    this.y = y;
  }
  bezierCurveTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ) {
    const c = this.ensure();
    const n = c.v.length - 1;
    c.o[n] = [c1x - c.v[n][0], c1y - c.v[n][1]];
    c.v.push([x, y]);
    c.i.push([c2x - x, c2y - y]);
    c.o.push([0, 0]);
    this.x = x;
    this.y = y;
  }
  quadraticCurveTo(qx: number, qy: number, x: number, y: number) {
    const x0 = this.x;
    const y0 = this.y;
    this.bezierCurveTo(
      x0 + (2 / 3) * (qx - x0),
      y0 + (2 / 3) * (qy - y0),
      x + (2 / 3) * (qx - x),
      y + (2 / 3) * (qy - y),
      x,
      y,
    );
  }
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rot: number,
    a0: number,
    a1: number,
    ccw = false,
  ) {
    const TAU = Math.PI * 2;
    let sweep = a1 - a0;
    if (!ccw && sweep >= TAU) sweep = TAU;
    else if (ccw && sweep <= -TAU) sweep = -TAU;
    else if (!ccw) sweep = ((sweep % TAU) + TAU) % TAU;
    else sweep = -((((a0 - a1) % TAU) + TAU) % TAU);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const pt = (t: number) => [
      cx + rx * Math.cos(t) * cr - ry * Math.sin(t) * sr,
      cy + rx * Math.cos(t) * sr + ry * Math.sin(t) * cr,
    ];
    const dt = (t: number) => [
      -rx * Math.sin(t) * cr - ry * Math.cos(t) * sr,
      -rx * Math.sin(t) * sr + ry * Math.cos(t) * cr,
    ];
    const [sx, sy] = pt(a0);
    if (!this.cur) this.start(sx, sy);
    else if (Math.hypot(sx - this.x, sy - this.y) > 1e-6) this.lineTo(sx, sy);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const d = sweep / n;
    const k = (4 / 3) * Math.tan(d / 4);
    for (let s = 0; s < n; s++) {
      const t1 = a0 + s * d;
      const t2 = t1 + d;
      const [p1x, p1y] = pt(t1);
      const [d1x, d1y] = dt(t1);
      const [p2x, p2y] = pt(t2);
      const [d2x, d2y] = dt(t2);
      this.bezierCurveTo(
        p1x + k * d1x,
        p1y + k * d1y,
        p2x - k * d2x,
        p2y - k * d2y,
        p2x,
        p2y,
      );
    }
  }
  closePath() {
    const c = this.cur;
    if (!c) return;
    c.c = true;
    const n = c.v.length - 1;
    if (
      n > 0 &&
      Math.hypot(c.v[n][0] - c.v[0][0], c.v[n][1] - c.v[0][1]) < 1e-6
    ) {
      c.i[0] = c.i[n];
      c.v.pop();
      c.i.pop();
      c.o.pop();
    }
    this.x = c.v[0][0];
    this.y = c.v[0][1];
    this.cur = null;
  }
}

function toContours(cmds: PathCommand[]): Contour[] {
  const sink = new ContourSink();
  applyCommandsToPath(sink, cmds);
  return sink.contours.filter((c) => c.v.length > 1);
}

/** Commands for a shape, matching the outline the Canvas2D backend traces. */
function shapeCommands(sd: ShapeData): PathCommand[] | null {
  switch (sd.type) {
    case "path":
      return sd.commands;
    case "star":
    case "polygon":
      return polystarToCommands(sd);
    case "rect": {
      const { x, y, width: w, height: h } = sd;
      if (sd.cornerRadii) return roundedRectPath(x, y, w, h, sd.cornerRadii);
      const r = cornerRadius(sd);
      if (r > 0) return roundedRectPath(x, y, w, h, [r, r, r, r]);
      return [
        { type: "M", x, y },
        { type: "L", x: x + w, y },
        { type: "L", x: x + w, y: y + h },
        { type: "L", x, y: y + h },
        { type: "Z" },
      ];
    }
    case "circle":
    case "ellipse": {
      const rx = sd.type === "circle" ? sd.r : sd.rx;
      const ry = sd.type === "circle" ? sd.r : sd.ry;
      return [
        { type: "M", x: sd.cx + rx, y: sd.cy },
        {
          type: "A",
          rx,
          ry,
          angle: 0,
          largeArc: false,
          sweep: true,
          x: sd.cx - rx,
          y: sd.cy,
        },
        {
          type: "A",
          rx,
          ry,
          angle: 0,
          largeArc: false,
          sweep: true,
          x: sd.cx + rx,
          y: sd.cy,
        },
        { type: "Z" },
      ];
    }
    default:
      return null;
  }
}

/** Uniform corner radius; a zero rx or ry squares the corner, as in CSS/Canvas. */
function cornerRadius(sd: { rx: number; ry: number }): number {
  // NOTE: elliptical corners (rx != ry) round to the smaller radius; Lottie rc has one r.
  return sd.rx > 0 && sd.ry > 0 ? Math.min(sd.rx, sd.ry) : 0;
}

function paintBox(sd: ShapeData) {
  switch (sd.type) {
    case "rect":
      return { x: sd.x, y: sd.y, width: sd.width, height: sd.height };
    case "circle":
      return {
        x: sd.cx - sd.r,
        y: sd.cy - sd.r,
        width: sd.r * 2,
        height: sd.r * 2,
      };
    case "ellipse":
      return {
        x: sd.cx - sd.rx,
        y: sd.cy - sd.ry,
        width: sd.rx * 2,
        height: sd.ry * 2,
      };
    default: {
      const cmds = shapeCommands(sd);
      return cmds
        ? computePathBounds(cmds)
        : { x: 0, y: 0, width: 0, height: 0 };
    }
  }
}

// Keyframe emission

/** Indices to keep so linear interpolation between them stays within `eps`. */
function keepIndices(s: Vec[], eps: number): number[] {
  const n = s.length;
  if (n <= 2) return n === 2 ? [0, 1] : [0];
  const fits = (a: number, b: number) => {
    for (let k = a + 1; k < b; k++) {
      const f = (k - a) / (b - a);
      for (let d = 0; d < s[k].length; d++)
        if (Math.abs(s[a][d] + (s[b][d] - s[a][d]) * f - s[k][d]) > eps)
          return false;
    }
    return true;
  };
  const keep = [0];
  let a = 0;
  for (let b = 2; b < n; b++) {
    if (!fits(a, b)) {
      keep.push(b - 1);
      a = b - 1;
    }
  }
  keep.push(n - 1);
  return keep;
}

const isStatic = (s: Vec[], eps: number) =>
  s.every((v) => v.every((x, d) => Math.abs(x - s[0][d]) <= eps));

const LINEAR = { o: { x: 0, y: 0 }, i: { x: 1, y: 1 } };

/** A number-vector property; `scalar` emits 1-D values as bare numbers. */
function prop(samples: Vec[], eps: number, scalar = false): Item {
  const out = (v: Vec) => (scalar ? r3(v[0]) : v.map(r3));
  if (isStatic(samples, eps)) return { a: 0, k: out(samples[0]) };
  const keep = keepIndices(samples, eps);
  return {
    a: 1,
    k: keep.map((f, j) =>
      j === keep.length - 1
        ? { t: f, s: samples[f].map(r3) }
        : { t: f, s: samples[f].map(r3), ...LINEAR },
    ),
  };
}

const shapeObj = (c: Contour) => ({
  c: c.c,
  v: c.v.map((p) => p.map(r3)),
  i: c.i.map((p) => p.map(r3)),
  o: c.o.map((p) => p.map(r3)),
});
const flatten = (c: Contour): Vec => [
  ...c.v.flat(),
  ...c.i.flat(),
  ...c.o.flat(),
];
const signature = (c: Contour | undefined) =>
  c ? `${+c.c}:${c.v.length}` : "-";
const EMPTY: Contour = { c: false, v: [], i: [], o: [] };

/** One `sh` item's `ks` from per-frame contours of a compatible structure. */
function shapeProp(frames: (Contour | undefined)[], held: boolean): Item {
  if (held) {
    const k: Item[] = [];
    let last = "";
    frames.forEach((c, f) => {
      const key = JSON.stringify(shapeObj(c ?? EMPTY));
      if (key === last) return;
      last = key;
      k.push({ t: f, s: [shapeObj(c ?? EMPTY)], h: 1 });
    });
    return k.length === 1 ? { a: 0, k: (k[0].s as unknown[])[0] } : { a: 1, k };
  }
  const flat = frames.map((c) => flatten(c!));
  if (isStatic(flat, EPS)) return { a: 0, k: shapeObj(frames[0]!) };
  const keep = keepIndices(flat, EPS);
  return {
    a: 1,
    k: keep.map((f, j) =>
      j === keep.length - 1
        ? { t: f, s: [shapeObj(frames[f]!)] }
        : { t: f, s: [shapeObj(frames[f]!)], ...LINEAR },
    ),
  };
}

// Transform decomposition (anchor = transform-origin, so pure spins hold `p`)

interface Tr {
  p: Vec;
  s: Vec;
  r: number;
  sk: number;
}

/** M_lin = R(r) · shearX(-tan sk) · S, matching lottie-web's skew with `sa` 0. */
function decompose(m: Matrix3x3, anchor: Vec, prevRot: number | null): Tr {
  const [a, c, e, b, d, f] = m;
  const p = [
    a * anchor[0] + c * anchor[1] + e,
    b * anchor[0] + d * anchor[1] + f,
  ];
  const sx = Math.hypot(a, b);
  const th = sx > 1e-9 ? Math.atan2(b, a) : ((prevRot ?? 0) * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const c2 = cos * c + sin * d;
  const sy = -sin * c + cos * d;
  const sk = Math.abs(sy) > 1e-9 ? Math.atan(-c2 / sy) : 0;
  let r = (th * 180) / Math.PI;
  if (prevRot !== null) {
    while (r - prevRot > 180) r -= 360;
    while (r - prevRot < -180) r += 360;
  }
  return { p, s: [sx * 100, sy * 100], r, sk: (sk * 180) / Math.PI };
}

// Paint

const rgb = (css: string) => {
  const c = parseColor(css);
  return { v: [c.r / 255, c.g / 255, c.b / 255, 1], a: c.a };
};

const CAP = { butt: 1, round: 2, square: 3 } as const;
const JOIN = { miter: 1, round: 2, bevel: 3 } as const;

/** Gradient channels (start, end, highlight, packed stops) per frame, or null when inactive. */
function gradientFrame(g: GradientData | null, sd: ShapeData) {
  if (!g || g.type === "conic-gradient") return null;
  const r = resolveGradient(g, paintBox(sd));
  if (r.type === "conic") return null;
  const colors: number[] = [];
  const alphas: number[] = [];
  for (const st of r.stops) {
    const c = parseColor(st.color);
    colors.push(st.offset, c.r / 255, c.g / 255, c.b / 255);
    alphas.push(st.offset, c.a);
  }
  if (r.type === "linear")
    return {
      t: 1,
      s: [r.x1, r.y1],
      e: [r.x2, r.y2],
      h: [0, 0],
      colors,
      alphas,
    };
  const dist = Math.hypot(r.fx - r.cx, r.fy - r.cy);
  const h = r.r > 0 ? (dist / r.r) * 100 : 0;
  const ang =
    dist > 1e-9 ? (Math.atan2(r.fy - r.cy, r.fx - r.cx) * 180) / Math.PI : 0;
  return {
    t: 2,
    s: [r.cx, r.cy],
    e: [r.cx + r.r, r.cy],
    h: [h, ang],
    colors,
    alphas,
  };
}

// Converter

export class Converter {
  warnings: string[] = [];
  private skipped = new Map<string, string[]>();
  private variables: VariableDefinition[] = [];
  private timeSampled = false;

  /** Whether a value reads an input() the per-frame sampling can't capture. */
  private isLive(value: Value): boolean {
    return readsInput(
      value,
      this.variables,
      (p) => !(this.timeSampled && p === "time"),
    );
  }

  private skip(feature: string, node: SceneNode) {
    const ids = this.skipped.get(feature) ?? [];
    if (!ids.includes(node.id)) ids.push(node.id);
    this.skipped.set(feature, ids);
  }

  convert(
    source: string,
    { fps = 30, durationMs }: { fps?: number; durationMs?: number } = {},
  ): LottieJson {
    const ast = parse(source);
    const w = ast.canvas?.width ?? 400;
    const h = ast.canvas?.height ?? 300;
    const root = buildSceneGraph(ast);
    this.variables = ast.variables;
    this.timeSampled = durationMs !== undefined;
    const loop = new RenderLoop(nullRenderer(w, h), new AnimationScheduler());
    loop.setScene(root);
    loop.setSceneSize(w, h);
    loop.getVariableResolver().setVariables(ast.variables);

    const duration = durationMs ?? computeSceneDuration(root);
    if (
      durationMs === undefined &&
      duration <= 0 &&
      !Number.isFinite(loop.duration)
    )
      this.warnings.push(
        "state machine with no timeline animation exported as its initial frame",
      );
    const fr = Math.min(
      fps,
      duration > 0 ? (MAX_FRAMES * 1000) / duration : fps,
    );
    const op = Math.max(1, Math.round((duration / 1000) * fr));

    const recs = new Map<SceneNode, Rec>();
    const collect = (node: SceneNode) => {
      if (node.isMaskSource) return;
      if (node.type === "text" || node.type === "image") {
        this.skip(`${node.type} not exported`, node);
        return;
      }
      recs.set(node, { node, snaps: [], order: [], orderKey: "" });
      for (const c of node.children) collect(c);
    };
    collect(root);

    for (let f = 0; f <= op; f++) {
      loop.seek(Math.min((f * 1000) / fr, duration));
      for (const rec of recs.values()) this.sample(rec, f);
    }

    const it: Item[] = [this.group(root, recs)];
    const bg = ast.canvas?.background;
    if (bg && bg !== "transparent") {
      const c = rgb(bg);
      if (c.a > 0)
        it.push({
          ty: "gr",
          nm: "background",
          it: [
            {
              ty: "rc",
              d: 1,
              p: { a: 0, k: [w / 2, h / 2] },
              s: { a: 0, k: [w, h] },
              r: { a: 0, k: 0 },
            },
            {
              ty: "fl",
              c: { a: 0, k: c.v },
              o: { a: 0, k: r3(c.a * 100) },
              r: 1,
            },
            trItem(),
          ],
        });
    }

    for (const [feature, ids] of this.skipped) {
      const list = ids
        .slice(0, 3)
        .map((id) => `#${id}`)
        .join(", ");
      const more = ids.length > 3 ? ` +${ids.length - 3} more` : "";
      this.warnings.push(`${feature}: ${list}${more}`);
    }

    return {
      v: "5.7.4",
      fr,
      ip: 0,
      op,
      w,
      h,
      nm: "popkorn",
      ddd: 0,
      assets: [],
      layers: [
        {
          ddd: 0,
          ind: 1,
          ty: 4,
          nm: "scene",
          sr: 1,
          ks: {
            o: { a: 0, k: 100 },
            r: { a: 0, k: 0 },
            p: { a: 0, k: [0, 0, 0] },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
          },
          ao: 0,
          shapes: it,
          ip: 0,
          op,
          st: 0,
          bm: 0,
        },
      ],
    };
  }

  private sample(rec: Rec, f: number) {
    const n = rec.node;
    const kids = n.sortedChildren ?? n.children;
    const key = kids.map((k) => k.id).join("\n");
    if (f === 0) {
      rec.order = kids.slice();
      rec.orderKey = key;
    } else if (key !== rec.orderKey)
      this.skip("animated z-index uses its first-frame order", n);

    if (n.filter || n.boxShadow) this.skip("filter/box-shadow not exported", n);
    if (n.clipPath) this.skip("clip-path not exported", n);
    if (n.mask) this.skip("mask not exported (content left unmasked)", n);
    if (n.mixBlendMode !== "normal")
      this.skip("mix-blend-mode not exported", n);
    if (f === 0) {
      if (
        n.hoverStyles ||
        n.activeStyles ||
        n.stateStyles.length ||
        n.machines.length
      )
        this.skip("interactive states not exported", n);
      if (n.animationTimeline || n.bindings.some((b) => this.isLive(b.value)))
        this.skip("input() bindings frozen at their initial value", n);
    }

    const o = resolveTransformOrigin(n);
    rec.snaps.push({
      m: computeLocalMatrix(n),
      anchor: [o.x, o.y],
      alpha: n.hidden || n.displayNone ? 0 : n.opacity,
      fill: n.fill,
      stroke: n.stroke,
      fillG: n.fillGradient,
      strokeG: n.strokeGradient,
      strokeWidth: n.strokeWidth,
      trim: [n.trimStart, n.trimEnd, n.trimOffset],
      dashOffset: n.strokeDashOffset,
      shape: { ...n.shapeData } as ShapeData,
    });
  }

  private group(node: SceneNode, recs: Map<SceneNode, Rec>): Item {
    const rec = recs.get(node)!;
    const it: Item[] = [];
    for (let i = rec.order.length - 1; i >= 0; i--) {
      const child = rec.order[i];
      if (recs.has(child)) it.push(this.group(child, recs));
    }
    it.push(...this.shapeItems(rec));

    let prev: number | null = null;
    const trs = rec.snaps.map((s) => {
      const t = decompose(s.m, s.anchor, prev);
      prev = t.r;
      return t;
    });
    it.push(
      trItem({
        p: prop(
          trs.map((t) => t.p),
          EPS,
        ),
        a: prop(
          rec.snaps.map((s) => s.anchor),
          EPS,
        ),
        s: prop(
          trs.map((t) => t.s),
          EPS,
        ),
        r: prop(
          trs.map((t) => [t.r]),
          EPS,
          true,
        ),
        o: prop(
          rec.snaps.map((s) => [s.alpha * 100]),
          EPS_OPACITY,
          true,
        ),
        sk: prop(
          trs.map((t) => [t.sk]),
          EPS,
          true,
        ),
      }),
    );
    return { ty: "gr", nm: node.id || node.type, it };
  }

  /** The node's own paint as groups: geometry + trim + stroke/fill. */
  private shapeItems(rec: Rec): Item[] {
    const snaps = rec.snaps;
    const type = rec.node.shapeData.type;
    if (type === "group" || type === "text" || type === "image") return [];
    const n = rec.node;

    const trimmed = snaps.some(
      (s) => s.trim[0] > 0 || s.trim[1] < 1 || s.trim[2] !== 0,
    );
    const geom = this.geometry(rec, trimmed);

    const fillOn = snaps.some((s) => s.fill && !s.fillG);
    const fillGOn = snaps.some((s) => s.fillG);
    const strokeOn = snaps.some(
      (s) => (s.stroke || s.strokeG) && s.strokeWidth > 0,
    );
    const fillItems: Item[] = [];
    const strokeItems: Item[] = [];
    const rule = n.fillRule === "evenodd" ? 2 : 1;

    if (fillOn) {
      const cs = snaps.map((s) => (s.fill && !s.fillG ? rgb(s.fill) : null));
      fillItems.push({
        ty: "fl",
        c: prop(
          cs.map((c) => c?.v ?? [0, 0, 0, 1]),
          EPS_COLOR,
        ),
        o: prop(
          cs.map((c) => [c ? c.a * 100 : 0]),
          EPS_OPACITY,
          true,
        ),
        r: rule,
      });
    }
    if (fillGOn) {
      const g = this.gradient(rec, (s) => s.fillG);
      if (g) fillItems.push({ ty: "gf", r: rule, ...g });
    }
    if (strokeOn) {
      const line = {
        w: prop(
          snaps.map((s) => [s.strokeWidth]),
          EPS,
          true,
        ),
        lc: CAP[n.strokeLineCap],
        lj: JOIN[n.strokeLineJoin],
        ml: n.strokeMiterLimit,
        ...(n.strokeDashArray.length ? { d: this.dash(rec) } : {}),
      };
      if (snaps.some((s) => s.stroke && !s.strokeG)) {
        const cs = snaps.map((s) =>
          s.stroke && !s.strokeG && s.strokeWidth > 0 ? rgb(s.stroke) : null,
        );
        strokeItems.push({
          ty: "st",
          c: prop(
            cs.map((c) => c?.v ?? [0, 0, 0, 1]),
            EPS_COLOR,
          ),
          o: prop(
            cs.map((c) => [c ? c.a * 100 : 0]),
            EPS_OPACITY,
            true,
          ),
          ...line,
        });
      }
      if (snaps.some((s) => s.strokeG)) {
        const g = this.gradient(rec, (s) =>
          s.strokeWidth > 0 ? s.strokeG : null,
        );
        if (g) strokeItems.push({ ty: "gs", ...g, ...line });
      }
    }
    if (!fillItems.length && !strokeItems.length) return [];

    // Lottie lists topmost first; normal paint order draws the stroke over the fill.
    const strokeFirst = n.paintOrder !== "stroke";
    if (!trimmed || !fillItems.length || !strokeItems.length) {
      const trim = trimmed && strokeItems.length ? [this.trimItem(rec)] : [];
      const paints = strokeFirst
        ? [...strokeItems, ...fillItems]
        : [...fillItems, ...strokeItems];
      return [
        { ty: "gr", nm: "shape", it: [...geom, ...trim, ...paints, trItem()] },
      ];
    }
    // Popkorn trims only the stroke, so a trimmed stroke over a fill splits in two.
    const strokeGr = {
      ty: "gr",
      nm: "stroke",
      it: [...geom, this.trimItem(rec), ...strokeItems, trItem()],
    };
    const fillGr = {
      ty: "gr",
      nm: "fill",
      it: [...geom, ...fillItems, trItem()],
    };
    return strokeFirst ? [strokeGr, fillGr] : [fillGr, strokeGr];
  }

  private geometry(rec: Rec, trimmed: boolean): Item[] {
    const snaps = rec.snaps;
    const sd0 = snaps[0].shape;
    if (!trimmed && sd0.type === "rect" && !sd0.cornerRadii) {
      const rs = snaps.map((s) => s.shape as typeof sd0);
      return [
        {
          ty: "rc",
          d: 1,
          p: prop(
            rs.map((r) => [r.x + r.width / 2, r.y + r.height / 2]),
            EPS,
          ),
          s: prop(
            rs.map((r) => [r.width, r.height]),
            EPS,
          ),
          r: prop(
            rs.map((r) => [cornerRadius(r)]),
            EPS,
            true,
          ),
        },
      ];
    }
    if (!trimmed && (sd0.type === "circle" || sd0.type === "ellipse")) {
      const es = snaps.map((s) => {
        const e = s.shape as typeof sd0;
        return e.type === "circle"
          ? { p: [e.cx, e.cy], s: [e.r * 2, e.r * 2] }
          : {
              p: [e.cx, e.cy],
              s: [(e as { rx: number }).rx * 2, (e as { ry: number }).ry * 2],
            };
      });
      return [
        {
          ty: "el",
          d: 1,
          p: prop(
            es.map((e) => e.p),
            EPS,
          ),
          s: prop(
            es.map((e) => e.s),
            EPS,
          ),
        },
      ];
    }

    let lastCmds: PathCommand[] | null = null;
    let lastContours: Contour[] = [];
    const frames = snaps.map((s) => {
      const cmds =
        s.shape.type === "path" ? s.shape.commands : shapeCommands(s.shape);
      if (!cmds) return [];
      if (cmds !== lastCmds) {
        lastCmds = cmds;
        lastContours = toContours(cmds);
      }
      return lastContours;
    });
    const sig = (cs: Contour[]) => cs.map(signature).join(",");
    const held = frames.some((cs) => sig(cs) !== sig(frames[0]));
    if (held)
      this.skip("morph between incompatible paths exported as holds", rec.node);
    const count = Math.max(...frames.map((cs) => cs.length));
    const out: Item[] = [];
    for (let j = 0; j < count; j++)
      out.push({
        ty: "sh",
        ks: shapeProp(
          frames.map((cs) => cs[j]),
          held,
        ),
      });
    return out;
  }

  private trimItem(rec: Rec): Item {
    const t = rec.snaps.map((s) =>
      s.trim.map((v) => Math.max(0, Math.min(1, v))),
    );
    return {
      ty: "tm",
      s: prop(
        t.map((v) => [v[0] * 100]),
        EPS,
        true,
      ),
      e: prop(
        t.map((v) => [v[1] * 100]),
        EPS,
        true,
      ),
      o: prop(
        t.map((v) => [v[2] * 360]),
        EPS,
        true,
      ),
      m: 2,
    };
  }

  private dash(rec: Rec): Item[] {
    let arr = rec.node.strokeDashArray;
    if (arr.length % 2) arr = [...arr, ...arr];
    const items: Item[] = arr.map((v, i) => ({
      n: i % 2 ? "g" : "d",
      nm: `${i % 2 ? "gap" : "dash"}${i >> 1}`,
      v: { a: 0, k: r3(v) },
    }));
    items.push({
      n: "o",
      nm: "offset",
      v: prop(
        rec.snaps.map((s) => [s.dashOffset]),
        EPS,
        true,
      ),
    });
    return items;
  }

  private gradient(
    rec: Rec,
    pick: (s: Snap) => GradientData | null,
  ): Item | null {
    const frames = rec.snaps.map((s) => gradientFrame(pick(s), s.shape));
    const first = frames.find((g) => g);
    if (!first) {
      this.skip("conic gradient not exported", rec.node);
      return null;
    }
    if (rec.snaps.some((s) => pick(s)?.repeating))
      this.skip("repeating gradient exported unrepeated", rec.node);
    const stops = first.colors.length / 4;
    if (
      frames.some(
        (g) => g && (g.colors.length / 4 !== stops || g.t !== first.t),
      )
    )
      this.skip(
        "gradient changing stop count or type keeps its first form",
        rec.node,
      );
    const fixed = frames.map((g) =>
      g && g.colors.length / 4 === stops && g.t === first.t ? g : null,
    );
    const hasAlpha = fixed.some((g) =>
      g?.alphas.some((v, i) => i % 2 === 1 && v < 1),
    );
    const filled = fixed.map((g) => g ?? first);
    const hl = first.t === 2;
    return {
      o: prop(
        fixed.map((g) => [g ? 100 : 0]),
        EPS_OPACITY,
        true,
      ),
      t: first.t,
      s: prop(
        filled.map((g) => g.s),
        EPS,
      ),
      e: prop(
        filled.map((g) => g.e),
        EPS,
      ),
      ...(hl
        ? {
            h: prop(
              filled.map((g) => [g.h[0]]),
              EPS,
              true,
            ),
            a: prop(
              filled.map((g) => [g.h[1]]),
              EPS,
              true,
            ),
          }
        : {}),
      g: {
        p: stops,
        k: prop(
          filled.map((g) => (hasAlpha ? [...g.colors, ...g.alphas] : g.colors)),
          EPS_COLOR,
        ),
      },
    };
  }
}

function trItem(
  props: Partial<Record<"p" | "a" | "s" | "r" | "o" | "sk", Item>> = {},
): Item {
  return {
    ty: "tr",
    p: props.p ?? { a: 0, k: [0, 0] },
    a: props.a ?? { a: 0, k: [0, 0] },
    s: props.s ?? { a: 0, k: [100, 100] },
    r: props.r ?? { a: 0, k: 0 },
    o: props.o ?? { a: 0, k: 100 },
    sk: props.sk ?? { a: 0, k: 0 },
    sa: { a: 0, k: 0 },
  };
}

/** Convert Popkorn source to a Lottie animation object. No file I/O — safe for browser use. */
export function convertPopkorn(
  source: string,
  opts: { fps?: number; durationMs?: number } = {},
): { lottie: LottieJson; warnings: string[] } {
  const c = new Converter();
  const lottie = c.convert(source, opts);
  return { lottie, warnings: c.warnings };
}
