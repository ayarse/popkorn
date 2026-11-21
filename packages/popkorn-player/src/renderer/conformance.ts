import { insetShadowCommands, shapeClip } from "../scene/box-shadow.js";
import { createSceneNode, snapshotNode } from "../scene/node.js";
import { parsePath } from "../scene/path-parser.js";
import type {
  BlendMode,
  CircleData,
  EllipseData,
  MaskMode,
  PathData,
  RectData,
  SceneNode,
  TrimMode,
} from "../scene/types.js";
import { filterToCSS } from "./filter-css.js";
import { resolveGradient } from "./gradient-geometry.js";
import type { Renderer } from "./interface.js";
import { computeTrim, drawContourTrims } from "./stroke.js";
import type { GradientData } from "./types.js";

/**
 * Cross-backend conformance: one case table run through the `Renderer` interface
 * against Canvas2D, SVG and Skia, each harness reporting a normalized trace.
 * Deliberate divergences (Skia luma·alpha, text/image/filter no-ops, SVG text
 * measure, raster-cache opt-outs) are pinned as single-backend tests per harness.
 */

// Platform gradient reverse-mapped to shared `resolveGradient` geometry.
export interface NormGradient {
  type: "linear" | "radial" | "conic";
  // linear: [x1,y1,x2,y2]; radial: [cx,cy,r,fx,fy]; conic: [cx,cy,startAngle]
  coords: number[];
  stops: { offset: number; color: string }[];
}

// One fill or stroke in paint order; strokes carry the applied dash after trim composition.
export interface PaintObs {
  kind: "fill" | "stroke";
  color?: string;
  gradient?: NormGradient;
  dashArray?: number[];
  dashOffset?: number;
  // Realized mix-blend-mode (undefined == 'normal').
  blend?: BlendMode;
}

// One realized track-matte composite; encounter order is per-backend, so assert the multiset.
export interface MaskObs {
  mode: MaskMode;
}

// One realized clip, reverse-mapped to the ResolvedClip shape.
export interface ClipObs {
  type: "rect" | "circle" | "path";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

// Normalized observation of one case; `filters` is each realized compositeFilter string (Skia: none).
export interface ConformanceTrace {
  paints: PaintObs[];
  masks: MaskObs[];
  clips: ClipObs[];
  filters: string[];
  // Straight-segment endpoints [x, y] on the main surface, in draw order.
  lines: number[][];
  width: number;
  height: number;
}

// Backend adapter: runs a case's ops on a fresh recording renderer, returns the trace.
export interface ConformanceHarness {
  backend: "canvas2d" | "svg" | "skia";
  run(ops: (r: Renderer) => void): ConformanceTrace;
}

// Minimal bun:test surface, injected so this module never imports `bun:test`.
type ExpectFn = (actual: unknown) => {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeCloseTo(v: number, digits?: number): void;
  toBeUndefined(): void;
  readonly not: { toBe(v: unknown): void };
};
interface TestRunner {
  test(name: string, fn: () => void): void;
  expect: ExpectFn;
}

interface ConformanceCase {
  name: string;
  ops: (r: Renderer) => void;
  assert: (trace: ConformanceTrace, expect: ExpectFn) => void;
  // When set, only these backends run the case.
  backends?: ConformanceHarness["backend"][];
}

export const MASK_MODES: readonly MaskMode[] = [
  "alpha",
  "alpha-invert",
  "luminance",
  "luminance-invert",
];

// Float-tolerant coordinate-list comparison.
function expectCoords(
  actual: number[],
  expected: number[],
  expect: ExpectFn,
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++)
    expect(actual[i]).toBeCloseTo(expected[i], 4);
}

function expectGradient(
  actual: NormGradient | undefined,
  g: GradientData,
  box: { x: number; y: number; width: number; height: number },
  expect: ExpectFn,
): void {
  const r = resolveGradient(g, box);
  const expected: NormGradient =
    r.type === "linear"
      ? { type: "linear", coords: [r.x1, r.y1, r.x2, r.y2], stops: r.stops }
      : r.type === "conic"
        ? { type: "conic", coords: [r.cx, r.cy, r.startAngle], stops: r.stops }
        : {
            type: "radial",
            coords: [r.cx, r.cy, r.r, r.fx, r.fy],
            stops: r.stops,
          };
  expect(actual !== undefined).toBe(true);
  expect(actual!.type).toBe(expected.type);
  expectCoords(actual!.coords, expected.coords, expect);
  expect(actual!.stops).toEqual(expected.stops);
}

