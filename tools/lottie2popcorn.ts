/**
 * Lottie JSON -> Popcorn DSL converter core.
 *
 * Pure conversion logic — no Node builtins (fs/path/process), so this module
 * is importable from both the `lottie2popcorn-cli.ts` CLI wrapper and browser
 * code (e.g. the demo's "Import Lottie" tool). The mapping is documented
 * inline where it earns comment; the high-level model: a Lottie comp becomes
 * a :root stage block plus one top-level rule per layer (emitted in REVERSE layer order
 * because Lottie paints last-to-first and Popcorn paints first-behind). Layer
 * transforms bake into transform/transform-origin/opacity; animated
 * properties become one @keyframes per node on the union of keyframe times;
 * spatial position keyframes become a CSS motion path.
 */
import { parse } from '../packages/popcorn-parser/src/index.ts';
import { buildSceneGraph } from '../packages/popcorn-player/src/scene/builder.ts';
import { parsePath, computePathLength } from '../packages/popcorn-player/src/scene/path-parser.ts';
import { polystarToCommands } from '../packages/popcorn-player/src/scene/polystar.ts';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Round to `dec` decimals, kill -0/NaN/Inf, no scientific notation. */
function num(x: number, dec = 2): string {
  if (!isFinite(x)) x = 0;
  const p = Math.pow(10, dec);
  let r = Math.round(x * p) / p;
  if (Object.is(r, -0)) r = 0;
  return String(r);
}

function asArr(s: unknown): number[] {
  return Array.isArray(s) ? (s as number[]) : [s as number];
}

/** first-of-axis: per-axis Lottie tangents store x/y as arrays; scalar as number. */
function first(v: unknown): number {
  return Array.isArray(v) ? (v as number[])[0] : (v as number);
}

/** cubic-bezier()/step-end easing from a keyframe's departing tangents (kf.o/kf.i),
 *  matching the per-segment convention used elsewhere. Null if none/degenerate. */
function tmEasing(kf: Kf): string | null {
  if (kf.h === 1) return 'step-end';
  if (!kf.o || !kf.i) return null;
  const ox = first(kf.o.x), oy = first(kf.o.y), ix = first(kf.i.x), iy = first(kf.i.y);
  if ([ox, oy, ix, iy].some((v) => v === undefined || isNaN(v))) return null;
  return `cubic-bezier(${num(ox, 3)}, ${num(oy, 3)}, ${num(ix, 3)}, ${num(iy, 3)})`;
}

/**
 * [r,g,b,a] in 0..1 (a optional) times an extra opacity 0..1 -> #rrggbb / rgba().
 * Some Lottie exports use 0..255 integer components instead of the standard
 * 0..1 floats; if any component exceeds 1, treat the whole array as 0..255.
 */
