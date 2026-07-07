import { test, expect } from 'bun:test';
import { Converter, validate } from './lottie2popcorn.ts';

const IDENTITY_TR = { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } };

/** An `rc` whose size animates between two frames with a per-segment bezier. */
function animRect(pos: number[], t0: number, t1: number, ease: number[]) {
  return {
    ty: 'rc', p: { a: 0, k: pos },
    s: { a: 1, k: [
      { t: t0, s: [10, 10], o: { x: [ease[0]], y: [ease[1]] }, i: { x: [ease[2]], y: [ease[3]] } },
      { t: t1, s: [20, 20] },
    ] },
  };
}

/** A layer whose grouped rects share one group-level stroke (hoisted union stroke). */
function hoistedStrokeComp(st: any) {
  return {
    v: '5', fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [{
      ty: 4, nm: 'g', ind: 1, ip: 0, op: 30, st: 0,
      ks: { r: { a: 0, k: 0 }, p: { a: 0, k: [50, 50] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, o: { a: 0, k: 100 } },
      shapes: [
        { ty: 'gr', it: [animRect([0, 0], 0, 10, [0.1, 0, 0.9, 1]), { ...IDENTITY_TR }] },
        { ty: 'gr', it: [animRect([5, 5], 5, 15, [0.3, 0, 0.7, 1]), { ...IDENTITY_TR }] },
        st,
      ],
    }],
  };
}

/** Duration of the first `animation:` shorthand in the CSS, in seconds. */
function firstAnimDuration(css: string): number {
  const m = css.match(/animation:\s*[\w-]+\s+([\d.]+)s/);
  if (!m) throw new Error('no animation in output');
  return +m[1];
}
/** Delay (5th token) of the first `animation:` shorthand, in seconds (0 if omitted). */
function firstAnimDelay(css: string): number {
  const m = css.match(/animation:\s*[\w-]+\s+[\d.]+s\s+\w+\s+\d+(?:\s+([\d.-]+)s)?/);
  if (!m) throw new Error('no animation in output');
  return m[1] ? +m[1] : 0;
}

/** Minimal one-shape comp: a spinner with rotation keyframes at the listed frames. */
function comp(op: number, kfTimes: number[], st = 0, ip = 0) {
  return {
    v: '5', fr: 30, ip, op, w: 100, h: 100,
    layers: [{
      ty: 4, nm: 'spinner', ind: 1, ip, op, st,
      ks: {
        r: { a: 1, k: kfTimes.map((t, i) => ({ t, s: [(i + 1) * 30], h: 0 })) },
        p: { a: 0, k: [50, 50] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, o: { a: 0, k: 100 },
      },
      shapes: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
               { ty: 'fl', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } }],
    }],
  };
}

test('keyframes past comp op are clamped to the comp playback window', () => {
  // op = 30 frames @ 30fps = 1s, but keyframes run out to frame 120 (4s) — as AE
  // exports often leave keyframes past the work area. lottie-web renders only
  // 0..op, so the emitted animation must be ~1s, not ~4s.
  const css = new Converter().convert(comp(30, [0, 30, 60, 90, 120]));
  expect(firstAnimDuration(css)).toBeCloseTo(1, 2);
});

test('layer start-time (st) still offsets an in-window animation (kept, not dropped)', () => {
  // Keyframes at t=60..120 with st=60 play at effective comp frames 120..180,
  // inside the 180-frame comp, so the animation survives and its delay includes
  // st: (60-0)/30 + 60/30 = 4s. This locks in lottie-web's (compFrame - st) model.
  const css = new Converter().convert(comp(180, [60, 120], /*st*/ 60, /*ip*/ 0));
  expect(firstAnimDelay(css)).toBeCloseTo(4, 2);
});

test('a windowed layer scheduled entirely past op holds its first keyframe (no anim)', () => {
  // st=60 shifts the keyframes (t=60,120) to effective comp frames 120,180 — both
  // past this comp's op=60, so lottie-web never plays them; the layer holds its
  // first-keyframe pose. The clamp must collapse the animation to a static value.
  const css = new Converter().convert(comp(60, [60, 120], /*st*/ 60, /*ip*/ 0));
  expect(css).not.toContain('animation:');
});

