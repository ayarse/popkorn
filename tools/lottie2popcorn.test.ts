import { test, expect } from 'bun:test';
import { Converter } from './lottie2popcorn.ts';

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