function lottieColor(c: number[], opacity = 1): string {
  const scale = c.some((v) => v > 1) ? 1 / 255 : 1;
  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * scale * 255)));
  const r = to255(c[0]), g = to255(c[1]), b = to255(c[2]);
  const a = (c.length > 3 ? c[3] * scale : 1) * opacity;
  if (a >= 0.999) {
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${num(a, 3)})`;
}

// ---------------------------------------------------------------------------
// Lottie property accessors
// ---------------------------------------------------------------------------

type Kf = { t: number; s?: number | number[]; i?: any; o?: any; h?: number; to?: number[]; ti?: number[] };
interface Prop {
  animated: boolean;
  kfs: Kf[] | null;
  at: (t: number) => number[];
}

/**
 * Wrap a Lottie animatable property { a, k } into an accessor, absorbing the
 * real-world encoding quirks the rest of the converter should never see:
 *   - `k` may be a bare scalar, a value array, or a keyframe array;
 *   - `a` may be absent (animation is inferred from k being an array of {t,…});
 *   - split position `{ s: true, x, y }` is sampled onto a union keyframe grid;
 *   - legacy keyframes (`e` end-values, omitted final `s`, scalar `s`) are
 *     rewritten to the modern start-value-per-keyframe form (see normalizeKfs).
 */
export function prop(p: any): Prop | null {
  if (p == null) return null;

  // Split position/anchor: separately animated x/y (and rarely z) scalars.
  if (p.s === true && (p.x !== undefined || p.y !== undefined)) return splitProp(p);

  const kfs = keyframesOf(p);
  if (kfs) return { animated: true, kfs, at: (t) => sampleAt(kfs, t) };

  const v = asArr(p.k);
  return { animated: false, kfs: null, at: () => v };
}

/** True keyframe array? Inferred from shape (array of {t,…}) even when `a` lies. */
function keyframesOf(p: any): Kf[] | null {
  const k = p.k;
  if (Array.isArray(k) && k.length > 0 && k[0] && typeof k[0] === 'object' && 't' in k[0]) {
    return normalizeKfs(k);
  }
  // `a:1` with a degenerate/empty k still means "animated"; normalize what's there.
  if (p.a === 1 && Array.isArray(k)) return normalizeKfs(k);
  return null;
}

/**
 * Rewrite a raw keyframe list into the canonical form the sampler expects:
 * sorted by t, every keyframe carrying an array `s`. Legacy exports store the
 * segment end value as `e` on the departing keyframe and may omit the arriving
 * keyframe's `s` (including the final one) — fill each missing `s` from the
 * previous keyframe's `e` (else its `s`). Scalar `s`/`e` are wrapped. Null or
 * zero spatial tangents are left for hasSpatialTangents to treat as absent.
 */
export function normalizeKfs(raw: any[]): Kf[] {
  const sorted = raw.filter((k) => k && typeof k === 'object').slice().sort((a, b) => (a.t || 0) - (b.t || 0));
  const out: Kf[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i];
    let s = k.s;
    if (s == null) {
      const prev = sorted[i - 1];
      s = prev ? prev.e ?? prev.s : undefined;
    }
    if (s == null) s = k.e ?? [0];
    out.push({
      t: k.t || 0,
      s: asArr(s),
      i: k.i,
      o: k.o,
      h: k.h,
      to: k.to ?? undefined,
      ti: k.ti ?? undefined,
    });
  }
  return out;
}

/**
 * Split position `{ s:true, x:{…}, y:{…} }`: build a normal Prop by sampling
 * both axis curves onto the union of their keyframe times. Reuses prop()/
 * sampleAt so each axis's own scalar-vs-keyframe encoding is handled uniformly.
 */
export function splitProp(p: any): Prop {
  const x = prop(p.x) ?? { animated: false, kfs: null, at: () => [0] };
  const y = prop(p.y) ?? { animated: false, kfs: null, at: () => [0] };
  const at = (t: number) => [x.at(t)[0] ?? 0, y.at(t)[0] ?? 0];

  if (!x.animated && !y.animated) {
    const v = at(0);
    return { animated: false, kfs: null, at: () => v };
  }

  const times = [...new Set([...(x.kfs ?? []), ...(y.kfs ?? [])].map((k) => k.t))].sort((a, b) => a - b);
  const kfs: Kf[] = times.map((t) => {
    // Carry easing/hold from whichever axis owns a native keyframe here (x wins).
    const src = x.kfs?.find((k) => k.t === t) ?? y.kfs?.find((k) => k.t === t);
    return { t, s: at(t), i: src?.i, o: src?.o, h: src?.h };
  });
  return { animated: true, kfs, at };
}

/**
 * Do the two axes of a split position/scale genuinely need per-axis timing?
 * True when their keyframe grids differ, or (same grid) any per-segment easing
 * or hold differs. When false the axes are interchangeable and the cleaner
 * combined translate()/scale() is exact — so we only split when __KEEP_MASKRS__.
 */
export function axesDiverge(x: Prop, y: Prop): boolean {
  const xk = x.kfs, yk = y.kfs;
  if (!xk || !yk) return false;
  if (xk.length !== yk.length || xk.some((k, i) => k.t !== yk[i].t)) return true;
  const ez = (k: Kf) =>
    k.h === 1 ? 'h' : k.o && k.i ? `${first(k.o.x)},${first(k.o.y)},${first(k.i.x)},${first(k.i.y)}` : '';
  return xk.some((k, i) => ez(k) !== ez(yk[i]));
}

/** Linear sample of a keyframe list at frame t (ignores easing; for cross-sampling). */
function sampleAt(kfs: Kf[], t: number): number[] {
  const n = kfs.length;
  if (t <= kfs[0].t) return asArr(kfs[0].s);
  if (t >= kfs[n - 1].t) return asArr(kfs[n - 1].s);
  for (let i = 0; i < n - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t - a.t > 0 ? (t - a.t) / (b.t - a.t) : 0;
      const sa = asArr(a.s), sb = asArr(b.s);
      return sa.map((v, idx) => v + ((sb[idx] ?? v) - v) * f);
    }
  }
  return asArr(kfs[n - 1].s);
}

/** Linear-sample a position-sorted stop list at `p` (clamped at both ends). */
function sampleStopScalar<T extends { pos: number }>(stops: T[], p: number, get: (s: T) => number): number {
  if (p <= stops[0].pos) return get(stops[0]);
  const last = stops[stops.length - 1];
  if (p >= last.pos) return get(last);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (p >= a.pos && p <= b.pos) {
      const f = b.pos - a.pos > 0 ? (p - a.pos) / (b.pos - a.pos) : 0;
      return get(a) + (get(b) - get(a)) * f;
    }
  }
  return get(last);
}

function hasSpatialTangents(kfs: Kf[]): boolean {
  return kfs.some(
    (k) =>
      (Array.isArray(k.to) && k.to.some((v) => Math.abs(v) > 1e-6)) ||
      (Array.isArray(k.ti) && k.ti.some((v) => Math.abs(v) > 1e-6))
  );
}

// ---------------------------------------------------------------------------
// Intermediate rule tree
// ---------------------------------------------------------------------------

interface Channel {
  priority: number; // easing/offset owner tie-break (higher wins)
  kfs: Kf[]; // driving keyframes (for union of times + per-segment easing)
  sample: (t: number) => Sample; // dsl values at a frame
}
type Sample = Partial<{
  tx: number; ty: number; txx: number; txy: number; rot: number; sx: number; sy: number;
  opacity: number; cx: number; cy: number; rx: number; ry: number;
  x: number; y: number; width: number; height: number;
  fill: string; stroke: string; strokeWidth: number;
  offsetDistance: number; trimStart: number; trimEnd: number; trimOffset: number;
  outerRadius: number; innerRadius: number; starRotation: number;
  d: string;
  clipPath: string; // full clip-path list value, e.g. `path('…') path('…')`
}>;

/** A shape-level trim (Lottie 'tm'), static or per-property animated. */
type TrimInfo = {
  start: number; end: number; offset: number;
  startCh: { kfs: Kf[]; sample: (t: number) => Sample } | null;
  endCh: { kfs: Kf[]; sample: (t: number) => Sample } | null;
  offsetCh: { kfs: Kf[]; sample: (t: number) => Sample } | null;
};

/** Per-comp context threaded through layer conversion. */
interface LayerCtx {
  childrenOf: Map<number, any[]>;
  prefix: string;
  ruleByInd: Map<number, Rule>;
  compIp: number; // containing comp's in-point (frames)
  compOp: number; // containing comp's out-point (frames)
  byInd: Map<number, any>;
  indexByInd: Map<number, number>; // ind -> global stack index (array order)
}

/** Paint style inherited from an enclosing group down to descendant shapes. */
interface InheritedStyle {
  fill: string | null;
  stroke: string | null;
  strokeCh: ((t: number) => Sample) | null;
  strokeKfs: Kf[] | null;
  strokeWidth: number | null;
  lineCap: string | null;
  lineJoin: string | null;
  miterLimit: number | null;
  dashArray: number[] | null;
  dashOffset: number;
  trim: TrimInfo | null;
}
const EMPTY_STYLE: InheritedStyle = {
  fill: null, stroke: null, strokeCh: null, strokeKfs: null, strokeWidth: null,
  lineCap: null, lineJoin: null, miterLimit: null, dashArray: null, dashOffset: 0, trim: null,
};

/**
 * A solid-color channel driven by the union of a color track and an opacity
 * track (Lottie keeps a fill/stroke's `c` and `o` on separate timelines). One
 * or both may animate; sample the color at each merged keyframe time, folding
 * opacity into its alpha via `lottieColor` (which emits rgba() for alpha<1).
 * `key` is the DSL property the channel writes ('fill' or 'stroke'). Mirrors
 * the `gf` grid-union pattern. Callers guarantee at least one track animates.
 */
function colorOpacityChannel(
  c: ReturnType<typeof prop>,
  o: ReturnType<typeof prop>,
  key: 'fill' | 'stroke'
): { base: string; ch: (t: number) => Sample; kfs: Kf[] } {
  const tracks: Kf[][] = [];
  if (c && c.animated && c.kfs) tracks.push(c.kfs);
  if (o && o.animated && o.kfs) tracks.push(o.kfs);
  const times = [...new Set(tracks.flatMap((k) => k.map((kf) => kf.t)))].sort((a, b) => a - b);
  const kfs: Kf[] = times.map((t) => {
    const src = tracks.map((tk) => tk.find((kf) => kf.t === t)).find(Boolean);
    return { t, i: src?.i, o: src?.o, h: src?.h };
  });
  const opAt = (t: number) => (o ? (o.at(t)[0] ?? 100) / 100 : 1);
  const colorAt = (t: number) => (c ? c.at(t) : [0, 0, 0]);
  const swatch = (t: number) => lottieColor(colorAt(t), opAt(t));
  const ch = (t: number): Sample =>
    key === 'fill' ? { fill: swatch(t) } : { stroke: swatch(t) };
  return { base: swatch(times[0]), ch, kfs };
}

/** One emitted @keyframes + its animation-shorthand timing, for a single channel. */
interface AnimSpec {
  name: string;
  blocks: { offset: number; decls: string[]; easing?: string }[];
  durationSec: number;
  delaySec: number;
  // Modal per-segment easing, hoisted into the `animation:` shorthand's timing
  // slot so matching keyframes can drop their own `animation-timing-function`.
  // The player resolves `prev.easing || defaultEasing`, so this is loss-free.
  defaultEasing: string;
}

interface Rule {
  id: string;
  type: string; // group | rect | circle | ellipse | path
  decls: string[];
  channels: Channel[];
  children: Rule[];
  // One anim per animated channel, so each keeps its own keyframe times and
  // per-segment easing (emitted as a comma-separated `animation:` list). Distinct
  // transform components (translate/rotate/scale/opacity) never share a timeline.
  anims?: AnimSpec[];
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

const BLOCKED_MODIFIERS: Record<string, string> = {
  rp: 'repeater (rp)',
  rd: 'round-corners (rd)',
  op: 'offset-path modifier (op)',
  zz: 'zig-zag (zz)',
  pb: 'pucker-bloat (pb)',
};

/**
 * Doc-level normalization run once before conversion: give every layer a stable
 * `ind` (synthetic negative ids for the ones production exports omit, so parent
 * resolution and id derivation always have something to key on). Property- and
 * item-level quirks are absorbed at their point of use (prop(), processItems).
 */
export function normalizeDoc(lottie: any): void {
  const fixInds = (layers: any[]) => {
    const used = new Set<number>();
    for (const l of layers) if (l && typeof l.ind === 'number') used.add(l.ind);
    let synth = -1;
    for (const l of layers) {
      if (!l || typeof l.ind === 'number') continue;
      while (used.has(synth)) synth--;
      l.ind = synth;
      used.add(synth);
    }
  };
  if (Array.isArray(lottie.layers)) fixInds(lottie.layers);
  if (Array.isArray(lottie.assets)) for (const a of lottie.assets) if (a && Array.isArray(a.layers)) fixInds(a.layers);
}

export class Converter {
  warnings: string[] = [];
  blocked = new Set<string>();
  private ids = new Set<string>();
  private synthId = 1;
  private assets = new Map<string, any>();
  // Each emitted image node's content decl list + its asset id/data URI, so a data
  // URI referenced by more than one node can be hoisted into a single :root
  // custom property instead of being inlined (and duplicated) at every use.
  private imageUses: { decls: string[]; assetId: string; uri: string }[] = [];
  // refIds of precomps currently being expanded, for cycle detection.
  private compStack = new Set<string>();
  fr = 60;
  ip = 0;
  // Playback window [ip, op] (frames) of the comp currently being built, used to
  // clamp animation windows to what lottie-web actually renders. Set per comp in
  // buildLayerList (save/restore around precomp recursion).
  private clampIp = -Infinity;
  private clampOp = Infinity;

  warnOnce(msg: string) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  private uniqueId(raw: string): string {
    // Sanitize to a valid DSL ident: ascii word chars only, no leading digit,
    // no leading/trailing dashes. Unicode/emoji names collapse away, so fall
    // back to a synthetic base; collisions get deterministic -2/-3 suffixes.
    let base = String(raw ?? '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!base || !/^[a-zA-Z_]/.test(base)) base = ('l-' + base).replace(/-+$/g, '');
    if (base === 'l-' || base === 'l') base = 'l-' + (this.synthId++);
    let id = base;
    let n = 2;
    while (this.ids.has(id)) id = `${base}-${n++}`;
    this.ids.add(id);
    return id;
  }

  convert(lottie: any): string {
    normalizeDoc(lottie);
    this.fr = lottie.fr || 60;
    this.ip = lottie.ip || 0;
    const op = lottie.op || 0;
    const w = lottie.w || 800;
    const h = lottie.h || 600;
    const durSec = (op - this.ip) / this.fr;

    // Index assets by id for image (ty 2) layers.
    if (Array.isArray(lottie.assets)) for (const a of lottie.assets) {
      if (!a || a.id == null) continue;
      if (this.assets.has(a.id)) this.warnOnce(`duplicate asset id '${a.id}'; last one wins`);
      this.assets.set(a.id, a);
    }

    const layers: any[] = Array.isArray(lottie.layers) ? lottie.layers : [];
    const topRules = this.buildLayerList(layers, '', this.ip, op);

    // Hoist any data URI used by more than one node into a shared :root var.
    const rootVars = this.dedupeImages();

    // Serialize the body (keyframes + rules), then hoist repeated path geometry
    // into shared :root vars — a d-string reused at N sites is N-1 duplicate
    // copies of a large token. Runs on the assembled text so static geometry and
    // keyframe morph targets dedupe together (same spirit as image dedup above).
    const keyframeBlocks: string[] = [];
    const collectKf = (r: Rule) => {
      if (r.anims) for (const a of r.anims) keyframeBlocks.push(serializeKeyframes(a));
      r.children.forEach(collectKf);
    };
    topRules.forEach(collectKf);
    const bodyParts: string[] = [];
    if (keyframeBlocks.length) bodyParts.push(keyframeBlocks.join('\n\n'));
    for (const r of topRules) bodyParts.push(serializeRule(r, 0, true));
    const { body, vars: pathVars } = dedupePaths(bodyParts.join('\n\n'));

    // Serialize.
    const out: string[] = [];
    out.push(`/* Generated from Lottie by tools/lottie2popcorn.ts */`);
    out.push(`/* comp ${w}x${h} @ ${this.fr}fps, duration ${num(durSec)}s */`);
    out.push('');
    // Stage config and hoisted image/path custom properties share one `:root`.
    out.push(`:root {`);
    out.push(`  width: ${num(w)}px;`);
    out.push(`  height: ${num(h)}px;`);
    out.push(...rootVars);
    out.push(...pathVars);
    out.push(`}`);
    out.push('');
    out.push(body);

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  // --- layer list -> rules ------------------------------------------------

  /**
   * A data URI inlined at N>1 use sites is N-1 copies of dead weight (the FIFA
   * preloader is 5x101KB = 51% of its output). Rewrite each such `content: url(…)`
   * to `content: var(--img-<id>)` and return the `:root` declarations that define
   * each URI once.
   * Single-use assets stay inlined, so image-free / single-image files are
   * byte-identical to before.
   */
  private dedupeImages(): string[] {
    const count = new Map<string, number>();
    for (const u of this.imageUses) count.set(u.assetId, (count.get(u.assetId) || 0) + 1);
    const vars: string[] = [];
    const seen = new Set<string>();
    for (const u of this.imageUses) {
      if ((count.get(u.assetId) || 0) < 2) continue;
      const varName = `--img-${u.assetId.replace(/[^\w-]/g, '-')}`;
      const i = u.decls.findIndex((d) => d.startsWith('content:'));
      if (i >= 0) u.decls[i] = `content: var(${varName})`;
      if (!seen.has(u.assetId)) {
        seen.add(u.assetId);
        vars.push(`  ${varName}: url('${u.uri}');`);
      }
    }
    return vars;
  }

  private isConvertible(l: any): boolean {
    return l && (l.ty === 0 || l.ty === 1 || l.ty === 2 || l.ty === 3 || l.ty === 4);
  }

  /**
   * Convert one composition's layer list (the root comp, or a precomp asset's
   * layers) into top-level rules. Parenting, reverse paint order, and track
   * masks are all resolved locally within the list. `prefix` namespaces ids so
   * multiple instances of the same precomp never collide.
   */
  private buildLayerList(layers: any[], prefix: string, compIp: number, compOp: number): Rule[] {
    // Scope the animation-clamp window to this comp (restored after, so a nested
    // precomp's window doesn't leak back into its parent).
    const prevClampIp = this.clampIp, prevClampOp = this.clampOp;
    this.clampIp = compIp; this.clampOp = compOp;

    const byInd = new Map<number, any>();
    // Global paint-stack index of each layer (array order; earlier = on top).
    // Used to assign z-index so nested parented layers reproduce Lottie's stack
    // order within the parent's slot (Lottie parenting is transform-only).
    const indexByInd = new Map<number, number>();
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (typeof l.ind === 'number') { byInd.set(l.ind, l); indexByInd.set(l.ind, i); }
    }

    // Record blocked non-convertible layer types.
    for (const l of layers) {
      if (this.isConvertible(l)) continue;
      const feat = l.ty === 5 ? 'text layer (ty 5)' : `layer type ${l.ty}`;
      this.blocked.add(feat);
    }

    // Layer effects (`ef`): Gaussian Blur (ty 29) and Drop Shadow (ty 25) map to
    // CSS `filter` (see effectFilterDecl, emitted per layer in buildLayerRule).
    // Every OTHER effect is still unsupported — surface each so the drop isn't
    // silent (matching shipping canvas players, which skip effects too). It's a
    // warning, not a hard block, so the layer still converts — just without it.
    for (const l of layers) {
      if (!this.isConvertible(l) || !Array.isArray(l.ef)) continue;
      for (const e of l.ef) {
        if (!e || e.en === 0) continue;
        if (e.ty === 29 || e.ty === 25) continue; // converted to filter:
        const name = typeof e.nm === 'string' && e.nm.trim() ? e.nm.trim() : `type ${e.ty}`;
        this.warnOnce(`layer effect '${name}' is not supported and was ignored`);
      }
    }

    // A `td` layer is a track-matte source: never painted on its own, only
    // consumed as the matte for its `tt` partner. The linking loop below marks
    // consumed sources (the player then skips painting them). An *orphan* td
    // source with no tt consumer (a degenerate/minified export where a matte
    // sits over a non-matte layer) contributes nothing visible — shipping
    // players drop it; painting it floods the frame with the matte shape. So
    // collect the consumed source inds and drop the orphaned td layers.
    const consumedSrc = new Set<number>();
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (l.tt === undefined) continue;
      const srcInd = typeof l.tp === 'number' ? l.tp : layers[i - 1]?.ind;
      if (typeof srcInd === 'number') consumedSrc.add(srcInd);
    }
    const isOrphanMatte = (l: any) => !!l && !!l.td && typeof l.ind === 'number' && !consumedSrc.has(l.ind);

    // children[parentInd] = convertible child layers, array order preserved.
    const childrenOf = new Map<number, any[]>();
    const roots: any[] = [];
    for (const l of layers) {
      if (!this.isConvertible(l)) continue;
      if (isOrphanMatte(l)) { this.warnOnce(`orphan track-matte source '${l.nm ?? l.ind}' dropped (no tt consumer)`); continue; }
      const parent = l.parent;
      if (typeof parent === 'number' && this.isConvertible(byInd.get(parent)) && !isOrphanMatte(byInd.get(parent))) {
        (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(l);
      } else {
        if (typeof parent === 'number') this.warnOnce(`layer ${l.ind} references missing parent ${parent}; treated as unparented`);
        roots.push(l);
      }
    }

    const ruleByInd = new Map<number, Rule>();
    const ctx: LayerCtx = { childrenOf, prefix, ruleByInd, compIp, compOp, byInd, indexByInd };
    const buildLayer = (l: any): Rule | null => {
      try {
        return this.buildLayerRule(l, ctx);
      } catch (e: any) {
        this.warnOnce(`layer ${l.ind} skipped: ${e.message}`);
        return null;
      }
    };

    // Lottie paints last-to-first; Popcorn paints first-behind -> reverse.
    const topRules: Rule[] = [];
    for (const l of [...roots].reverse()) {
      const r = buildLayer(l);
      if (r) topRules.push(r);
    }

    // Track masks: a layer with `tt` is masked by its mask source (the layer
    // referenced by `tp`, else the one directly above). Emit `mask: #id <mode>`
    // on the content rule; the source rule is marked maskSource at build time.
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (l.tt === undefined) continue;
      const mode = MASK_MODE[l.tt];
      if (!mode) { this.blocked.add(`track mask mode tt:${l.tt}`); continue; }
      const content = ruleByInd.get(l.ind);
      const srcInd = typeof l.tp === 'number' ? l.tp : layers[i - 1]?.ind;
      const source = srcInd !== undefined ? ruleByInd.get(srcInd) : undefined;
      if (!content || !source) { this.blocked.add('track mask (unresolved source)'); continue; }
      content.decls.push(`mask: #${source.id} ${mode}`);
    }

    this.clampIp = prevClampIp;
    this.clampOp = prevClampOp;
    return topRules;
  }

  // --- layer -> rule ------------------------------------------------------

  /**
   * Map a layer's supported effects to a CSS `filter` declaration, or null.
   * Calibration mirrors lottie-web's SVG renderer:
   *   - Gaussian Blur (ty 29): `blur(Blurriness / 4 px)`.
   *   - Drop Shadow (ty 25, SVGDropShadowEffect): sub-effects in fixed order
   *     [0]=color (0..1 rgb), [1]=opacity (0..255), [2]=direction (deg),
   *     [3]=distance, [4]=softness. Offset dx = distance·cos((dir−90)°),
   *     dy = distance·sin((dir−90)°); blur = softness / 4; alpha = opacity / 255.
   * Animated effect params are baked to their first value with a warning.
   */
  private effectFilterDecl(l: any): string | null {
    if (!Array.isArray(l.ef)) return null;
    const name = l.nm || l.ind;
    const parts: string[] = [];
    for (const e of l.ef) {
      if (!e || e.en === 0) continue;
      if (e.ty === 29) {
        const sub = (e.ef || []).find((s: any) => s && s.nm === 'Blurriness') || (e.ef || [])[0];
        const p = sub && prop(sub.v);
        if (!p) continue;
        if (p.animated) this.warnOnce(`animated Gaussian Blur on '${name}' baked to its first value`);
        const px = (p.at(0)[0] ?? 0) / 4;
        if (px > 0) parts.push(`blur(${num(px)}px)`);
      } else if (e.ty === 25) {
        const sub = e.ef || [];
        const cp = prop(sub[0]?.v), op = prop(sub[1]?.v), dir = prop(sub[2]?.v), dist = prop(sub[3]?.v), soft = prop(sub[4]?.v);
        if ([cp, op, dir, dist, soft].some((x) => x && x.animated))
          this.warnOnce(`animated Drop Shadow on '${name}' baked to its first value`);
        const col = cp ? cp.at(0) : [0, 0, 0];
        const alpha = op ? (op.at(0)[0] ?? 255) / 255 : 1;
        const ang = ((dir ? (dir.at(0)[0] ?? 0) : 0) - 90) * Math.PI / 180;
        const distance = dist ? (dist.at(0)[0] ?? 0) : 0;
        const blur = (soft ? (soft.at(0)[0] ?? 0) : 0) / 4;
        const color = `rgba(${Math.round((col[0] ?? 0) * 255)}, ${Math.round((col[1] ?? 0) * 255)}, ${Math.round((col[2] ?? 0) * 255)}, ${num(alpha, 3)})`;
        parts.push(`drop-shadow(${num(distance * Math.cos(ang))}px ${num(distance * Math.sin(ang))}px ${num(blur)}px ${color})`);
      }
    }
    return parts.length ? `filter: ${parts.join(' ')}` : null;
  }

  private buildLayerRule(l: any, ctx: LayerCtx): Rule {
    const { childrenOf, prefix, ruleByInd, compIp, compOp, indexByInd } = ctx;
    const id = this.uniqueId(prefix ? `${prefix}-${l.nm || `layer-${l.ind}`}` : (l.nm || `layer-${l.ind}`));
    const st = l.st || 0;

    this.scanBlocked(l);
    const mask = this.maskClip(l);

    // Layer visibility window narrower than the comp -> emit visible-from/until
    // (scene-local seconds) so the player skips the node outside it. Sticker
    // exports swap a different layer in per time slice; rendering them all
    // full-time is what left frozen duplicate copies on screen.
    const visFrom = typeof l.ip === 'number' && l.ip > compIp ? l.ip : null;
    const visUntil = typeof l.op === 'number' && l.op < compOp ? l.op : null;
    // `maskTarget` is the rule a post-hoc track matte (buildLayerList :576-580)
    // and clip must land on. It is the outer `rule` unless the layer isolates its
    // clip/mask scope from transform-parented children in an inner wrapper, in
    // which case the matte must follow the clip onto that inner content rule.
    const record = (rule: Rule, maskTarget: Rule = rule): Rule => {
      if (visFrom != null) rule.decls.push(`visible-from: ${num(visFrom / this.fr, 3)}s`);
      if (visUntil != null) rule.decls.push(`visible-until: ${num(visUntil / this.fr, 3)}s`);
      const filterDecl = this.effectFilterDecl(l);
      if (filterDecl) rule.decls.push(filterDecl);
      if (typeof l.ind === 'number') ruleByInd.set(l.ind, maskTarget);
      return rule;
    };

    const childLayers = (childrenOf.get(l.ind) ?? []).slice().reverse();
    const childRules: Rule[] = [];
    const parentIdx = indexByInd.get(l.ind) ?? 0;
    for (const cl of childLayers) {
      try {
        const cr = this.buildLayerRule(cl, ctx);
        // Lottie parenting is transform-only: the child keeps its own global
        // stack slot. Nesting it under the parent would force it above the
        // parent's siblings, so restore the original order with a z-index
        // relative to the parent's own slot (0). Higher stack index = further
        // back => negative z (paints behind the parent's own shapes).
        const z = parentIdx - (indexByInd.get(cl.ind) ?? 0);
        if (z !== 0) cr.decls.push(`z-index: ${z}`);
        childRules.push(cr);
      } catch (e: any) {
        this.warnOnce(`child layer ${cl.ind} skipped: ${e.message}`);
      }
    }
    if (childLayers.length) this.checkStackRepresentable(l, ctx);

    if (l.ty === 0) {
      // Precomp layer: a group carrying the layer transform, with the referenced
      // comp's layers expanded as nested children (mirrors symbol expansion).
      const asset = this.assets.get(l.refId);
      if (!asset || !Array.isArray(asset.layers)) {
        this.blocked.add('precomp layer missing asset');
        throw new Error(`missing precomp asset '${l.refId}'`);
      }
      if (this.compStack.has(l.refId)) {
        this.blocked.add('precomp cycle');
        throw new Error(`precomp cycle at '${l.refId}'`);
      }
      const group: Rule = { id, type: 'group', decls: [], channels: [], children: [] };
      // st is applied as time-offset (below), which scopes the whole subtree, so
      // pass 0 here to avoid also folding it into the group's own delay.
      this.applyTransform(l.ks, group, 0);
      // Precomps clip to their comp box (per spec; harmless when content fits).
      // A layer mask is the tighter clip and shares the single `clip-path` slot,
      // so prefer it — never emit both (the second would clobber the first).
      const cw = l.w ?? asset.w, ch = l.h ?? asset.h;
      // Lottie parenting is transform-ONLY: the clip box and any track matte must
      // scope the precomp's own content but NEVER its transform-parented children.
      // When both a clip/mask and such children are present, hold the clip/mask +
      // the expanded comp content in an inner wrapper and keep the children as
      // plain transform siblings of it (record() points the post-hoc matte here).
      const emitsClip = !!mask || !!(cw && ch);
      const isolate = childRules.length > 0 && emitsClip;
      const content: Rule = isolate
        ? { id: this.uniqueId(`${id}-content`), type: 'group', decls: [], channels: [], children: [] }
        : group;
      if (mask) this.applyMask(content, mask);
      else if (cw && ch) content.decls.push(`clip-path: path('M0 0 H${num(cw)} V${num(ch)} H0 Z')`);

      // Time scoping. A keyframed time remap (tm) fully defines the local
      // timeline, so it subsumes st/sr; otherwise st -> time-offset and sr
      // stretch -> time-scale (1/sr, since Lottie sr=2 plays at half speed).
      const remapDecl = this.timeRemapDecl(l);
      if (remapDecl) {
        group.decls.push(remapDecl);
      } else {
        if (st) group.decls.push(`time-offset: ${num(st / this.fr, 3)}s`);
        if (typeof l.sr === 'number' && l.sr !== 1 && l.sr > 0) {
          group.decls.push(`time-scale: ${num(1 / l.sr, 4)}`);
        }
      }

      // Asset layers time in the asset's own frame space; map the precomp's
      // visible window [ip, op] (parent frames) through st/sr into that space so
      // inner visibility windows are measured against the right comp bounds. The
      // window is first intersected with the parent's playback range [compIp,
      // compOp]: a precomp only renders while it is on-screen, so this carries the
      // root comp's op down through nested precomps (a child animation can't
      // outlast the ancestor comp that stopped rendering it). Under a time remap
      // the parent->source mapping is nonlinear, so the linear window clamp no
      // longer applies; the group's own visible-from/until (parent time) already
      // gates the subtree, so pass the asset's native frame space unclamped.
      const sr = typeof l.sr === 'number' && l.sr > 0 ? l.sr : 1;
      const lip = Math.max(typeof l.ip === 'number' ? l.ip : compIp, compIp);
      const lop = Math.min(typeof l.op === 'number' ? l.op : compOp, compOp);
      const aip = remapDecl ? 0 : (lip - st) / sr;
      const aop = remapDecl ? Number.POSITIVE_INFINITY : (lop - st) / sr;
      this.compStack.add(l.refId);
      const assetRules = this.buildLayerList(asset.layers, id, aip, aop);
      this.compStack.delete(l.refId);
      if (content !== group) {
        content.children.push(...assetRules);
        this.finalizeAnim(content);
        group.children.push(content, ...childRules);
      } else {
        group.children.push(...assetRules, ...childRules);
      }
      this.finalizeAnim(group);
      return record(group, content);
    }

    if (l.ty === 2) {
      // Image layer: draw the referenced asset in its natural-size box; the
      // layer transform (with the anchor as transform-origin) positions it.
      const asset = this.assets.get(l.refId);
      if (!asset) { this.blocked.add('image layer missing asset'); throw new Error(`missing asset '${l.refId}'`); }
      const img: Rule = { id, type: 'image', decls: [], channels: [], children: [] };
      const uri = assetSrc(asset);
      img.decls.push(`content: url('${uri}')`, `x: 0`, `y: 0`);
      this.imageUses.push({ decls: img.decls, assetId: l.refId, uri });
      if (asset.w) img.decls.push(`width: ${num(asset.w)}px`);
      if (asset.h) img.decls.push(`height: ${num(asset.h)}px`);
      this.applyTransform(l.ks, img, st);
      if (mask) this.applyMask(img, mask);
      img.children.push(...childRules);
      this.finalizeAnim(img);
      return record(img);
    }

    if (l.ty === 1) {
      // Solid: a rect of sw x sh filled with sc, plus the layer transform.
      const rect: Rule = { id, type: 'rect', decls: [], channels: [], children: [] };
      rect.decls.push(`x: 0`, `y: 0`, `width: ${num(l.sw)}px`, `height: ${num(l.sh)}px`);
      if (l.sc) rect.decls.push(`fill: ${l.sc}`);
      this.applyTransform(l.ks, rect, st);
      if (childRules.length === 0) {
        if (mask) this.applyMask(rect, mask);
        this.finalizeAnim(rect);
        return record(rect);
      }
      // Solid used as a parent: wrap the rect in a group carrying the transform.
      // Lottie parenting inherits transform only (never opacity), so the solid's
      // own opacity stays on its rect and the wrapper must not carry it, or a
      // 0/dimmed control solid would wrongly dim every parented child.
      const group: Rule = { id, type: 'group', decls: [], channels: [], children: [] };
      this.applyTransform(l.ks, group, st, { skipOpacity: true });
      if (mask) this.applyMask(group, mask);
      rect.id = this.uniqueId(id + '-rect');
      rect.decls = rect.decls.filter((d) => !d.startsWith('transform'));
      rect.channels = [];
      group.children.push(rect, ...childRules);
      this.finalizeAnim(group);
      return record(group);
    }

    // Null (ty 3) and shape (ty 4) are both groups.
    const group: Rule = { id, type: 'group', decls: [], channels: [], children: [] };
    // A null draws nothing and Lottie parenting inherits transform only (never
    // opacity), so a null's opacity affects nothing — dropping it stops a
    // 0/animated control null from wrongly dimming its parented children.
    this.applyTransform(l.ks, group, st, { skipOpacity: l.ty === 3 });
    if (mask) this.applyMask(group, mask);

    if (l.ty === 4 && Array.isArray(l.shapes)) {
      const shapeChildren = this.processItems(l.shapes, id, EMPTY_STYLE);
      group.children.push(...shapeChildren);
    }
    group.children.push(...childRules);
    this.finalizeAnim(group);
    return record(group);
  }

  /**
   * We reproduce a parent's stack order by nesting its parented children and
   * z-indexing them, which can order everything WITHIN the parent's subtree
   * exactly. It fails only when the subtree isn't contiguous in the global paint
   * stack: a real, non-descendant drawable falling inside the subtree's index
   * span paints outside the subtree block, so exact order is unrepresentable.
   * Warn once (naming the parent + interleaver) and keep the nearest z order.
   */
  private checkStackRepresentable(parent: any, ctx: LayerCtx) {
    const { childrenOf, byInd, indexByInd } = ctx;
    const subtree = new Set<number>();
    const collect = (ind: number) => {
      subtree.add(ind);
      for (const c of childrenOf.get(ind) ?? []) collect(c.ind);
    };
    collect(parent.ind);
    let lo = Infinity, hi = -Infinity;
    for (const ind of subtree) {
      const i = indexByInd.get(ind);
      if (i !== undefined) { lo = Math.min(lo, i); hi = Math.max(hi, i); }
    }
    for (const m of byInd.values()) {
      const mi = indexByInd.get(m.ind);
      if (mi === undefined || mi <= lo || mi >= hi) continue;
      if (subtree.has(m.ind)) continue;
      // Nulls (ty 3) paint nothing, so they can't visually interleave.
      if (m.ty === 3) continue;
      this.warnOnce(
        `layer '${parent.nm || parent.ind}' subtree stack order is approximate ` +
        `(unrelated layer '${m.nm || m.ind}' interleaves it; nearest z-index used)`
      );
      return;
    }
  }

  private scanBlocked(l: any) {
    // tm on a precomp (ty 0) becomes a time-remap curve (below); on any other
    // layer type there is no source timeline to remap, so it is ignored.
    if (l.tm !== undefined && l.ty !== 0) {
      this.warnOnce('time remap (tm) ignored on non-precomp layer');
    }
  }

  /**
   * Layer time remap (Lottie 'tm') -> a `time-remap` curve: `<in>s <out>s
   * [easing]` stops where input is parent-comp seconds (keyframe time / fr) and
   * output is the source time the tm keyframe holds (already seconds). Departing
   * tangents map onto per-segment easing. Null for absent/static/degenerate tm,
   * which then falls back to plain st/sr time scoping.
   */
  private timeRemapDecl(l: any): string | null {
    const tm = l.tm;
    if (!tm || !Array.isArray(tm.k) || typeof tm.k[0] !== 'object') return null;
    const kfs = normalizeKfs(tm.k);
    if (kfs.length < 2) return null;
    const stops: string[] = [];
    for (let i = 0; i < kfs.length; i++) {
      const kf = kfs[i];
      const out = first(kf.s);
      if (out === undefined || isNaN(out)) continue;
      let stop = `${num(kf.t / this.fr, 3)}s ${num(out, 3)}s`;
      // Departing-keyframe easing governs the segment to the next stop.
      if (i < kfs.length - 1) {
        const e = tmEasing(kf);
        if (e) stop += ` ${e}`;
      }
      stops.push(stop);
    }
    return stops.length >= 2 ? `time-remap: ${stops.join(', ')}` : null;
  }

  /**
   * Layer masks (masksProperties) -> a `clip-path` with one path() per mask,
   * unioned. Modelled on lottie-web's *canvas* renderer (Popcorn's target),
   * whose CVMaskElement clips to the nonzero union of every mask whose mode
   * isn't 'none' — it ignores add/subtract/intersect/difference entirely — so
   * any non-'n' mode is treated as an additive clip. An animated mask shape
   * drives a keyframed clip-path: each frame the union is re-sampled, so the
   * clip morphs with the mask (Popcorn animates the path() command list, exactly
   * as it morphs a shape's `d`). Inverted or reduced-opacity masks still block.
   * Mask expansion (x != 0) is ignored with a warning.
   *
   * Returns the static `clip-path` base decl plus, when any mask animates, a
   * channel whose sample re-unions every mask at frame t (static masks stay
   * constant). The base is sampled at the earliest animated keyframe, matching
   * how an animated shape's `d` base is its first keyframe.
   */
  private maskClip(l: any): { base: string; channel: Channel | null } | null {
    const masks = l.masksProperties;
    if (!Array.isArray(masks) || masks.length === 0) return null;
    const samplers: ((t: number) => string)[] = [];
    const animKfs: Kf[] = [];
    for (const m of masks) {
      if (m.mode === 'n') continue; // 'none': contributes nothing, blocks nothing
      if (m.inv) { this.blocked.add('inverted mask (inv)'); return null; }
      const o = prop(m.o);
      if (o && (o.animated || (o.at(0)[0] ?? 100) < 100)) { this.blocked.add('mask opacity < 100'); return null; }
      const pt = m.pt;
      if (!pt) { this.blocked.add('mask missing shape'); return null; }
      const x = prop(m.x);
      if (x && Math.abs(x.at(0)[0] ?? 0) > 1e-6) this.warnOnce(`mask expansion on '${l.nm || l.ind}' ignored`);
      if (isAnimatedShape(pt)) {
        const kfs = pathKfs({ ks: pt });
        animKfs.push(...kfs);
        samplers.push((t) => { const d = shapeToPath(shapeAt(kfs, t)); return d ? `path('${d}')` : ''; });
      } else {
        const d = shapeToPath(pt.k);
        const s = d ? `path('${d}')` : '';
        samplers.push(() => s);
      }
    }
    if (samplers.length === 0) return null;
    const unionAt = (t: number) => samplers.map((f) => f(t)).filter(Boolean).join(' ');

    if (animKfs.length === 0) {
      const base = unionAt(0);
      return base ? { base: `clip-path: ${base}`, channel: null } : null;
    }
    // Union of every animated mask's keyframe times drives the emitted @keyframes
    // (finalizeAnim dedupes); per-segment easing is read from the first mask with
    // a keyframe at that time (a single animated mask per layer is the norm).
    const t0 = Math.min(...animKfs.map((k) => k.t));
    const base = unionAt(t0);
    if (!base) return null;
    return {
      base: `clip-path: ${base}`,
      channel: { priority: 1, kfs: animKfs, sample: (t) => ({ clipPath: unionAt(t) }) },
    };
  }

  /** Attach a mask's static clip base decl and, if animated, its clip channel. */
  private applyMask(rule: Rule, mask: { base: string; channel: Channel | null }) {
    rule.decls.push(mask.base);
    if (mask.channel) rule.channels.push(mask.channel);
  }

  // --- transform (ks / tr) -> decls + channels ----------------------------

  private applyTransform(ks: any, rule: Rule, _st: number, opts: { skipOpacity?: boolean } = {}) {
    if (!ks) return;
    const o = opts.skipOpacity ? null : prop(ks.o);
    const r = prop(ks.r);
    const p = prop(ks.p);
    const a = prop(ks.a);
    const s = prop(ks.s);

    if (a && a.animated) this.warnOnce(`animated anchor on '${rule.id}' baked to its first value`);
    const av = a ? a.at(0) : [0, 0, 0];
    const ax = av[0] || 0, ay = av[1] || 0;

    // Skew is not representable.
    if (this.nonZeroStatic(ks.sk) || (ks.sk && ks.sk.a === 1)) this.warnOnce(`skew on '${rule.id}' skipped`);

    if (ax !== 0 || ay !== 0) rule.decls.push(`transform-origin: ${num(ax)}px ${num(ay)}px`);

    // Position: motion path when the animated position carries spatial tangents.
    let positionHandled = false;
    if (p && p.animated && p.kfs && hasSpatialTangents(p.kfs)) {
      this.applyMotionPath(p.kfs, rule, ax, ay, ks.ao === 1, r);
      positionHandled = true;
    }

    // Split position whose axes carry their own keyframe times/easing: emit
    // translateX and translateY as independent channels so each axis follows its
    // true curve. Lottie stores separate bezier tangents per axis; the combined
    // translate() can only carry one, so one axis's easing would bleed onto the
    // other (visible as an off-time bounce). Only when the axes actually diverge.
    if (!positionHandled && ks.p && ks.p.s === true) {
      const px = prop(ks.p.x), py = prop(ks.p.y);
      if (px && py && px.animated && py.animated && axesDiverge(px, py)) {
        rule.channels.push({ priority: 5, kfs: px.kfs!, sample: (t) => ({ txx: (px.at(t)[0] || 0) - ax }) });
        rule.channels.push({ priority: 5, kfs: py.kfs!, sample: (t) => ({ txy: (py.at(t)[0] || 0) - ay }) });
        positionHandled = true;
      }
    }

    // Static transform pieces.
    const tf: string[] = [];
    if (!positionHandled && p && !p.animated) {
      const pv = p.at(0);
      const tx = (pv[0] || 0) - ax, ty = (pv[1] || 0) - ay;
      if (tx !== 0 || ty !== 0) tf.push(`translate(${num(tx)}px, ${num(ty)}px)`);
    }
    if (r && !r.animated) {
      const rv = r.at(0)[0] || 0;
      if (rv !== 0) tf.push(`rotate(${num(rv)}deg)`);
    }
    if (s && !s.animated) {
      const sv = s.at(0);
      const sx = (sv[0] ?? 100) / 100, sy = (sv[1] ?? 100) / 100;
      if (sx !== 1 || sy !== 1) tf.push(sx === sy ? `scale(${num(sx)})` : `scale(${num(sx)}, ${num(sy)})`);
    }
    if (tf.length) rule.decls.push(`transform: ${tf.join(' ')}`);

    if (o && !o.animated) {
      const ov = (o.at(0)[0] ?? 100) / 100;
      if (ov !== 1) rule.decls.push(`opacity: ${num(ov, 3)}`);
    }

    // Animated channels.
    if (!positionHandled && p && p.animated && p.kfs) {
      rule.channels.push({
        priority: 5,
        kfs: p.kfs,
        sample: (t) => {
          const v = p.at(t);
          return { tx: (v[0] || 0) - ax, ty: (v[1] || 0) - ay };
        },
      });
    }
    if (r && r.animated && r.kfs) {
      rule.channels.push({ priority: 3, kfs: r.kfs, sample: (t) => ({ rot: r.at(t)[0] || 0 }) });
    }
    if (s && s.animated && s.kfs) {
      rule.channels.push({
        priority: 4,
        kfs: s.kfs,
        sample: (t) => {
          const v = s.at(t);
          return { sx: (v[0] ?? 100) / 100, sy: (v[1] ?? 100) / 100 };
        },
      });
    }
    if (o && o.animated && o.kfs) {
      rule.channels.push({ priority: 2, kfs: o.kfs, sample: (t) => ({ opacity: (o.at(t)[0] ?? 100) / 100 }) });
    }
  }

  private nonZeroStatic(p: any): boolean {
    return p && p.a !== 1 && Math.abs(asArr(p.k)[0] || 0) > 1e-6;
  }

  private applyMotionPath(kfs: Kf[], rule: Rule, ax: number, ay: number, autoOrient: boolean, r: Prop | null) {
    const verts = kfs.map((k) => asArr(k.s));
    // Build the offset path: tangents are RELATIVE to each keyframe's point.
    const d: string[] = [`M ${num(verts[0][0])} ${num(verts[0][1])}`];
    const segLen: number[] = [];
    for (let k = 0; k < verts.length - 1; k++) {
      // Lottie stores BOTH tangents on the departing keyframe: `to` is relative
      // to this point, `ti` is relative to the NEXT point (verified against the
      // matching static `sh` reference path in position-path-*.json).
      const to = kfs[k].to || [0, 0];
      const ti = kfs[k].ti || [0, 0];
      const c1x = verts[k][0] + (to[0] || 0), c1y = verts[k][1] + (to[1] || 0);
      const c2x = verts[k + 1][0] + (ti[0] || 0), c2y = verts[k + 1][1] + (ti[1] || 0);
      d.push(`C ${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(verts[k + 1][0])} ${num(verts[k + 1][1])}`);
      const sub = `M ${verts[k][0]} ${verts[k][1]} C ${c1x} ${c1y} ${c2x} ${c2y} ${verts[k + 1][0]} ${verts[k + 1][1]}`;
      segLen.push(computePathLength(parsePath(sub)));
    }
    const dStr = d.join(' ');

    // Cumulative arc-length fraction at each vertex.
    const total = segLen.reduce((a, b) => a + b, 0) || 1;
    const frac: number[] = [0];
    let run = 0;
    for (const len of segLen) { run += len; frac.push(run / total); }

    rule.decls.push(`offset-path: path('${dStr}')`);
    // Lottie only auto-orients along the path when ao:1; otherwise fix orientation.
    rule.decls.push(`offset-rotate: ${autoOrient ? 'auto' : '0deg'}`);
    // offset-path coords are absolute comp coords; keep only anchor compensation.
    if (ax !== 0 || ay !== 0) rule.decls.push(`transform: translate(${num(-ax)}px, ${num(-ay)}px)`);

    // Arc-length fraction at an arbitrary time. At a vertex this returns that
    // vertex's exact `frac`; between vertices (e.g. a synthetic clamp boundary
    // inserted mid-segment) it interpolates in time so a track truncated part
    // way along its path holds a point *on* the path, not the previous vertex.
    const fracAt = (t: number) => {
      if (t <= kfs[0].t) return frac[0];
      if (t >= kfs[kfs.length - 1].t) return frac[frac.length - 1];
      let i = 0;
      for (let k = 0; k < kfs.length - 1; k++) if (kfs[k].t <= t) i = k;
      const span = kfs[i + 1].t - kfs[i].t || 1;
      const u = (t - kfs[i].t) / span;
      return frac[i] + u * (frac[i + 1] - frac[i]);
    };
    rule.channels.push({
      priority: 6,
      kfs,
      sample: (t) => ({ offsetDistance: fracAt(t) }),
    });
    // rotation still applies statically or via its own channel (handled by caller path).
    void r;
  }

  // --- shape items --------------------------------------------------------

  private processItems(
    items: any[],
    prefix: string,
    inherited: InheritedStyle
  ): Rule[] {
    // Hidden items (hd:true) contribute neither geometry nor paint style.
    items = items.filter((it) => !(it && it.hd === true));

    // Resolve this level's paint style (nearest fill/stroke wins). Stroke color
    // AND its width/cap/dash all inherit together — a stroke defined on an outer
    // group (a Lottie `st` sibling of nested shape groups, e.g. one 16px outline
    // over every tail segment) styles the descendants' paths; inheriting only
    // the color left them at the default 1px, so segment outlines read as thin
    // light seams instead of the intended thick divider.
    let fill: string | null = inherited.fill;
    let fillCh: ((t: number) => Sample) | null = null;
    let fillKfs: Kf[] | null = null;
    let stroke: string | null = inherited.stroke;
    let strokeCh: ((t: number) => Sample) | null = inherited.strokeCh;
    let strokeKfs: Kf[] | null = inherited.strokeKfs;
    let strokeWidth: number | null = inherited.strokeWidth;
    let lineCap: string | null = inherited.lineCap;
    let lineJoin: string | null = inherited.lineJoin;
    let miterLimit: number | null = inherited.miterLimit;
    let dashArray: number[] | null = inherited.dashArray;
    let dashOffset = inherited.dashOffset;
    let gradientFill: string | null = null;
    // Multiple `fl` in a group = stacked layers of the SAME geometry, painted
    // first-on-top (Lottie order). Collected here; the first (top) fill becomes
    // this level's primary paint, the rest are emitted as under-layer copies.
    const fills: { color: string | null; ch: ((t: number) => Sample) | null; kfs: Kf[] | null; rule: number | null }[] = [];
    let fillRule: number | null = null;
    let trim: TrimInfo | null = null;

    // A stroke inherited from an ancestor group (rather than defined by an `st`
    // at this level) sits BELOW this level's fills in Lottie's paint order — it's
    // an outer outline the nearer fills paint over, so only its exposed edge (the
    // seam between adjacent filled shapes) shows. Emit `paint-order: stroke` for
    // those so the player draws the stroke behind the fill instead of on top (a
    // 16px outline over every small segment otherwise reads as a thick ribbon).
    const hasLocalStroke = items.some((it) => it.ty === 'st' || it.ty === 'gs');

    for (const it of items) {
      switch (it.ty) {
        case 'fl': {
          const c = prop(it.c);
          const o = prop(it.o);
          const op = o && !o.animated ? (o.at(0)[0] ?? 100) / 100 : 1;
          let color: string | null = null, ch: ((t: number) => Sample) | null = null, kfs: Kf[] | null = null;
          // Color and/or opacity animate: sample the color on the union of both
          // keyframe grids, folding opacity into alpha. (Animated opacity alone
          // was previously baked to fully-opaque — the pulse silently vanished.)
          if ((c && c.animated && c.kfs) || (o && o.animated && o.kfs)) {
            const built = colorOpacityChannel(c, o, 'fill');
            color = built.base; ch = built.ch; kfs = built.kfs;
          } else if (c) {
            color = lottieColor(c.at(0), op);
          }
          fills.push({ color, ch, kfs, rule: it.r === 1 || it.r === 2 ? it.r : null });
          break;
        }
        case 'st': {
          const c = prop(it.c);
          const w = prop(it.w);
          const o = prop(it.o);
          const op = o && !o.animated ? (o.at(0)[0] ?? 100) / 100 : 1;
          // Stroke opacity (`o`) lives on its own track like a fill's: static <100
          // folds into the color's alpha; animated color and/or opacity drives a
          // stroke channel (registry animates `stroke` as a color kind).
          if ((c && c.animated && c.kfs) || (o && o.animated && o.kfs)) {
            const built = colorOpacityChannel(c, o, 'stroke');
            stroke = built.base; strokeCh = built.ch; strokeKfs = built.kfs;
          } else if (c) {
            stroke = lottieColor(c.at(0), op);
          }
          if (w) strokeWidth = w.at(0)[0] ?? 0;
          lineCap = it.lc === 2 ? 'round' : it.lc === 3 ? 'square' : 'butt';
          lineJoin = it.lj === 2 ? 'round' : it.lj === 3 ? 'bevel' : 'miter';
          miterLimit = typeof it.ml === 'number' ? it.ml : null;
          // Dash pattern: `d` is a list of { n: 'd'|'g'|'o', v } — dash/gap build
          // the array (in order), offset is separate. Animated dashes bake to t0.
          if (Array.isArray(it.d)) {
            const dashes: number[] = [];
            for (const el of it.d) {
              const v = prop(el.v);
              const val = v ? v.at(0)[0] ?? 0 : 0;
              if (el.n === 'o') dashOffset = val;
              else dashes.push(val); // 'd' (dash) and 'g' (gap)
              if (v && v.animated) this.warnOnce('animated stroke dash baked to first value');
            }
            if (dashes.length) dashArray = dashes;
          }
          break;
        }
        case 'gs': {
          // Gradient stroke: a stroked outline painted with a gradient, NOT a
          // fill. The player supports `stroke: <gradient>` (strokeGradient); the
          // outline width/cap/join come off the `gs` exactly like a plain `st`.
          // Animated width/stops bake to their first value (matching `st`).
          // Static stroke opacity (`o`<100) folds into every stop's alpha; an
          // animated `o` bakes to its first value (a per-stop opacity channel
          // would need a gradient-string channel — worth a follow-up, not this).
          const gso = prop(it.o);
          const gsop = gso ? (gso.at(0)[0] ?? 100) / 100 : 1;
          stroke = this.buildGradient(it, gsop);
          const w = prop(it.w);
          if (w) strokeWidth = w.at(0)[0] ?? 0;
          lineCap = it.lc === 2 ? 'round' : it.lc === 3 ? 'square' : 'butt';
          lineJoin = it.lj === 2 ? 'round' : it.lj === 3 ? 'bevel' : 'miter';
          miterLimit = typeof it.ml === 'number' ? it.ml : null;
          if (it.g && it.g.k && it.g.k.a === 1) this.warnOnce('animated gradient stroke stops baked to first value');
          if (gso && gso.animated) this.warnOnce('animated gradient stroke opacity baked to first value');
          break;
        }
        case 'gf': {
          gradientFill = this.buildGradient(it);
          // Animated stops OR geometry (s/e center-endpoint, h/a highlight) -> a
          // fill channel of gradient() strings per keyframe (Popcorn interpolates
          // them; see registry 'gradient'). Drive it off the union of every
          // animated input's keyframe grid so the sampled gradient matches each
          // contributing track at its own keyframes.
          const gradTracks = [
            it.g && it.g.k && it.g.k.a === 1 ? (it.g.k.k as Kf[]) : null,
            prop(it.s)?.animated ? prop(it.s)!.kfs : null,
            prop(it.e)?.animated ? prop(it.e)!.kfs : null,
            prop(it.h)?.animated ? prop(it.h)!.kfs : null,
            prop(it.a)?.animated ? prop(it.a)!.kfs : null,
          ].filter((k): k is Kf[] => !!k && k.length > 0);
          if (gradTracks.length) {
            const times = [...new Set(gradTracks.flatMap((k) => k.map((kf) => kf.t)))].sort((a, b) => a - b);
            fillKfs = times.map((t) => {
              const src = gradTracks.map((tk) => tk.find((kf) => kf.t === t)).find(Boolean);
              return { t, i: src?.i, o: src?.o, h: src?.h };
            });
            fillCh = (t) => ({ fill: this.gradientCssAt(it, t) ?? gradientFill! });
          }
          break;
        }
        case 'tm': {
          let s = prop(it.s), e = prop(it.e);
          const o = prop(it.o);
          // Lottie's `s`/`e` are unordered — lottie-web swaps them so start<=end
          // before drawing (a window from 61% to 23% is the segment 23..61). The
          // player treats trim-start>=trim-end as an empty (invisible) stroke, so
          // when this trim runs "backwards" (start above end) swap the roles: each
          // prop keeps its own keyframes/easing, they just change which is start.
          const sVal0 = s ? s.at(0)[0] ?? 0 : 0;
          const eVal0 = e ? e.at(0)[0] ?? 100 : 100;
          if (sVal0 > eVal0) { const tmp = s; s = e; e = tmp; }
          trim = {
            start: s ? s.at(0)[0] ?? 0 : 0,
            end: e ? e.at(0)[0] ?? 100 : 100,
            offset: o ? (o.at(0)[0] ?? 0) / 360 : 0,
            startCh: s && s.animated && s.kfs
              ? { kfs: s.kfs, sample: (t: number) => ({ trimStart: s!.at(t)[0] ?? 0 }) }
              : null,
            endCh: e && e.animated && e.kfs
              ? { kfs: e.kfs, sample: (t: number) => ({ trimEnd: e!.at(t)[0] ?? 100 }) }
              : null,
            offsetCh: o && o.animated && o.kfs
              ? { kfs: o.kfs, sample: (t: number) => ({ trimOffset: (o.at(t)[0] ?? 0) / 360 }) }
              : null,
          };
          break;
        }
        case 'mm':
          break; // merge-paths: resolved in the drawable pass below.
        default:
          if (it.ty in BLOCKED_MODIFIERS) this.blocked.add(BLOCKED_MODIFIERS[it.ty]);
      }
    }
    // The top (first) fill is this level's primary paint — inherited by nested
    // groups and used by merged/single drawables; the rest paint below it.
    if (fills.length) {
      fill = fills[0].color;
      fillCh = fills[0].ch;
      fillKfs = fills[0].kfs;
      if (fills[0].rule) fillRule = fills[0].rule;
    }

    // A stroke that reaches into nested `gr` children styles their descendant
    // fills in Lottie as ONE stroke of the combined paths, painted BELOW every
    // fill — the fills cover its interior so only the outer edge (the silhouette
    // seam) shows. Reproducing it per-segment (each fill carrying its own stroke
    // on top) draws a heavy seam at every interior boundary. When the covered
    // paths share this level's space (all intervening group transforms identity),
    // hoist the stroke into one stroke-only node behind the fills, and leave the
    // fills unstroked. (Otherwise fall through to per-node paint-order: stroke.)
    let hoistStroke: Rule | null = null;
    if (hasLocalStroke && stroke && strokeWidth != null && items.some((it) => it.ty === 'gr')) {
      const covered = collectStrokeableDraws(items);
      if (covered && covered.length > 1) {
        const node = this.buildMergedPath(covered, this.uniqueId(prefix + '-stroke'), fillRule);
        if (node) {
          node.decls.push('fill: none', `stroke: ${stroke}`, `stroke-width: ${num(strokeWidth)}px`);
          if (lineCap && lineCap !== 'butt') node.decls.push(`stroke-linecap: ${lineCap}`);
          if (lineJoin && lineJoin !== 'miter') node.decls.push(`stroke-linejoin: ${lineJoin}`);
          if (miterLimit != null && miterLimit !== 4) node.decls.push(`stroke-miterlimit: ${num(miterLimit)}`);
          if (dashArray) node.decls.push(`stroke-dasharray: ${dashArray.map((d) => `${num(d)}px`).join(' ')}`);
          if (dashOffset) node.decls.push(`stroke-dashoffset: ${num(dashOffset)}px`);
          if (strokeCh && strokeKfs) node.channels.push({ priority: 1, kfs: strokeKfs, sample: strokeCh });
          this.finalizeAnim(node);
          hoistStroke = node;
          // The fills below now paint unstroked; the hoisted node is the stroke.
          stroke = null; strokeCh = null; strokeKfs = null; strokeWidth = null; lineCap = null; lineJoin = null; miterLimit = null; dashArray = null; dashOffset = 0;
        }
      }
    }

    const effectiveFill = gradientFill ?? fill;
    // A trim applies to preceding sibling shapes in Lottie, which may be a
    // sibling `gr` group rather than a drawable in this same items array —
    // inherit it down so descendants of that group still pick it up.
    const effectiveTrim = trim ?? inherited.trim;
    const style: InheritedStyle = {
      fill: effectiveFill, stroke, strokeCh, strokeKfs, trim: effectiveTrim,
      strokeWidth, lineCap, lineJoin, miterLimit, dashArray, dashOffset,
    };

    // `layer` overrides the fill for one stacked under-layer of a multi-fill
    // group; omitted, the level's primary (gradient or top) fill is used.
    const applyStyle = (rule: Rule, layer?: (typeof fills)[number]) => {
      const layerFill = layer ? layer.color : effectiveFill;
      if (layerFill) rule.decls.push(`fill: ${layerFill}`);
      else rule.decls.push(`fill: none`);
      if (stroke) rule.decls.push(`stroke: ${stroke}`);
      if (stroke && !hasLocalStroke) rule.decls.push(`paint-order: stroke`);
      if (strokeWidth != null) rule.decls.push(`stroke-width: ${num(strokeWidth)}px`);
      if (lineCap && lineCap !== 'butt') rule.decls.push(`stroke-linecap: ${lineCap}`);
      if (lineJoin && lineJoin !== 'miter') rule.decls.push(`stroke-linejoin: ${lineJoin}`);
      if (miterLimit != null && miterLimit !== 4) rule.decls.push(`stroke-miterlimit: ${num(miterLimit)}`);
      if (dashArray) rule.decls.push(`stroke-dasharray: ${dashArray.map((d) => `${num(d)}px`).join(' ')}`);
      if (dashOffset) rule.decls.push(`stroke-dashoffset: ${num(dashOffset)}px`);
      if ((layer ? layer.rule : fillRule) === 2) rule.decls.push(`fill-rule: evenodd`);
      if (effectiveTrim) {
        if (!effectiveTrim.startCh) rule.decls.push(`trim-start: ${num(effectiveTrim.start)}%`);
        if (!effectiveTrim.endCh) rule.decls.push(`trim-end: ${num(effectiveTrim.end)}%`);
        if (effectiveTrim.offset && !effectiveTrim.offsetCh) rule.decls.push(`trim-offset: ${num(effectiveTrim.offset * 100, 3)}%`);
        if (effectiveTrim.startCh) rule.channels.push({ priority: 1, kfs: effectiveTrim.startCh.kfs, sample: effectiveTrim.startCh.sample });
        if (effectiveTrim.endCh) rule.channels.push({ priority: 1, kfs: effectiveTrim.endCh.kfs, sample: effectiveTrim.endCh.sample });
        if (effectiveTrim.offsetCh) rule.channels.push({ priority: 1, kfs: effectiveTrim.offsetCh.kfs, sample: effectiveTrim.offsetCh.sample });
      }
      const lch = layer ? layer.ch : fillCh, lkfs = layer ? layer.kfs : fillKfs;
      if (lch && lkfs) rule.channels.push({ priority: 1, kfs: lkfs, sample: lch });
      if (strokeCh && strokeKfs) rule.channels.push({ priority: 1, kfs: strokeKfs, sample: strokeCh });
    };

    const out: Rule[] = [];
    let dcount = 0;

    // Merge-paths (mm) unions the drawables preceding it into one path. Canvas2D
    // nonzero fill of multiple subpaths in a single path IS visual union, so no
    // player feature is needed — just concatenate subpaths. A single-input merge
    // is a visual no-op for ANY mode (it passes straight through the loop below);
    // multi-input merges only union (modes 1/2). Modes 3/4/5 stay blocked.
    // Known limitation: a STROKE on a merged path shows interior seams (fills are
    // unioned, strokes are not — Canvas draws every subpath's outline).
    let mergeSet: Set<any> | null = null;
    const mmIdx = items.findIndex((it) => it.ty === 'mm');
    if (mmIdx >= 0) {
      const mode = items[mmIdx].mm;
      const drawables = items
        .slice(0, mmIdx)
        .filter((it) => it.ty === 'rc' || it.ty === 'el' || it.ty === 'sh' || it.ty === 'sr');
      if (drawables.length > 1) {
        if (mode === 1 || mode === 2) {
          mergeSet = new Set(drawables);
          const merged = this.buildMergedPath(drawables, this.uniqueId(prefix + '-merge'), fillRule);
          if (merged) {
            if (stroke) this.warnOnce('stroke on a merged path shows interior seams (fills are unioned, strokes are not)');
            applyStyle(merged);
            this.finalizeAnim(merged);
            out.push(merged);
          }
        } else {
          this.blocked.add(`merge mode ${mode} (mm)`); // subtract/intersect/exclude
        }
      }
    }

    // Sibling drawables in a group all share this level's single fill and are
    // painted by Lottie as ONE nonzero region — so an inner, opposite-wound
    // contour cuts a hole (e.g. an outline drawn as outer + inner path). Emitting
    // them as separate solid fills loses that hole (the outline fills in solid),
    // so >1 drawable is merged into one path just like an explicit `mm` union.
    const siblingDraws: any[] = [];
    let drawIdx = -1;
    for (const it of items) {
      if (mergeSet && mergeSet.has(it)) continue;
      if (it.ty === 'gr') {
        const gid = this.uniqueId(prefix + '-' + (it.nm ? it.nm : `g${dcount++}`));
        const grp: Rule = { id: gid, type: 'group', decls: [], channels: [], children: [] };
        const tr = (it.it || []).find((x: any) => x.ty === 'tr');
        if (tr) this.applyTransform(trToKs(tr), grp, 0);
        grp.children.push(...this.processItems(it.it || [], gid, style));
        this.finalizeAnim(grp);
        out.push(grp);
      } else if (it.ty === 'rc' || it.ty === 'el' || it.ty === 'sh' || it.ty === 'sr') {
        if (drawIdx < 0) drawIdx = out.length;
        siblingDraws.push(it);
      }
    }
    // >1 `fl` stacks copies of the same geometry, one per fill, in Lottie order
    // (first ends up on top after the reverse below); a single/absent fill emits
    // one node with the level's primary paint.
    const paintLayers: ((typeof fills)[number] | undefined)[] = fills.length > 1 ? fills : [undefined];
    const emit = (make: () => Rule | null) => {
      paintLayers.forEach((layer, i) => {
        const node = make();
        if (!node) return;
        applyStyle(node, layer);
        this.finalizeAnim(node);
        out.splice(drawIdx + i, 0, node);
      });
    };
    if (siblingDraws.length === 1) {
      const it = siblingDraws[0];
      const base = prefix + '-' + (it.nm ? it.nm : `s${dcount++}`);
      emit(() => this.buildDrawable(it, base));
    } else if (siblingDraws.length > 1) {
      emit(() => this.buildMergedPath(siblingDraws, this.uniqueId(prefix + '-shapes'), fillRule));
    }
    // A hoisted group stroke paints beneath every fill: last in Lottie (top-first)
    // order so it lands first (behind) after the reverse below.
    if (hoistStroke) out.push(hoistStroke);
    // Lottie paints shape items top-first; Popcorn paints first-behind -> reverse.
    return out.reverse();
  }

  private buildDrawable(it: any, rawId: string): Rule | null {
    const id = this.uniqueId(rawId);
    if (it.ty === 'rc') {
      const rule: Rule = { id, type: 'rect', decls: [], channels: [], children: [] };
      const p = prop(it.p), s = prop(it.s), rnd = prop(it.r);
      const pv = p!.at(0), sv = s!.at(0);
      rule.decls.push(
        `x: ${num(pv[0] - sv[0] / 2)}px`,
        `y: ${num(pv[1] - sv[1] / 2)}px`,
        `width: ${num(sv[0])}px`,
        `height: ${num(sv[1])}px`
      );
      const r = rnd ? rnd.at(0)[0] || 0 : 0;
      if (r) rule.decls.push(`rx: ${num(r)}px`, `ry: ${num(r)}px`);
      if ((p && p.animated) || (s && s.animated)) {
        const pk = p && p.animated ? p.kfs! : [];
        const sk = s && s.animated ? s.kfs! : [];
        rule.channels.push({
          priority: 5,
          kfs: pk.length ? pk : sk,
          sample: (t) => {
            const pp = p!.at(t), ss = s!.at(t);
            const out: Sample = { x: pp[0] - ss[0] / 2, y: pp[1] - ss[1] / 2 };
            if (s && s.animated) { out.width = ss[0]; out.height = ss[1]; }
            return out;
          },
        });
      }
      return rule;
    }
    if (it.ty === 'el') {
      const rule: Rule = { id, type: 'ellipse', decls: [], channels: [], children: [] };
      const p = prop(it.p), s = prop(it.s);
      const pv = p!.at(0), sv = s!.at(0);
      rule.decls.push(`cx: ${num(pv[0])}px`, `cy: ${num(pv[1])}px`, `rx: ${num(sv[0] / 2)}px`, `ry: ${num(sv[1] / 2)}px`);
      if (p && p.animated && p.kfs) {
        if (hasSpatialTangents(p.kfs)) this.warnOnce('spatial tangents on a shape position ignored');
        rule.channels.push({ priority: 5, kfs: p.kfs, sample: (t) => { const v = p.at(t); return { cx: v[0], cy: v[1] }; } });
      }
      if (s && s.animated && s.kfs) {
        rule.channels.push({ priority: 4, kfs: s.kfs, sample: (t) => { const v = s.at(t); return { rx: v[0] / 2, ry: v[1] / 2 }; } });
      }
      return rule;
    }
    if (it.ty === 'sr') {
      // Polystar: sy 1 = star, 2 = polygon. pt=sides, or/ir=radii, r=rotation
      // (deg), os/is=roundness (%), p=center. sides is static; radii/rotation/
      // center animate. Geometry is synthesized into a path downstream.
      const star = it.sy !== 2;
      const rule: Rule = { id, type: star ? 'star' : 'polygon', decls: [], channels: [], children: [] };
      const p = prop(it.p), pt = prop(it.pt), or = prop(it.or), ir = prop(it.ir),
        rot = prop(it.r), os = prop(it.os), is = prop(it.is);
      const pv = p ? p.at(0) : [0, 0];
      rule.decls.push(`sides: ${num(pt ? pt.at(0)[0] : 5, 0)}`);
      rule.decls.push(`outer-radius: ${num(or ? or.at(0)[0] : 0)}px`);
      if (star) rule.decls.push(`inner-radius: ${num(ir ? ir.at(0)[0] : 0)}px`);
      rule.decls.push(`cx: ${num(pv[0])}px`, `cy: ${num(pv[1])}px`);
      const rv = rot ? rot.at(0)[0] : 0;
      if (rv) rule.decls.push(`rotation: ${num(rv)}deg`);
      const osv = os ? os.at(0)[0] : 0, isv = is ? is.at(0)[0] : 0;
      if (osv) rule.decls.push(`outer-roundness: ${num(osv)}%`);
      if (star && isv) rule.decls.push(`inner-roundness: ${num(isv)}%`);
      if (or && or.animated && or.kfs)
        rule.channels.push({ priority: 5, kfs: or.kfs, sample: (t) => ({ outerRadius: or.at(t)[0] }) });
      if (star && ir && ir.animated && ir.kfs)
        rule.channels.push({ priority: 4, kfs: ir.kfs, sample: (t) => ({ innerRadius: ir.at(t)[0] }) });
      if (rot && rot.animated && rot.kfs)
        rule.channels.push({ priority: 3, kfs: rot.kfs, sample: (t) => ({ starRotation: rot.at(t)[0] }) });
      if (p && p.animated && p.kfs)
        rule.channels.push({ priority: 6, kfs: p.kfs, sample: (t) => { const v = p.at(t); return { cx: v[0], cy: v[1] }; } });
      return rule;
    }
    // sh: bezier path (static or morphing). Animated shapes (a:1) become a `d`
    // channel — one path string per keyframe; Popcorn morphs between compatible
    // command sequences (Lottie guarantees matching vertex counts per track).
    const rule: Rule = { id, type: 'path', decls: [], channels: [], children: [] };
    if (isAnimatedShape(it.ks)) {
      const kfs = pathKfs(it);
      rule.decls.push(`d: '${shapeToPath(shapeKf(kfs[0]))}'`);
      rule.channels.push({ priority: 6, kfs, sample: (t) => ({ d: shapeToPath(shapeAt(kfs, t)) }) });
      return rule;
    }
    const shp = it.ks ? it.ks.k : null;
    if (!shp) return null;
    rule.decls.push(`d: '${shapeToPath(shp)}'`);
    return rule;
  }

  /**
   * Union `drawables` into one path node (each drawable is one subpath in a
   * single `d`, filled nonzero). Static geometry bakes to a `d` declaration;
   * animated geometry samples every drawable on a shared keyframe grid so the
   * player morphs the combined path (the shape set is fixed and each drawable's
   * command sequence is count-stable, so vertices line up across frames).
   */
  private buildMergedPath(drawables: any[], id: string, fillRule: number | null): Rule | null {
    const rule: Rule = { id, type: 'path', decls: [], channels: [], children: [] };
    const dAt = (t: number) => drawables.map((it) => drawableToDAt(it, t)).filter(Boolean).join(' ');
    const animated = drawables.filter(drawableAnimated);
    if (animated.length === 0) {
      const d = dAt(0);
      if (!d) return null;
      rule.decls.push(`d: '${d}'`);
    } else {
      // Sample the combined `d` on the UNION of every animated input's keyframe
      // grid, so the merged geometry matches each contributing shape at every one
      // of its keyframes and the interpolation between them stays in tolerance.
      // (Driving the morph off only the longest track let the other inputs drift
      // between its keyframes — a union stroke would then poke past the fills it
      // wraps, the cat-tail spikes.) Easing at each union time follows whichever
      // track owns a native keyframe there; this mirrors splitProp's x/y merge.
      const tracks = animated.map(drawableKfs).filter((k) => k.length > 0);
      const times = [...new Set(tracks.flatMap((k) => k.map((kf) => kf.t)))].sort((a, b) => a - b);
      const kfs: Kf[] = times.map((t) => {
        const src = tracks.map((tk) => tk.find((kf) => kf.t === t)).find(Boolean);
        return { t, i: src?.i, o: src?.o, h: src?.h };
      });
      rule.decls.push(`d: '${dAt(times[0])}'`);
      rule.channels.push({ priority: 6, kfs, sample: (t) => ({ d: dAt(t) }) });
    }
    // Nonzero winding is what makes the concatenated subpaths read as a union.
    if (fillRule !== 2) rule.decls.push('fill-rule: nonzero');
    return rule;
  }

  private buildGradient(it: any, opacity = 1): string | null {
    const g = it.g;
    if (!g || !g.k) return null;
    // Animated stops: emit a fill channel of full gradient() strings per keyframe
    // (Popcorn interpolates them; see registry 'gradient'). Static: bake at t0.
    return this.gradientCssAt(it, g.k.a === 1 ? g.k.k[0].t : 0, opacity);
  }

  /**
   * Gradient color stops as CSS, merging Lottie's separate opacity (alpha) stops
   * into the color stops. Lottie stores `p` color stops [pos,r,g,b] followed by
   * an optional alpha tail [pos,a]. CSS has no alpha channel, so we sample color
   * and alpha on the union of both position sets and emit rgba() stops (dropping
   * the tail lost the fade-to-transparent that soft glows depend on).
   */
  private gradientStops(flat: number[], count: number, opacity = 1): string[] {
    const colors: { pos: number; rgb: number[] }[] = [];
    for (let i = 0; i < count; i++) {
      colors.push({ pos: flat[i * 4], rgb: [flat[i * 4 + 1], flat[i * 4 + 2], flat[i * 4 + 3]] });
    }
    const alphas: { pos: number; a: number }[] = [];
    for (let i = count * 4; i + 1 < flat.length; i += 2) alphas.push({ pos: flat[i], a: flat[i + 1] });
    if (alphas.length === 0) return colors.map((c) => `${lottieColor(c.rgb, opacity)} ${num(c.pos * 100)}%`);
    const positions = [...new Set([...colors.map((c) => c.pos), ...alphas.map((a) => a.pos)])].sort((x, y) => x - y);
    return positions.map((p) => {
      const rgb = [0, 1, 2].map((k) => sampleStopScalar(colors, p, (c) => c.rgb[k]));
      const a = sampleStopScalar(alphas, p, (s) => s.a);
      return `${lottieColor([...rgb, a], opacity)} ${num(p * 100)}%`;
    });
  }

  /** Build the CSS gradient string for `it` at frame `t` (samples animated stops/geometry). */
  private gradientCssAt(it: any, t: number, opacity = 1): string | null {
    const g = it.g;
    if (!g || !g.k) return null;
    const flat: number[] = g.k.a === 1 ? sampleAt(g.k.k, t) : g.k.k;
    const count = g.p || Math.floor(flat.length / 4);
    const stops = this.gradientStops(flat, count, opacity);
    // Exact geometry in the shape's local space (same coords as the path `d`), so
    // the player draws point-to-point / circle-at rather than approximating off
    // the bbox. s = center/start, e = radius endpoint / linear end.
    const s = prop(it.s)?.at(t) ?? [0, 0];
    const e = prop(it.e)?.at(t) ?? [1, 0];
    if (it.t === 2) {
      const r = Math.hypot(e[0] - s[0], e[1] - s[1]);
      let geom = `circle ${num(r)}px at ${num(s[0])}px ${num(s[1])}px`;
      // Highlight: h (% of radius) along angle a offsets the focal (inner) circle
      // — the createRadialGradient(fx,fy,0, cx,cy,r) start point (lottie-web).
      const h = prop(it.h)?.at(t)[0] ?? 0;
      const ha = prop(it.a)?.at(t)[0] ?? 0;
      if (r > 1e-6 && Math.abs(h) > 1e-6) {
        const base = Math.atan2(e[1] - s[1], e[0] - s[0]);
        const pct = Math.max(-0.99, Math.min(0.99, h / 100));
        const ang = base + (ha * Math.PI) / 180;
        const fx = s[0] + Math.cos(ang) * r * pct;
        const fy = s[1] + Math.sin(ang) * r * pct;
        geom += ` from ${num(fx)}px ${num(fy)}px`;
      }
      return `radial-gradient(${geom}, ${stops.join(', ')})`;
    }
    return `linear-gradient(from ${num(s[0])}px ${num(s[1])}px to ${num(e[0])}px ${num(e[1])}px, ${stops.join(', ')})`;
  }

  // --- animation assembly -------------------------------------------------

  private finalizeAnim(rule: Rule) {
    if (rule.channels.length === 0) return;

    // A layer's transform keyframe times are stored in comp-global frames, and
    // lottie-web samples them at the comp frame directly — it does NOT subtract
    // the layer's own `st` (verified against lottie-web: a keyframe at stored
    // time t renders at comp frame t). A precomp instance's `st` shifts its whole
    // subtree and is emitted as `time-offset` on the group, never folded in here.
    // Clamp each channel to the comp's [ip, op] window; AE often leaves keyframes
    // past the work area (op) that never play. When a track runs past a bound,
    // keep the bound itself (sampled) so the node holds its pose there — a track
    // entirely past op collapses to its first keyframe.
    const lo = this.clampIp, hi = this.clampOp;
    const anims: AnimSpec[] = [];

    // Each animated channel becomes its OWN @keyframes on its OWN keyframe times
    // and per-segment easing — never resampled onto a sibling channel's grid — so
    // translate/rotate/scale/opacity follow their true curves. They compose in the
    // player because each writes a distinct property (invariant 2 animation step).
    for (const ch of rule.channels) {
      let times = [...new Set(ch.kfs.map((k) => k.t))].sort((a, b) => a - b);

      if (Number.isFinite(lo) && Number.isFinite(hi) && (times[0] < lo || times[times.length - 1] > hi)) {
        const inRange = times.filter((t) => t >= lo && t <= hi);
        if (times.some((t) => t > hi) && (inRange.length === 0 || inRange[inRange.length - 1] < hi)) inRange.push(hi);
        if (times.some((t) => t < lo) && (inRange.length === 0 || inRange[0] > lo)) inRange.unshift(lo);
        times = inRange;
      }

      // A single (or fully clamped-away) time = degenerate; bake it static. Its
      // decl(s) merge with any sibling channel's transform in the player.
      if (times.length < 2) {
        rule.decls.push(...declsFromSample(ch.sample(times[0] ?? lo)));
        continue;
      }

      const t0 = times[0], tN = times[times.length - 1], span = tN - t0;
      const blocks: AnimSpec['blocks'] = [];
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        const block: AnimSpec['blocks'][number] = {
          offset: (span > 0 ? (t - t0) / span : 0) * 100,
          decls: declsFromSample(ch.sample(t)),
        };
        if (i < times.length - 1) {
          const easing = this.segmentEasing(ch, t);
          if (easing) block.easing = easing;
        }
        blocks.push(block);
      }
      anims.push({
        name: this.uniqueId(rule.id + '-k'),
        blocks,
        durationSec: span / this.fr,
        delaySec: (t0 - this.ip) / this.fr,
        defaultEasing: modalEasing(blocks),
      });
    }

    rule.channels = [];
    if (anims.length) rule.anims = anims;
  }

  /** Per-segment easing from a channel's departing keyframe at time t. */
  private segmentEasing(ch: Channel, t: number): string | null {
    const kfs = ch.kfs;
    const idx = kfs.findIndex((k) => k.t === t);
    if (idx < 0 || idx >= kfs.length - 1) return null;
    const kf = kfs[idx];
    if (kf.h === 1) return 'step-end';
    if (!kf.o || !kf.i) return null;
    const ox = first(kf.o.x), oy = first(kf.o.y), ix = first(kf.i.x), iy = first(kf.i.y);
    if ([ox, oy, ix, iy].some((v) => v === undefined || isNaN(v))) return null;
    if (Array.isArray(kf.o.x) && kf.o.x.some((v: number) => v !== kf.o.x[0]))
      this.warnOnce('per-axis easing differs between axes; using first axis');
    return `cubic-bezier(${num(ox, 3)}, ${num(oy, 3)}, ${num(ix, 3)}, ${num(iy, 3)})`;
  }
}

