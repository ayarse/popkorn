import type { MaskMode } from "../scene/types";
import { resolveGradient } from "./gradient-geometry";
import type { Renderer } from "./interface";
import type { GradientData } from "./types";

/**
 * Cross-backend renderer conformance suite.
 *
 * The three `Renderer` backends (Canvas2D, SVG, Skia) share their paint
 * *helpers* (gradient-geometry, stroke, paint-state) but each keeps its own
 * compositing, ordering and state discipline — the code that legitimately stays
 * per-backend. This module pins the SEMANTICS those divergent implementations
 * must agree on, as one table of cases driven through the common `Renderer`
 * interface. Each backend's test package builds a `ConformanceHarness` that runs
 * a case and reports a NORMALIZED trace; the case asserts against a
 * backend-agnostic expectation. A fix that drifts one backend fails its column,
 * and the shared expectation constants keep the three honest against each other.
 *
 * Deliberate divergences (Skia luma·alpha matrix limit, Skia text/image no-ops,
 * SVG text-measure approximation) are NOT in this table — they live as explicit
 * single-backend tests next to each harness, documenting the disagreement so a
 * silent behavior change still fails.
 *
 * Cases drive the `Renderer` directly rather than a scene through `RenderLoop`:
 * the loop's `renderNode` walk is itself shared, so the per-backend behavior
 * under test lives in the `Renderer` methods, and exercising them directly is
 * both simpler and a tighter aim.
 */

// A gradient normalized to platform-independent geometry, in the field order the
// shared `resolveGradient` produces. Every backend's harness reverse-maps its
// platform gradient (CanvasGradient args / SVG attrs / SkShader args) to this,
// so all three must realize the SAME endpoints from one GradientData + box.
export interface NormGradient {
  type: "linear" | "radial";
  coords: number[]; // linear: [x1,y1,x2,y2]; radial: [cx,cy,r,fx,fy]
  stops: { offset: number; color: string }[];
}

// One fill or stroke, in paint order within the frame. Solid paints carry
// `color` (the shared colorToCSS string every backend applies); gradient paints
// carry `gradient`. Strokes carry the applied `dashArray` + `dashOffset` (post
// trim/dash resolution), so dash-inside-trim composition, trim-only, dash-only,
// and empty-trim→no-stroke are all observable.
export interface PaintObs {
  kind: "fill" | "stroke";
  color?: string;
  gradient?: NormGradient;
  dashArray?: number[];
  dashOffset?: number;
}

// One realized track-matte composite, its platform primitive reverse-mapped to
// the mode it reproduces (Canvas gCO+luma pass / Skia blend+colorFilter / SVG
// mask-type+filter chain). Encounter order is per-backend, so mask cases assert
// the mode MULTISET, not the sequence.
export interface MaskObs {
  mode: MaskMode;
}

// The normalized observation a harness produces from running one case's ops.
export interface ConformanceTrace {
  paints: PaintObs[];
  masks: MaskObs[];
  width: number;
  height: number;
}

// A backend adapter: runs a case's ops through a fresh renderer wired to a
// recording surface, and returns the normalized trace. Built in each backend's
// own test package so the recording surface stays with the backend.
export interface ConformanceHarness {
  backend: "canvas2d" | "svg" | "skia";
  run(ops: (r: Renderer) => void): ConformanceTrace;
}

// Minimal shape of bun:test's `test`/`expect`, injected so this module (exported
// from the package index) never imports `bun:test` itself.
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
  // When set, only these backends run the case; the rest are skipped. Unused for
  // now (every case runs on all three) — kept so a genuinely-unobservable case
  // can name what it drops instead of silently passing.
  backends?: ConformanceHarness["backend"][];
}

export const MASK_MODES: readonly MaskMode[] = [
  "alpha",
  "alpha-invert",
  "luminance",
  "luminance-invert",
];