// Multiset equality on mask modes (encounter order differs per backend).
function expectModeMultiset(
  actual: MaskMode[],
  expected: MaskMode[],
  expect: ExpectFn,
): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

const GRAD_LINEAR: GradientData = {
  type: "linear-gradient",
  angle: 90,
  stops: [
    { offset: 0, color: "#ff0000" },
    { offset: 1, color: "#0000ff" },
  ],
};
const GRAD_RADIAL_BBOX: GradientData = {
  type: "radial-gradient",
  stops: [
    { offset: 0, color: "#ffffff" },
    { offset: 1, color: "#000000" },
  ],
};
const GRAD_RADIAL_FOCAL: GradientData = {
  type: "radial-gradient",
  radius: 30,
  at: { x: 5, y: 6 },
  focal: { x: 7, y: 8 },
  stops: [
    { offset: 0, color: "#ffffff" },
    { offset: 1, color: "#000000" },
  ],
};
const GRAD_CONIC: GradientData = {
  type: "conic-gradient",
  from: 90,
  stops: [
    { offset: 0, color: "#ff0000" },
    { offset: 1, color: "#0000ff" },
  ],
};
// Repeating linear: the shared resolveGradient expands the tiled stop run.
const GRAD_REPEAT_LINEAR: GradientData = {
  type: "linear-gradient",
  angle: 90,
  repeating: true,
  stops: [
    { offset: 0, color: "#ff0000" },
    { offset: 0.25, color: "#0000ff" },
  ],
};
const BOX_20x10 = { x: 0, y: 0, width: 20, height: 10 };
const BOX_10x10 = { x: 0, y: 0, width: 10, height: 10 };

// Clip + evenodd cover/hole, exactly as drawBoxShadows emits an inset shadow.
function driveInset(
  r: Renderer,
  sd: RectData | CircleData | EllipseData | PathData,
  dx: number,
  dy: number,
  spread: number,
): void {
  const clip = shapeClip(sd);
  const commands = insetShadowCommands(sd, dx, dy, spread);
  if (!clip || !commands) return;
  r.save();
  r.setFill("#000000");
  r.setStroke(null, 0);
  r.setFillRule("evenodd");
  r.clip(clip);
  r.drawPath(commands);
  r.restore();
}

const SHARP_RECT: RectData = {
  type: "rect",
  x: 0,
  y: 0,
  width: 20,
  height: 20,
  rx: 0,
  ry: 0,
};
const ROUNDED_RECT: RectData = { ...SHARP_RECT, rx: 6, ry: 6 };
const INSET_ELLIPSE: EllipseData = {
  type: "ellipse",
  cx: 10,
  cy: 10,
  rx: 10,
  ry: 6,
};
const INSET_PATH: PathData = {
  type: "path",
  commands: [
    { type: "M", x: 0, y: 0 },
    { type: "L", x: 20, y: 0 },
    { type: "L", x: 10, y: 18 },
    { type: "Z" },
  ],
};

// Inset case: assert clip geometry kind (rect vs path) and that the shadow fills.
function insetShadowCases(): ConformanceCase[] {
  const case_ = (
    name: string,
    sd: RectData | CircleData | EllipseData | PathData,
    clipKind: ClipObs["type"],
    dx = 0,
    dy = 0,
    spread = 2,
  ): ConformanceCase => ({
    name,
    ops: (r) => driveInset(r, sd, dx, dy, spread),
    assert: (t, expect) => {
      expect(t.clips.length).toBe(1);
      expect(t.clips[0].type).toBe(clipKind);
      expect(t.paints.some((p) => p.kind === "fill")).toBe(true);
    },
  });
  return [
    case_("inset shadow on a sharp rect clips to a rect", SHARP_RECT, "rect"),
    case_(
      "inset shadow on a rounded rect clips to its outline path",
      ROUNDED_RECT,
      "path",
    ),
    case_(
      "inset shadow on an ellipse clips to its outline path",
      INSET_ELLIPSE,
      "path",
    ),
    case_("inset shadow on a path clips to that path", INSET_PATH, "path"),
    case_(
      "inset shadow on a rounded rect with offset + spread still fills",
      ROUNDED_RECT,
      "path",
      3,
      4,
      3,
    ),
    // Rounded rect + stroke + zero-blur inset: clips to the outline path; fill and stroke both paint.
    {
      name: "zero-blur offset inset on a stroked rounded rect clips to the outline path",
      ops: (r) => {
        r.setFill("#101010");
        r.setStroke("#4ecdc4", 2);
        r.drawRect(0, 0, 40, 30, 6, 6); // rounded rect fill + stroke
        driveInset(r, ROUNDED_RECT, 10, 10, 0); // inset: dx/dy 10, blur/spread 0
      },
      assert: (t, expect) => {
        expect(t.clips.some((c) => c.type === "path")).toBe(true);
        expect(t.clips.some((c) => c.type === "rect")).toBe(false);
        expect(t.paints.some((p) => p.kind === "fill")).toBe(true);
        expect(t.paints.some((p) => p.kind === "stroke")).toBe(true);
      },
    },
  ];
}