// ---------------------------------------------------------------------------
// Sample -> declarations
// ---------------------------------------------------------------------------

function declsFromSample(s: Sample): string[] {
  const out: string[] = [];
  const tf: string[] = [];
  if (s.tx !== undefined || s.ty !== undefined) tf.push(`translate(${num(s.tx ?? 0)}px, ${num(s.ty ?? 0)}px)`);
  // Split position: each axis is its own channel (own times + easing), so emit
  // the single-axis longhand rather than folding both onto one translate().
  if (s.txx !== undefined) tf.push(`translateX(${num(s.txx)}px)`);
  if (s.txy !== undefined) tf.push(`translateY(${num(s.txy)}px)`);
  if (s.rot !== undefined) tf.push(`rotate(${num(s.rot)}deg)`);
  if (s.sx !== undefined || s.sy !== undefined) tf.push(`scale(${num(s.sx ?? 1)}, ${num(s.sy ?? 1)})`);
  if (tf.length) out.push(`transform: ${tf.join(' ')}`);
  if (s.opacity !== undefined) out.push(`opacity: ${num(s.opacity, 3)}`);
  if (s.cx !== undefined) out.push(`cx: ${num(s.cx)}px`);
  if (s.cy !== undefined) out.push(`cy: ${num(s.cy)}px`);
  if (s.rx !== undefined) out.push(`rx: ${num(s.rx)}px`);
  if (s.ry !== undefined) out.push(`ry: ${num(s.ry)}px`);
  if (s.x !== undefined) out.push(`x: ${num(s.x)}px`);
  if (s.y !== undefined) out.push(`y: ${num(s.y)}px`);
  if (s.width !== undefined) out.push(`width: ${num(s.width)}px`);
  if (s.height !== undefined) out.push(`height: ${num(s.height)}px`);
  if (s.fill !== undefined) out.push(`fill: ${s.fill}`);
  if (s.stroke !== undefined) out.push(`stroke: ${s.stroke}`);
  if (s.strokeWidth !== undefined) out.push(`stroke-width: ${num(s.strokeWidth)}px`);
  if (s.offsetDistance !== undefined) out.push(`offset-distance: ${num(s.offsetDistance * 100)}%`);
  if (s.trimStart !== undefined) out.push(`trim-start: ${num(s.trimStart)}%`);
  if (s.trimEnd !== undefined) out.push(`trim-end: ${num(s.trimEnd)}%`);
  if (s.trimOffset !== undefined) out.push(`trim-offset: ${num(s.trimOffset * 100, 3)}%`);
  if (s.outerRadius !== undefined) out.push(`outer-radius: ${num(s.outerRadius)}px`);
  if (s.innerRadius !== undefined) out.push(`inner-radius: ${num(s.innerRadius)}px`);
  if (s.starRotation !== undefined) out.push(`rotation: ${num(s.starRotation)}deg`);
  if (s.d !== undefined) out.push(`d: '${s.d}'`);
  if (s.clipPath !== undefined) out.push(`clip-path: ${s.clipPath}`);
  return out;
}