test('a hoisted union stroke samples the combined d on the UNION of every input grid', () => {
  // Two grouped rects animate on DIFFERENT keyframe grids ({0,10} and {5,15})
  // with different per-segment easings, sharing one group stroke. The hoisted
  // stroke must morph on the union grid {0,5,10,15} — sampling only the longest
  // (carrier) track let the stroke drift past the fills between its keyframes
  // (the cat-tail spikes). Union frames map to offsets 0/33.3/66.7/100%.
  const st = { ty: 'st', c: { a: 0, k: [0, 0, 0] }, w: { a: 0, k: 4 } };
  const css = new Converter().convert(hoistedStrokeComp(st));
  expect(validate(css)).toEqual([]);
  const kfHead = css.indexOf('@keyframes');
  const kfIdx = css.indexOf('-stroke', css.indexOf('stroke:')); // stroke node exists
  expect(kfIdx).toBeGreaterThan(-1);
  // Grab the stroke node's @keyframes block and count its keyframe stops.
  const block = css.slice(css.indexOf('@keyframes', kfHead), css.length);
  const strokeKf = block.match(/@keyframes[^\n]*-stroke-[\w-]*k\s*\{[\s\S]*?\n\}/);
  expect(strokeKf).not.toBeNull();
  const stops = strokeKf![0].match(/^\s*[\d.]+%\s*\{/gm) || [];
  expect(stops.length).toBe(4); // union of both grids, not just one carrier track
  // The frames unique to each grid must both survive: 5→33.33%, 10→66.67%.
  expect(strokeKf![0]).toContain('33.33%');
  expect(strokeKf![0]).toContain('66.67%');
});

test('Lottie lj/ml map onto stroke-linejoin / stroke-miterlimit (non-default only)', () => {
  // lj 2 -> round, ml 3 (non-default; player defaults miter/4). On the hoisted stroke node.
  const round = new Converter().convert(hoistedStrokeComp({ ty: 'st', c: { a: 0, k: [0, 0, 0] }, w: { a: 0, k: 4 }, lj: 2, ml: 3 }));
  expect(validate(round)).toEqual([]);
  expect(round).toContain('stroke-linejoin: round');
  expect(round).toContain('stroke-miterlimit: 3');
  // lj 3 -> bevel.
  const bevel = new Converter().convert(hoistedStrokeComp({ ty: 'st', c: { a: 0, k: [0, 0, 0] }, w: { a: 0, k: 4 }, lj: 3 }));
  expect(bevel).toContain('stroke-linejoin: bevel');
  // lj 1 (miter) + ml 4 are the defaults -> nothing emitted (lean output).
  const miter = new Converter().convert(hoistedStrokeComp({ ty: 'st', c: { a: 0, k: [0, 0, 0] }, w: { a: 0, k: 4 }, lj: 1, ml: 4 }));
  expect(miter).not.toContain('stroke-linejoin');
  expect(miter).not.toContain('stroke-miterlimit');
});

test("a solid parent's opacity dims only its own rect, never its parented children", () => {
  // Lottie parenting inherits transform only, never opacity. A solid used as a
  // transform-control parent (here o=0, like lottie-logo's MASTER null-solid)
  // must not push its opacity onto the wrapper group, or every parented child
  // vanishes — the whole scene renders blank but the background. Its opacity
  // belongs on its own rect.
  const css = new Converter().convert({
    v: '5', fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [
      { ty: 1, nm: 'ctrl', ind: 1, ip: 0, op: 30, st: 0, sw: 100, sh: 100, sc: '#000000',
        ks: { r: { a: 0, k: 0 }, p: { a: 0, k: [50, 50] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, o: { a: 0, k: 0 } } },
      { ty: 4, nm: 'dot', ind: 2, parent: 1, ip: 0, op: 30, st: 0,
        ks: { r: { a: 0, k: 0 }, p: { a: 0, k: [10, 10] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, o: { a: 0, k: 100 } },
        shapes: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } },
                 { ty: 'fl', c: { a: 0, k: [1, 0, 0] }, o: { a: 0, k: 100 } }] },
    ],
  });
  // The wrapper group's own decls (before its first child) carry no opacity.
  const groupDecls = css.slice(css.indexOf('#ctrl {'), css.indexOf('> #ctrl-rect'));
  expect(groupDecls).not.toContain('opacity');
  // The solid's own rect keeps the opacity 0 (it is what is invisible).
  const rectBlock = css.slice(css.indexOf('#ctrl-rect {'), css.indexOf('> #dot'));
  expect(rectBlock).toContain('opacity: 0');
});