const LINE_40 = parsePath("M0 0 L40 0");

// An open-contour trim window in outline units.
function trimSpan(start: number, length: number, total: number) {
  return { visible: true, start, length, total, continuous: false };
}

function trimmedNode(
  d: string,
  start: number,
  end: number,
  offset: number,
  mode: TrimMode = "simultaneous",
): SceneNode {
  const n = createSceneNode("t", "path");
  n.shapeData = { type: "path", commands: parsePath(d) };
  n.trimStart = start;
  n.trimEnd = end;
  n.trimOffset = offset;
  n.trimMode = mode;
  n.base = snapshotNode(n);
  return n;
}

function pathCommands(n: SceneNode) {
  return n.shapeData.type === "path" ? n.shapeData.commands : [];
}

// A filled two-contour path trimmed to 50%, drawn through the shared walk's split.
function driveContourTrim(r: Renderer, mode: TrimMode): void {
  const n = trimmedNode("M0 0 L10 0 M0 20 L30 20", 0, 0.5, 0, mode);
  n.fill = "#0000ff";
  n.stroke = "#000000";
  r.setFill(n.fill);
  r.setStroke(n.stroke, 2);
  drawContourTrims(r, n);
}

export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
  // --- #3 paint order -------------------------------------------------------
  {
    name: "paint-order normal draws fill then stroke",
    ops: (r) => {
      r.setFill("#0000ff");
      r.setStroke("#ff0000", 2);
      r.setPaintOrder("normal");
      r.drawRect(0, 0, 10, 10);
    },
    assert: (t, expect) => {
      expect(t.paints.map((p) => p.kind)).toEqual(["fill", "stroke"]);
    },
  },
  {
    name: "paint-order stroke draws stroke before fill",
    ops: (r) => {
      r.setFill("#0000ff");
      r.setStroke("#ff0000", 2);
      r.setPaintOrder("stroke");
      r.drawRect(0, 0, 10, 10);
    },
    assert: (t, expect) => {
      expect(t.paints.map((p) => p.kind)).toEqual(["stroke", "fill"]);
    },
  },

  // --- per-corner border-radius (shared roundedRectPath geometry) ------------
  {
    // Four distinct corner radii must still fill AND stroke on every backend.
    name: "per-corner border-radius still fills and strokes on every backend",
    ops: (r) => {
      r.setFill("#0000ff");
      r.setStroke("#ff0000", 2);
      r.drawRect(0, 0, 20, 10, 0, 0, [2, 4, 6, 8]);
    },
    assert: (t, expect) => {
      expect(t.paints.some((p) => p.kind === "fill")).toBe(true);
      expect(t.paints.some((p) => p.kind === "stroke")).toBe(true);
    },
  },

  // --- mix-blend-mode: same blend realized on every backend ------------------
  {
    // Blend reaches the paint on every backend, and setBlendMode('normal') doesn't leak to later paints.
    name: "mix-blend-mode realizes the same blend on every backend, then resets",
    ops: (r) => {
      r.setBlendMode("multiply");
      r.setFill("#00ff00");
      r.setStroke(null, 0);
      r.drawRect(0, 0, 10, 10);
      r.setBlendMode("normal");
      r.setFill("#0000ff");
      r.drawRect(0, 0, 10, 10);
    },
    assert: (t, expect) => {
      const blended = t.paints.find((p) => p.color === "#00ff00");
      const plain = t.paints.find((p) => p.color === "#0000ff");
      expect(blended?.blend).toBe("multiply");
      // normal blend records as undefined.
      expect(plain?.blend).toBeUndefined();
    },
  },

  // --- inset box-shadow: shape-accurate clip + punched inverse ---------------
  // A rounded rect / ellipse / path inset shadow must clip to its outline (`path`), not its bbox.
  ...insetShadowCases(),

  // --- #7 artboard clipping (shared walk's overflow:hidden default) ----------
  {
    // Rect clip at the stage box: every backend records the same crop and still paints.
    name: "rect clip records one shared crop region and keeps the paint",
    ops: (r) => {
      r.save();
      r.clip({ type: "rect", x: 0, y: 0, width: 10, height: 10 });
      r.setFill("#0000ff");
      r.drawRect(5, 5, 20, 20); // straddles the 10×10 artboard edge
      r.restore();
    },
    assert: (t, expect) => {
      expect(t.clips.length).toBe(1);
      const c = t.clips[0];
      expect(c.type).toBe("rect");
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
      expect(c.width).toBe(10);
      expect(c.height).toBe(10);
      // Clipping crops pixels; it doesn't drop the draw.
      expect(t.paints.some((p) => p.kind === "fill")).toBe(true);
    },
  },

  // --- #4 sticky-state discipline (paint state is not on the save/restore stack)
  {
    name: "set* paint state survives save/restore (not stacked)",
    ops: (r) => {
      r.setFill("#ff0000");
      r.setStroke("#00ff00", 3);
      r.save();
      // restore must NOT revert paint state.
      r.setFill("#0000ff");
      r.restore();
      r.drawRect(0, 0, 10, 10);
    },
    assert: (t, expect) => {
      const fill = t.paints.find((p) => p.kind === "fill");
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(fill?.color).toBe("#0000ff");
      expect(stroke?.color).toBe("#00ff00");
    },
  },

  // --- #2 trim/dash composition; empty trim window strokes nothing -----------
  {
    // Dash inside trim: arc [5,15]; [3,3] restarts at the window start -> ON [5,8],[11,14].
    name: "authored dash composes inside a trim window",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setDash([3, 3], 0);
      r.setTrim(trimSpan(5, 10, 40));
      r.drawPath(LINE_40);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke !== undefined).toBe(true);
      expect(stroke!.dashArray).toEqual([3, 3, 3, 71]);
      expect(stroke!.dashOffset).toBe(-5);
    },
  },
  {
    // Trim-only: one ON run, then a 2x-total gap.
    name: "trim window with no authored dash strokes the window",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setTrim(trimSpan(5, 10, 40));
      r.drawPath(LINE_40);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke !== undefined).toBe(true);
      expect(stroke!.dashArray).toEqual([10, 70]);
      expect(stroke!.dashOffset).toBe(-5);
    },
  },
  {
    // Dash phase travels with the trim: window at 7 puts the first [4,4] dash at 7, not at 8.
    name: "dash phase starts at the trim start",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setDash([4, 4], 0);
      r.setTrim(trimSpan(7, 20, 40));
      r.drawPath(LINE_40);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke!.dashArray).toEqual([4, 4, 4, 4, 4, 60]);
      expect(stroke!.dashOffset).toBe(-7);
    },
  },
  {
    // Full window + 25% offset on a closed 40-long square: [5,5] starts at 10 and runs through the seam.
    name: "full trim with an offset keeps the authored dash",
    ops: (r) => {
      const n = trimmedNode("M0 0 L10 0 L10 10 L0 10 Z", 0, 1, 0.25);
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setDash([5, 5], 0);
      r.setTrim(computeTrim(n));
      r.drawPath(pathCommands(n));
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke!.dashArray).toEqual([5, 5, 5, 5, 5, 5, 5, 45]);
      expect(stroke!.dashOffset).toBe(0);
    },
  },
  {
    // Dash-only: authored dash passes through.
    name: "authored dash with no trim is unchanged",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setDash([4, 6], 2);
      r.drawPath([
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 40, y: 0 },
      ]);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke !== undefined).toBe(true);
      expect(stroke!.dashArray).toEqual([4, 6]);
      expect(stroke!.dashOffset).toBe(2);
    },
  },
  {
    // Odd dash repeats once to an even period on every backend (Canvas/SVG spec; Skia MakeDash needs it).
    name: "odd-length authored dash realizes as its doubled even period",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setDash([5, 3, 2], 1);
      r.drawPath([
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 40, y: 0 },
      ]);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke !== undefined).toBe(true);
      expect(stroke!.dashArray).toEqual([5, 3, 2, 5, 3, 2]);
      expect(stroke!.dashOffset).toBe(1);
    },
  },
  {
    // Trim offset + dash: arc [10,30]; [5,5] ON at [10,15],[20,25].
    name: "trim offset composes with a dash",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setDash([5, 5], 0);
      r.setTrim(trimSpan(10, 20, 40));
      r.drawPath(LINE_40);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke !== undefined).toBe(true);
      expect(stroke!.dashArray).toEqual([5, 5, 5, 65]);
      expect(stroke!.dashOffset).toBe(-10);
    },
  },
  {
    // Contours 10 + 30 long, trim-end 50%: each contour shows its own first half.
    name: "trim-mode simultaneous trims each contour on its own",
    ops: (r) => driveContourTrim(r, "simultaneous"),
    assert: (t, expect) => {
      const fills = t.paints.filter((p) => p.kind === "fill");
      const strokes = t.paints.filter((p) => p.kind === "stroke");
      expect(fills.length).toBe(1);
      expect(strokes.map((p) => p.dashArray)).toEqual([
        [5, 15],
        [15, 45],
      ]);
    },
  },
  {
    // Same path, sequential: the window covers 20 of 40 -> all of contour 1, then 10 of contour 2.
    name: "trim-mode sequential trims the contours as one outline",
    ops: (r) => driveContourTrim(r, "sequential"),
    assert: (t, expect) => {
      const strokes = t.paints.filter((p) => p.kind === "stroke");
      expect(strokes.map((p) => p.dashArray)).toEqual([[], [10, 50]]);
    },
  },
  {
    name: "empty trim window strokes nothing",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setTrim({
        visible: false,
        start: 0,
        length: 0,
        total: 0,
        continuous: false,
      });
      r.drawPath([
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 40, y: 0 },
      ]);
    },
    assert: (t, expect) => {
      expect(t.paints.some((p) => p.kind === "stroke")).toBe(false);
    },
  },

  // --- #5 gradient realization (same GradientData + box => same geometry) ----
  {
    name: "linear gradient realizes shared endpoints",
    ops: (r) => {
      r.setFill(null);
      r.setFillGradient(GRAD_LINEAR);
      r.drawRect(BOX_20x10.x, BOX_20x10.y, BOX_20x10.width, BOX_20x10.height);
    },
    assert: (t, expect) => {
      const fill = t.paints.find((p) => p.kind === "fill");
      expectGradient(fill?.gradient, GRAD_LINEAR, BOX_20x10, expect);
    },
  },
  {
    name: "bbox radial gradient realizes the half-diagonal circle",
    ops: (r) => {
      r.setFill(null);
      r.setFillGradient(GRAD_RADIAL_BBOX);
      r.drawRect(BOX_10x10.x, BOX_10x10.y, BOX_10x10.width, BOX_10x10.height);
    },
    assert: (t, expect) => {
      const fill = t.paints.find((p) => p.kind === "fill");
      expectGradient(fill?.gradient, GRAD_RADIAL_BBOX, BOX_10x10, expect);
    },
  },
  {
    name: "focal radial gradient realizes the two-point conical geometry",
    ops: (r) => {
      r.setFill(null);
      r.setFillGradient(GRAD_RADIAL_FOCAL);
      r.drawRect(BOX_10x10.x, BOX_10x10.y, BOX_10x10.width, BOX_10x10.height);
    },
    assert: (t, expect) => {
      const fill = t.paints.find((p) => p.kind === "fill");
      expectGradient(fill?.gradient, GRAD_RADIAL_FOCAL, BOX_10x10, expect);
    },
  },

  {
    // NOTE: SVG has no conic primitive (pinned divergence), so this is scoped to Canvas/Skia.
    name: "conic gradient realizes centre and start angle",
    backends: ["canvas2d", "skia"],
    ops: (r) => {
      r.setFill(null);
      r.setFillGradient(GRAD_CONIC);
      r.drawRect(BOX_20x10.x, BOX_20x10.y, BOX_20x10.width, BOX_20x10.height);
    },
    assert: (t, expect) => {
      const fill = t.paints.find((p) => p.kind === "fill");
      expectGradient(fill?.gradient, GRAD_CONIC, BOX_20x10, expect);
    },
  },
  {
    // Repeating tiles in the shared helper, so all backends get the same expanded stops.
    name: "repeating linear gradient tiles the stop run",
    ops: (r) => {
      r.setFill(null);
      r.setFillGradient(GRAD_REPEAT_LINEAR);
      r.drawRect(BOX_20x10.x, BOX_20x10.y, BOX_20x10.width, BOX_20x10.height);
    },
    assert: (t, expect) => {
      const fill = t.paints.find((p) => p.kind === "fill");
      expectGradient(fill?.gradient, GRAD_REPEAT_LINEAR, BOX_20x10, expect);
      expect((fill?.gradient?.stops.length ?? 0) > 2).toBe(true);
    },
  },

  // --- #1 track-matte mode realization + re-entrancy -------------------------
  {
    name: "every mask mode realizes its platform primitive",
    ops: (r) => {
      for (const mode of MASK_MODES) {
        r.compositeMask(
          mode,
          () => r.drawRect(0, 0, 10, 10),
          () => r.drawRect(0, 0, 8, 8),
        );
      }
    },
    assert: (t, expect) => {
      expectModeMultiset(
        t.masks.map((m) => m.mode),
        [...MASK_MODES],
        expect,
      );
    },
  },
  {
    name: "a nested matte inside drawContent does not corrupt the outer mask mode",
    ops: (r) => {
      // Nested alpha-invert re-enters compositeMask; the outer mode must survive the inner run.
      r.compositeMask(
        "luminance",
        () => {
          r.compositeMask(
            "alpha-invert",
            () => r.drawRect(0, 0, 5, 5),
            () => r.drawRect(0, 0, 5, 5),
          );
        },
        () => r.drawRect(0, 0, 10, 10),
      );
    },
    assert: (t, expect) => {
      expectModeMultiset(
        t.masks.map((m) => m.mode),
        ["luminance", "alpha-invert"],
        expect,
      );
    },
  },

  // --- CSS filter: shared string, shared skip -------------------------------
  {
    // Adjacent blur()s collapse in the shared walk, so chain and collapsed form realize one identical filter.
    name: "a chained blur realizes the same filter as its collapsed equivalent",
    backends: ["canvas2d", "svg"],
    ops: (r) => {
      const chained = filterToCSS(
        [
          { type: "blur", radius: 9 },
          { type: "blur", radius: 89 },
        ],
        1,
      );
      const collapsed = filterToCSS(
        [{ type: "blur", radius: Math.sqrt(9 * 9 + 89 * 89) }],
        1,
      );
      for (const css of [chained, collapsed]) {
        r.compositeFilter?.(css as string, () => {
          r.setFill("#0000ff");
          r.setStroke(null, 0);
          r.drawRect(0, 0, 10, 10);
        });
      }
    },
    assert: (t, expect) => {
      expect(t.filters.length).toBe(2);
      expect(t.filters[0]).toBe(t.filters[1]);
      expect(t.filters[0].split(" ").length).toBe(1);
    },
  },
  {
    // Sub-half-pixel blur: filterToCSS returns null and the walk draws inline, on every backend.
    name: "a sub-half-pixel blur realizes no filter and paints inline",
    ops: (r) => {
      const css = filterToCSS([{ type: "blur", radius: 0.4 }], 1);
      const draw = () => {
        r.setFill("#0000ff");
        r.setStroke(null, 0);
        r.drawRect(0, 0, 10, 10);
      };
      if (css) r.compositeFilter?.(css, draw);
      else draw();
    },
    assert: (t, expect) => {
      expect(t.filters).toEqual([]);
      expect(t.paints.map((p) => p.kind)).toEqual(["fill"]);
    },
  },

  // --- post-Z current point: H/V after Z start from the subpath start --------
  {
    name: "a segment after Z starts from the subpath start",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 1);
      r.drawPath([
        { type: "M", x: 2, y: 3 },
        { type: "L", x: 10, y: 10 },
        { type: "Z" },
        { type: "H", x: 5 },
        { type: "V", y: 7 },
        { type: "Z" },
        { type: "V", y: 8 },
      ]);
    },
    assert: (t, expect) => {
      expect(t.lines).toEqual([
        [10, 10],
        [5, 3],
        [5, 7],
        [2, 8],
      ]);
    },
  },

  // --- #6 resize() ----------------------------------------------------------
  {
    name: "resize updates the reported surface dimensions",
    ops: (r) => {
      r.resize(640, 480);
    },
    assert: (t, expect) => {
      expect(t.width).toBe(640);
      expect(t.height).toBe(480);
    },
  },
];

/** Register every applicable case against one backend's harness. */
export function registerConformance(
  runner: TestRunner,
  harness: ConformanceHarness,
): void {
  for (const c of CONFORMANCE_CASES) {
    if (c.backends && !c.backends.includes(harness.backend)) continue;
    runner.test(`conformance [${harness.backend}] ${c.name}`, () => {
      const trace = harness.run(c.ops);
      c.assert(trace, runner.expect);
    });
  }
}