// ---------------------------------------------------------------------------
// Lottie bezier -> SVG path
// ---------------------------------------------------------------------------

/**
 * Animated bezier-path track? Like keyframesOf, infer animation from `k` being a
 * keyframe array even when the `a` flag lies or is absent (legacy v4 exports omit
 * it on `sh` items), so wiggling shapes aren't frozen to an empty static path.
 */
function isAnimatedShape(ks: any): boolean {
  if (!ks) return false;
  if (ks.a === 1) return true;
  const k = ks.k;
  return Array.isArray(k) && k.length > 0 && k[0] && typeof k[0] === 'object' && 't' in k[0];
}

/** The bezier shape object carried by an animated-path keyframe (s is [shape]). */
function shapeKf(kf: Kf): any {
  const s = kf.s as unknown;
  return Array.isArray(s) ? s[0] : s;
}

/**
 * Animated shape (`sh`) keyframes, canonicalized like numeric props: a legacy
 * `s`-less final keyframe (only `t`, value held on the previous keyframe's `e`)
 * gets its `s` filled in, so shapeKf/shapeAt never hit an undefined vertex list.
 */
function pathKfs(it: any): Kf[] {
  return normalizeKfs(it.ks.k as any[]);
}

/** Shape at frame t: hold the departing keyframe (Popcorn morphs between them). */
function shapeAt(kfs: Kf[], t: number): any {
  let kf = kfs[0];
  for (const k of kfs) {
    if (k.t <= t) kf = k;
    else break;
  }
  return shapeKf(kf);
}