// --- gradient alpha-stop merge + exact geometry -----------------------------

/** One shape layer whose single fill is the given gradient item (`gf`). */
function gradComp(gf: any) {
  return {
    v: '5', fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [{
      ty: 4, nm: 'g', ind: 1, ip: 0, op: 30, st: 0,
      ks: { r: { a: 0, k: 0 }, p: { a: 0, k: [50, 50] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, o: { a: 0, k: 100 } },
      shapes: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] } }, gf],
    }],
  };
}
const gf = (t: number, extra: any, gk: number[], p: number) => ({
  ty: 'gf', t, o: { a: 0, k: 100 },
  s: { a: 0, k: [0, 0] }, e: { a: 0, k: [10, 0] }, h: { a: 0, k: 0 }, a: { a: 0, k: 0 },
  g: { p, k: { a: 0, k: gk } }, ...extra,
});
const fillOf = (css: string) => css.match(/fill:\s*((?:radial|linear)-gradient\([^;\n]*\))/)![1];

test('alpha tail merges into color stops as rgba() at merged positions', () => {
  // 2 color stops (white@0, black@1) + alpha tail (a=1@0, a=0@1) -> fade to transparent.
  const css = new Converter().convert(gradComp(gf(2, {}, [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0], 2)));
  const fill = fillOf(css);
  expect(fill).toContain('#ffffff 0%');
  expect(fill).toContain('rgba(0, 0, 0, 0) 100%');
});

test('alpha keys not aligned with color keys insert interpolated rgba stops', () => {
  // colors white@0, black@1; alphas 1@0, 0@0.5, 1@1 -> midpoint is grey, alpha 0.
  const css = new Converter().convert(gradComp(gf(2, {}, [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0.5, 0, 1, 1], 2)));
  const fill = fillOf(css);
  expect(fill).toContain('rgba(128, 128, 128, 0) 50%');
});

test('radial gradient emits exact circle geometry (radius from |e-s|, center s)', () => {
  const css = new Converter().convert(gradComp({ ...gf(2, {}, [0, 1, 1, 1, 1, 0, 0, 0], 2), s: { a: 0, k: [10, 20] }, e: { a: 0, k: [10, 120] } }));
  expect(fillOf(css)).toMatch(/^radial-gradient\(circle 100px at 10px 20px,/);
});

test('radial highlight (h%, angle a) offsets the focal via `from fx fy`', () => {
  // center (10,20), e straight down -> base angle 90deg; h=50% of r=100 -> focal 50 below center.
  const css = new Converter().convert(gradComp({ ...gf(2, {}, [0, 1, 1, 1, 1, 0, 0, 0], 2), s: { a: 0, k: [10, 20] }, e: { a: 0, k: [10, 120] }, h: { a: 0, k: 50 }, a: { a: 0, k: 0 } }));
  expect(fillOf(css)).toContain('from 10px 70px');
});

test('linear gradient emits exact from/to endpoints (not a bbox angle)', () => {
  const css = new Converter().convert(gradComp({ ...gf(1, {}, [0, 1, 0, 0, 1, 0, 0, 1], 2), s: { a: 0, k: [0, 0] }, e: { a: 0, k: [100, 50] } }));
  expect(fillOf(css)).toMatch(/^linear-gradient\(from 0px 0px to 100px 50px,/);
});