// Compare two coordinate lists with float tolerance (gradient endpoints carry
// √2 half-diagonals etc.).
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
const BOX_20x10 = { x: 0, y: 0, width: 20, height: 10 };
const BOX_10x10 = { x: 0, y: 0, width: 10, height: 10 };

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

  // --- #4 sticky-state discipline (paint state is not on the save/restore
  //        stack; the backend re-applies it at each draw) ---------------------
  {
    name: "set* paint state survives save/restore (not stacked)",
    ops: (r) => {
      r.setFill("#ff0000");
      r.setStroke("#00ff00", 3);
      r.save();
      // Mutate inside the bracket, then restore: restore must NOT revert paint
      // state, so the mutated values are what the draw below uses.
      r.setFill("#0000ff");
      r.restore();
      r.drawRect(0, 0, 10, 10);
    },
    assert: (t, expect) => {
      const fill = t.paints.find((p) => p.kind === "fill");
      const stroke = t.paints.find((p) => p.kind === "stroke");
      // Fill mutated-then-restored still reads the mutated value (sticky, global).
      expect(fill?.color).toBe("#0000ff");
      // Stroke set before the bracket survives the restore untouched.
      expect(stroke?.color).toBe("#00ff00");
    },
  },

  // --- #2 trim/dash composition; empty trim window strokes nothing -----------
  {
    // Authored dash composed *inside* the trim window (dash-of-a-dash): trim
    // window is total 30, arc [5,15]; the [3,3] dash's ON runs land at [6,9] and
    // [12,15] within it -> [3,3,3,21] offset -6 over the length-30 outline.
    name: "authored dash composes inside a trim window",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setDash([3, 3], 0);
      r.setTrim({ visible: true, dashArray: [10, 20], dashOffset: -5 });
      r.drawPath([
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 40, y: 0 },
      ]);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke !== undefined).toBe(true);
      expect(stroke!.dashArray).toEqual([3, 3, 3, 21]);
      expect(stroke!.dashOffset).toBe(-6);
    },
  },
  {
    // Trim-only stays byte-identical to pre-composition behavior.
    name: "trim window with no authored dash is unchanged",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setTrim({ visible: true, dashArray: [10, 20], dashOffset: -5 });
      r.drawPath([
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 40, y: 0 },
      ]);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke !== undefined).toBe(true);
      expect(stroke!.dashArray).toEqual([10, 20]);
      expect(stroke!.dashOffset).toBe(-5);
    },
  },
  {
    // Dash-only stays byte-identical: no trim, authored dash passes through.
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
    // Trim offset (marching window) composed with a dash. Window total 40, arc
    // [10,30]; [5,5] dash ON runs at [10,15],[20,25] within it -> [5,5,5,25]
    // offset -10.
    name: "trim offset composes with a dash",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setDash([5, 5], 0);
      r.setTrim({ visible: true, dashArray: [20, 20], dashOffset: -10 });
      r.drawPath([
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 40, y: 0 },
      ]);
    },
    assert: (t, expect) => {
      const stroke = t.paints.find((p) => p.kind === "stroke");
      expect(stroke !== undefined).toBe(true);
      expect(stroke!.dashArray).toEqual([5, 5, 5, 25]);
      expect(stroke!.dashOffset).toBe(-10);
    },
  },
  {
    name: "empty trim window strokes nothing",
    ops: (r) => {
      r.setFill(null);
      r.setStroke("#000000", 2);
      r.setTrim({ visible: false, dashArray: [], dashOffset: 0 });
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
      // Outer luminance; a nested alpha-invert re-enters compositeMask inside the
      // outer's content. The outer's realized mode must survive the inner run
      // (the Skia pooled-paint / Canvas buffer-band / SVG retained-mask hazard).
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

/**
 * Register every applicable conformance case against one backend's harness.
 * Called from each backend's test file with its `bun:test` `test`/`expect` and
 * the backend adapter.
 */
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