function shapeToPath(shp: any): string {
  const v: number[][] = shp.v || [];
  const inT: number[][] = shp.i || [];
  const outT: number[][] = shp.o || [];
  if (v.length === 0) return '';
  const parts: string[] = [`M ${num(v[0][0])} ${num(v[0][1])}`];
  const n = v.length;
  const last = shp.c ? n : n - 1;
  for (let k = 0; k < last; k++) {
    const cur = v[k], nxt = v[(k + 1) % n];
    const o = outT[k] || [0, 0], iN = inT[(k + 1) % n] || [0, 0];
    parts.push(
      `C ${num(cur[0] + o[0])} ${num(cur[1] + o[1])} ${num(nxt[0] + iN[0])} ${num(nxt[1] + iN[1])} ${num(nxt[0])} ${num(nxt[1])}`
    );
  }
  if (shp.c) parts.push('Z');
  return parts.join(' ');
}

// --- geometry -> `d` synthesis (for merge-paths; bakes local placement) ------
// Each drawable in a merge becomes one closed subpath in absolute coordinates.
// Structures are command-count-stable across frames (rc always 4 line+corner
// pairs, el always 4 cubics, sr fixed by point count) so animated merges morph.

const KAPPA = 0.5522847498307936;

/** Rounded rect: center `p`, size `s`, corner radius `r`. Always 4 cubic corners. */
function rectToD(p: number[], s: number[], r: number): string {
  const w = s[0], h = s[1];
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const x0 = p[0] - w / 2, y0 = p[1] - h / 2, x1 = p[0] + w / 2, y1 = p[1] + h / 2;
  const c = rr * (1 - KAPPA);
  return [
    `M ${num(x0 + rr)} ${num(y0)}`,
    `L ${num(x1 - rr)} ${num(y0)}`,
    `C ${num(x1 - c)} ${num(y0)} ${num(x1)} ${num(y0 + c)} ${num(x1)} ${num(y0 + rr)}`,
    `L ${num(x1)} ${num(y1 - rr)}`,
    `C ${num(x1)} ${num(y1 - c)} ${num(x1 - c)} ${num(y1)} ${num(x1 - rr)} ${num(y1)}`,
    `L ${num(x0 + rr)} ${num(y1)}`,
    `C ${num(x0 + c)} ${num(y1)} ${num(x0)} ${num(y1 - c)} ${num(x0)} ${num(y1 - rr)}`,
    `L ${num(x0)} ${num(y0 + rr)}`,
    `C ${num(x0)} ${num(y0 + c)} ${num(x0 + c)} ${num(y0)} ${num(x0 + rr)} ${num(y0)}`,
    'Z',
  ].join(' ');
}

/** Ellipse as four kappa cubics, starting at the top. */
function ellipseToD(cx: number, cy: number, rx: number, ry: number): string {
  const ox = rx * KAPPA, oy = ry * KAPPA;
  return [
    `M ${num(cx)} ${num(cy - ry)}`,
    `C ${num(cx + ox)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - oy)} ${num(cx + rx)} ${num(cy)}`,
    `C ${num(cx + rx)} ${num(cy + oy)} ${num(cx + ox)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)}`,
    `C ${num(cx - ox)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + oy)} ${num(cx - rx)} ${num(cy)}`,
    `C ${num(cx - rx)} ${num(cy - oy)} ${num(cx - ox)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)}`,
    'Z',
  ].join(' ');
}

/** Serialize PathCommand[] (as emitted by the player's polystar) to a `d` string. */
function commandsToD(cmds: any[]): string {
  return cmds
    .map((c) => {
      switch (c.type) {
        case 'M': case 'L': return `${c.type} ${num(c.x)} ${num(c.y)}`;
        case 'C': return `C ${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`;
        case 'Q': return `Q ${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`;
        case 'Z': return 'Z';
        default: return '';
      }
    })
    .filter(Boolean)
    .join(' ');
}

/** Reuse the player's polystar math, then serialize, to `d` for a sr at frame t. */
function polystarToD(it: any, t: number): string {
  const p = prop(it.p), pt = prop(it.pt), or = prop(it.or), ir = prop(it.ir),
    rot = prop(it.r), os = prop(it.os), is = prop(it.is);
  const pv = p ? p.at(t) : [0, 0];
  const sd: any = {
    type: it.sy !== 2 ? 'star' : 'polygon',
    sides: pt ? pt.at(t)[0] : 5,
    outerRadius: or ? or.at(t)[0] : 0,
    innerRadius: ir ? ir.at(t)[0] : 0,
    outerRoundness: os ? os.at(t)[0] : 0,
    innerRoundness: is ? is.at(t)[0] : 0,
    rotation: rot ? rot.at(t)[0] : 0,
    cx: pv[0], cy: pv[1],
  };
  return commandsToD(polystarToCommands(sd));
}

/** A drawable (sh/rc/el/sr) as an absolute-coordinate `d` subpath at frame t. */
function drawableToDAt(it: any, t: number): string {
  if (it.ty === 'sh') {
    if (isAnimatedShape(it.ks)) return shapeToPath(shapeAt(pathKfs(it), t));
    return it.ks ? shapeToPath(it.ks.k) : '';
  }
  if (it.ty === 'rc') {
    const p = prop(it.p), s = prop(it.s), rnd = prop(it.r);
    return rectToD(p!.at(t), s!.at(t), rnd ? rnd.at(t)[0] || 0 : 0);
  }
  if (it.ty === 'el') {
    const p = prop(it.p), s = prop(it.s);
    const pv = p!.at(t), sv = s!.at(t);
    return ellipseToD(pv[0], pv[1], sv[0] / 2, sv[1] / 2);
  }
  if (it.ty === 'sr') return polystarToD(it, t);
  return '';
}

/** True if a drawable's geometry animates (so a merge must sample per keyframe). */
function drawableAnimated(it: any): boolean {
  if (it.ty === 'sh') return isAnimatedShape(it.ks);
  for (const key of ['p', 's', 'r', 'pt', 'or', 'ir', 'os', 'is']) {
    const v = prop(it[key]);
    if (v && v.animated) return true;
  }
  return false;
}

/** The keyframe track driving a drawable's geometry (for the union grid + easing). */
function drawableKfs(it: any): Kf[] {
  if (it.ty === 'sh') return isAnimatedShape(it.ks) ? pathKfs(it) : [];
  for (const key of ['p', 's', 'r', 'pt', 'or', 'ir', 'os', 'is']) {
    const v = prop(it[key]);
    if (v && v.animated && v.kfs) return v.kfs;
  }
  return [];
}

/** A group `tr` item has the same shape as a layer `ks`. */
function trToKs(tr: any): any {
  return { o: tr.o, r: tr.r, p: tr.p, a: tr.a, s: tr.s, sk: tr.sk };
}

/** A group transform that neither moves, rotates, scales nor skews its contents. */
function isIdentityTr(tr: any): boolean {
  if (!tr) return true;
  const stat = (p: any, def: number[]): boolean => {
    if (p == null) return true;
    if (p.a === 1) return false; // animated -> not a static identity
    const k = Array.isArray(p.k) ? p.k : [p.k];
    return def.every((d, i) => Math.abs((k[i] ?? d) - d) < 1e-6);
  };
  return stat(tr.p, [0, 0]) && stat(tr.a, [0, 0]) && stat(tr.s, [100, 100]) &&
    stat(tr.r, [0]) && stat(tr.sk, [0]) && stat(tr.sa, [0]);
}

/**
 * Flatten the drawable paths a group-level stroke covers (everything preceding
 * the stroke in the item list, recursing into nested groups). Returns null if
 * any intervening group transform is non-identity — then the paths don't share
 * one coordinate space and can't be unioned into a single stroke node here.
 */
function collectStrokeableDraws(items: any[]): any[] | null {
  const stIdx = items.map((it) => it.ty).lastIndexOf('st');
  const scope = stIdx >= 0 ? items.slice(0, stIdx) : items;
  const out: any[] = [];
  let ok = true;
  const walk = (its: any[]) => {
    for (const it of its) {
      if (!it || it.hd === true) continue;
      if (it.ty === 'gr') {
        const tr = (it.it || []).find((x: any) => x.ty === 'tr');
        if (!isIdentityTr(tr)) { ok = false; return; }
        walk(it.it || []);
      } else if (it.ty === 'rc' || it.ty === 'el' || it.ty === 'sh' || it.ty === 'sr') {
        out.push(it);
      }
    }
  };
  walk(scope);
  return ok ? out : null;
}

/** Lottie track-mask type (tt) -> Popcorn mask mode. */
const MASK_MODE: Record<number, string> = { 1: 'alpha', 2: 'alpha-invert', 3: 'luminance', 4: 'luminance-invert' };

/** Resolve an image asset to a URL: embedded data URI if present, else u + p. */
function assetSrc(asset: any): string {
  const p = asset.p || '';
  if (typeof p === 'string' && p.startsWith('data:')) return p;
  return `${asset.u || ''}${p}`;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** The most common per-segment easing across a track's non-last keyframes. A
 * segment with no explicit easing renders linear, so absent easing votes as
 * 'linear'. First-seen wins on ties (deterministic given block order). This
 * value goes in the `animation:` shorthand; keyframes matching it drop their
 * own `animation-timing-function` (player: `prev.easing || defaultEasing`). */
function modalEasing(blocks: AnimSpec['blocks']): string {
  const votes = new Map<string, number>();
  for (let i = 0; i < blocks.length - 1; i++) {
    const e = blocks[i].easing ?? 'linear';
    votes.set(e, (votes.get(e) || 0) + 1);
  }
  let modal = 'linear', best = 0;
  for (const [e, c] of votes) if (c > best) { best = c; modal = e; }
  return modal;
}

function serializeKeyframes(anim: AnimSpec): string {
  const lines: string[] = [`@keyframes ${anim.name} {`];
  const last = anim.blocks.length - 1;
  for (let i = 0; i < anim.blocks.length; i++) {
    const b = anim.blocks[i];
    const inner = b.decls.map((d) => `${d};`);
    // Emit easing only when it differs from the shorthand default. The last
    // keyframe has no outgoing segment, so its easing never renders — drop it.
    if (i < last && (b.easing ?? 'linear') !== anim.defaultEasing) {
      inner.push(`animation-timing-function: ${b.easing ?? 'linear'};`);
    }
    lines.push(`  ${num(b.offset)}% { ${inner.join(' ')} }`);
  }
  lines.push(`}`);
  return lines.join('\n');
}

/**
 * Hoist repeated path geometry into shared `:root` custom properties. A path
 * d-string emitted at N>1 sites — bare `d: '…'`, or wrapped in `path('…')` for
 * offset-path / clip-path, across both rules and @keyframes — is N-1 duplicate
 * copies of a large token. Replace each net-positive one with `var(--pN)` and
 * return the `:root` decls that define it once. `--pN` names can't collide with
 * the image-dedup `--img-*` convention. Shortest names go to the most-frequent
 * tokens; ordering is deterministic so output stays diffable. Beats gzip on
 * real files (the d-strings are long and highly repetitive).
 */
function dedupePaths(body: string): { body: string; vars: string[] } {
  interface M { start: number; end: number; token: string; }
  const matches: M[] = [];
  // path('…') / path("…") wherever it appears (offset-path, clip-path, compound
  // clips) — token is the whole function call.
  for (const m of body.matchAll(/path\((["'])(?:(?!\1).)*\1\)/g)) {
    const start = m.index!;
    matches.push({ start, end: start + m[0].length, token: m[0] });
  }
  // bare `d: '…'` — token is the quoted string only, so the `d:` prefix stays.
  for (const m of body.matchAll(/\bd:\s*((["'])(?:(?!\2).)*\2)/g)) {
    const start = m.index! + m[0].indexOf(m[1]);
    matches.push({ start, end: start + m[1].length, token: m[1] });
  }
  if (matches.length === 0) return { body, vars: [] };

  const freq = new Map<string, number>();
  for (const m of matches) freq.set(m.token, (freq.get(m.token) || 0) + 1);
  // Deterministic: most frequent first, then longest, then lexical.
  const cands = [...freq.entries()]
    .filter(([, occ]) => occ >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1));

  // Net bytes saved hoisting `occ` uses of a token of length L under a name of
  // length nl:  occ*(L − len("var(--name)")) − len("--name: token;")
  //           = occ*(L − (7 + nl)) − (nl + L + 5)   ["-- : ;" = 5 incl. one space]
  const nameOf = new Map<string, string>();
  const vars: string[] = [];
  let idx = 0;
  for (const [token, occ] of cands) {
    const name = `p${idx}`;
    const nl = name.length;
    const net = occ * (token.length - (7 + nl)) - (nl + token.length + 5);
    if (net <= 0) continue;
    nameOf.set(token, name);
    vars.push(`  --${name}: ${token};`);
    idx++;
  }
  if (nameOf.size === 0) return { body, vars: [] };

  // Substitute in one left-to-right pass over the (disjoint) match spans.
  const sel = matches.filter((m) => nameOf.has(m.token)).sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const m of sel) {
    out += body.slice(pos, m.start) + `var(--${nameOf.get(m.token)})`;
    pos = m.end;
  }
  out += body.slice(pos);
  return { body: out, vars };
}

function serializeRule(rule: Rule, depth: number, top: boolean): string {
  const pad = '  '.repeat(depth);
  const head = top ? `#${rule.id}` : `> #${rule.id}`;
  const lines: string[] = [`${pad}${head} {`];
  const ip = pad + '  ';
  lines.push(`${ip}type: ${rule.type};`);
  for (const d of rule.decls) lines.push(`${ip}${d};`);
  if (rule.anims && rule.anims.length) {
    // One comma-separated entry per channel; a single `animation-fill-mode: both`
    // longhand applies to every entry (the player carries it to each instance).
    const entries = rule.anims.map((a) => {
      const parts = [a.name, `${num(a.durationSec, 3)}s`, a.defaultEasing, '1'];
      if (Math.abs(a.delaySec) > 1e-6) parts.push(`${num(a.delaySec, 3)}s`);
      return parts.join(' ');
    });
    lines.push(`${ip}animation: ${entries.join(', ')};`);
    lines.push(`${ip}animation-fill-mode: both;`);
  }
  for (const c of rule.children) lines.push(serializeRule(c, depth + 1, false));
  lines.push(`${pad}}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validate(css: string): string[] {
  const errors: string[] = [];
  try {
    const sheet = parse(css);
    buildSceneGraph(sheet);
  } catch (e: any) {
    errors.push(e.message);
  }
  return errors;
}

/** Convert an already-parsed Lottie JSON object to Popcorn CSS. No file I/O — safe for browser use. */
export function convertLottie(lottie: any): { css: string; warnings: string[]; blocked: string[] } {
  const c = new Converter();
  const css = c.convert(lottie);
  return { css, warnings: c.warnings, blocked: [...c.blocked] };
}
