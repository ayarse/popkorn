#!/usr/bin/env bun
/**
 * Lottie JSON -> Popcorn DSL converter.
 *
 *   bun tools/lottie2popcorn.ts <in.json> [-o out.css] [--validate]
 *   bun tools/lottie2popcorn.ts --batch <dir> [--validate]
 *
 * Zero dependencies beyond the workspace. --validate re-parses and builds the
 * generated CSS through @popcorn/parser + @popcorn/player to prove it round-trips.
 *
 * The mapping is documented inline where it earns comment; the high-level model:
 * a Lottie comp becomes a :canvas plus one top-level rule per layer (emitted in
 * REVERSE layer order because Lottie paints last-to-first and Popcorn paints
 * first-behind). Layer transforms bake into transform/transform-origin/opacity;
 * animated properties become one @keyframes per node on the union of keyframe
 * times; spatial position keyframes become a CSS motion path.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse } from '../packages/popcorn-parser/src/index.ts';
import { buildSceneGraph } from '../packages/popcorn-player/src/scene/builder.ts';
import { parsePath, computePathLength } from '../packages/popcorn-player/src/scene/path-parser.ts';

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

/** [r,g,b,a] in 0..1 (a optional) times an extra opacity 0..1 -> #rrggbb / rgba(). */
function lottieColor(c: number[], opacity = 1): string {
  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const r = to255(c[0]), g = to255(c[1]), b = to255(c[2]);
  const a = (c.length > 3 ? c[3] : 1) * opacity;
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

/** Wrap a Lottie animatable property { a, k } into an accessor. */
function prop(p: any): Prop | null {
  if (!p) return null;
  if (p.a === 1 && Array.isArray(p.k)) {
    const kfs = (p.k as Kf[]).slice().sort((a, b) => a.t - b.t);
    return { animated: true, kfs, at: (t) => sampleAt(kfs, t) };
  }
  const v = asArr(p.k);
  return { animated: false, kfs: null, at: () => v };
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
  tx: number; ty: number; rot: number; sx: number; sy: number;
  opacity: number; cx: number; cy: number; rx: number; ry: number;
  x: number; y: number; width: number; height: number;
  fill: string; stroke: string; strokeWidth: number;
  offsetDistance: number; trimStart: number; trimEnd: number; trimOffset: number;
  outerRadius: number; innerRadius: number; starRotation: number;
  d: string;
}>;

interface Rule {
  id: string;
  type: string; // group | rect | circle | ellipse | path
  decls: string[];
  channels: Channel[];
  children: Rule[];
  animName?: string;
  animBlocks?: { offset: number; decls: string[]; easing?: string }[];
  durationSec?: number;
  delaySec?: number;
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

const BLOCKED_MODIFIERS: Record<string, string> = {
  rp: 'repeater (rp)',
  rd: 'round-corners (rd)',
  mm: 'merge (mm)',
  op: 'offset-path modifier (op)',
  zz: 'zig-zag (zz)',
  pb: 'pucker-bloat (pb)',
};

export class Converter {
  warnings: string[] = [];
  blocked = new Set<string>();
  private ids = new Set<string>();
  private crossSampled = false;
  private assets = new Map<string, any>();
  // refIds of precomps currently being expanded, for cycle detection.
  private compStack = new Set<string>();
  fr = 60;
  ip = 0;

  warnOnce(msg: string) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  private uniqueId(raw: string): string {
    let base = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!base || !/^[a-zA-Z_]/.test(base)) base = 'l-' + base;
    let id = base;
    let n = 2;
    while (this.ids.has(id)) id = `${base}-${n++}`;
    this.ids.add(id);
    return id;
  }

  convert(lottie: any): string {
    this.fr = lottie.fr || 60;
    this.ip = lottie.ip || 0;
    const op = lottie.op || 0;
    const w = lottie.w || 800;
    const h = lottie.h || 600;
    const durSec = (op - this.ip) / this.fr;

    // Index assets by id for image (ty 2) layers.
    if (Array.isArray(lottie.assets)) for (const a of lottie.assets) if (a && a.id) this.assets.set(a.id, a);

    const layers: any[] = Array.isArray(lottie.layers) ? lottie.layers : [];
    const topRules = this.buildLayerList(layers, '');

    if (this.crossSampled) {
      this.warnOnce('some nodes animate multiple properties with differing keyframe times; secondary props linear-sampled');
    }

    // Serialize.
    const out: string[] = [];
    out.push(`/* Generated from Lottie by tools/lottie2popcorn.ts */`);
    out.push(`/* comp ${w}x${h} @ ${this.fr}fps, duration ${num(durSec)}s */`);
    out.push('');
    out.push(`:canvas {`);
    out.push(`  width: ${num(w)}px;`);
    out.push(`  height: ${num(h)}px;`);
    out.push(`}`);
    out.push('');

    const keyframeBlocks: string[] = [];
    const collectKf = (r: Rule) => {
      if (r.animName && r.animBlocks) keyframeBlocks.push(serializeKeyframes(r));
      r.children.forEach(collectKf);
    };
    topRules.forEach(collectKf);
    if (keyframeBlocks.length) {
      out.push(keyframeBlocks.join('\n\n'));
      out.push('');
    }

    for (const r of topRules) {
      out.push(serializeRule(r, 0, true));
      out.push('');
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  // --- layer list -> rules ------------------------------------------------

  private isConvertible(l: any): boolean {
    return l && (l.ty === 0 || l.ty === 1 || l.ty === 2 || l.ty === 3 || l.ty === 4);
  }

  /**
   * Convert one composition's layer list (the root comp, or a precomp asset's
   * layers) into top-level rules. Parenting, reverse paint order, and track
   * mattes are all resolved locally within the list. `prefix` namespaces ids so
   * multiple instances of the same precomp never collide.
   */
  private buildLayerList(layers: any[], prefix: string): Rule[] {
    const byInd = new Map<number, any>();
    for (const l of layers) if (typeof l.ind === 'number') byInd.set(l.ind, l);

    // Record blocked non-convertible layer types.
    for (const l of layers) {
      if (this.isConvertible(l)) continue;
      const feat = l.ty === 5 ? 'text layer (ty 5)' : `layer type ${l.ty}`;
      this.blocked.add(feat);
    }

    // children[parentInd] = convertible child layers, array order preserved.
    const childrenOf = new Map<number, any[]>();
    const roots: any[] = [];
    for (const l of layers) {
      if (!this.isConvertible(l)) continue;
      const parent = l.parent;
      if (typeof parent === 'number' && this.isConvertible(byInd.get(parent))) {
        (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(l);
      } else {
        roots.push(l);
      }
    }

    const ruleByInd = new Map<number, Rule>();
    const buildLayer = (l: any): Rule | null => {
      try {
        return this.buildLayerRule(l, childrenOf, prefix, ruleByInd);
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

    // Track mattes: a layer with `tt` is masked by its matte source (the layer
    // referenced by `tp`, else the one directly above). Emit `matte: #id <mode>`
    // on the content rule; the source rule is marked matteSource at build time.
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (l.tt === undefined) continue;
      const mode = MATTE_MODE[l.tt];
      if (!mode) { this.blocked.add(`track matte mode tt:${l.tt}`); continue; }
      const content = ruleByInd.get(l.ind);
      const srcInd = typeof l.tp === 'number' ? l.tp : layers[i - 1]?.ind;
      const source = srcInd !== undefined ? ruleByInd.get(srcInd) : undefined;
      if (!content || !source) { this.blocked.add('track matte (unresolved source)'); continue; }
      content.decls.push(`matte: #${source.id} ${mode}`);
    }

    return topRules;
  }

  // --- layer -> rule ------------------------------------------------------

  private buildLayerRule(
    l: any,
    childrenOf: Map<number, any[]>,
    prefix: string,
    ruleByInd: Map<number, Rule>
  ): Rule {
    const id = this.uniqueId(prefix ? `${prefix}-${l.nm || `layer-${l.ind}`}` : (l.nm || `layer-${l.ind}`));
    const st = l.st || 0;

    this.scanBlocked(l);
    const maskDecl = this.maskClipPath(l);
    const record = (rule: Rule): Rule => {
      if (typeof l.ind === 'number') ruleByInd.set(l.ind, rule);
      return rule;
    };

    // Layer visibility window narrower than the comp -> we don't animate pop in/out.
    if ((l.ip ?? this.ip) > this.ip || (l.op ?? 0) < 0) { /* handled below */ }
    // (compare to comp window supplied via convert())
    // Note: comp op captured at call site; approximate check on layer ip.
    if (typeof l.ip === 'number' && l.ip > this.ip) {
      this.warnOnce(`layer '${id}' pops in at frame ${l.ip} (visibility not animated)`);
    }

    const childLayers = (childrenOf.get(l.ind) ?? []).slice().reverse();
    const childRules: Rule[] = [];
    for (const cl of childLayers) {
      try {
        childRules.push(this.buildLayerRule(cl, childrenOf, prefix, ruleByInd));
      } catch (e: any) {
        this.warnOnce(`child layer ${cl.ind} skipped: ${e.message}`);
      }
    }

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
      if (maskDecl) group.decls.push(maskDecl);

      // Precomps clip to their comp box (per spec; harmless when content fits).
      const cw = l.w ?? asset.w, ch = l.h ?? asset.h;
      if (cw && ch) group.decls.push(`clip-path: path('M0 0 H${num(cw)} V${num(ch)} H0 Z')`);

      // Time scoping: st -> local start offset; sr stretch -> time-scale (1/sr,
      // since Lottie sr=2 plays at half speed).
      if (st) group.decls.push(`time-offset: ${num(st / this.fr, 3)}s`);
      if (typeof l.sr === 'number' && l.sr !== 1 && l.sr > 0) {
        group.decls.push(`time-scale: ${num(1 / l.sr, 4)}`);
      }

      this.compStack.add(l.refId);
      const assetRules = this.buildLayerList(asset.layers, id);
      this.compStack.delete(l.refId);
      group.children.push(...assetRules, ...childRules);
      this.finalizeAnim(group, 0);
      return record(group);
    }

    if (l.ty === 2) {
      // Image layer: draw the referenced asset in its natural-size box; the
      // layer transform (with the anchor as transform-origin) positions it.
      const asset = this.assets.get(l.refId);
      if (!asset) { this.blocked.add('image layer missing asset'); throw new Error(`missing asset '${l.refId}'`); }
      const img: Rule = { id, type: 'image', decls: [], channels: [], children: [] };
      img.decls.push(`src: '${assetSrc(asset)}'`, `x: 0`, `y: 0`);
      if (asset.w) img.decls.push(`width: ${num(asset.w)}px`);
      if (asset.h) img.decls.push(`height: ${num(asset.h)}px`);
      this.applyTransform(l.ks, img, st);
      if (maskDecl) img.decls.push(maskDecl);
      img.children.push(...childRules);
      this.finalizeAnim(img, st);
      return record(img);
    }

    if (l.ty === 1) {
      // Solid: a rect of sw x sh filled with sc, plus the layer transform.
      const rect: Rule = { id, type: 'rect', decls: [], channels: [], children: [] };
      rect.decls.push(`x: 0`, `y: 0`, `width: ${num(l.sw)}px`, `height: ${num(l.sh)}px`);
      if (l.sc) rect.decls.push(`fill: ${l.sc}`);
      this.applyTransform(l.ks, rect, st);
      if (childRules.length === 0) {
        if (maskDecl) rect.decls.push(maskDecl);
        this.finalizeAnim(rect, st);
        return record(rect);
      }
      // Solid used as a parent: wrap the rect in a group carrying the transform.
      const group: Rule = { id, type: 'group', decls: [], channels: [], children: [] };
      this.applyTransform(l.ks, group, st);
      if (maskDecl) group.decls.push(maskDecl);
      rect.id = this.uniqueId(id + '-rect');
      rect.decls = rect.decls.filter((d) => !d.startsWith('transform') && !d.startsWith('opacity'));
      rect.channels = [];
      group.children.push(rect, ...childRules);
      this.finalizeAnim(group, st);
      return record(group);
    }

    // Null (ty 3) and shape (ty 4) are both groups.
    const group: Rule = { id, type: 'group', decls: [], channels: [], children: [] };
    this.applyTransform(l.ks, group, st);
    if (maskDecl) group.decls.push(maskDecl);

    if (l.ty === 4 && Array.isArray(l.shapes)) {
      const shapeChildren = this.processItems(l.shapes, id, { fill: null, stroke: null });
      group.children.push(...shapeChildren);
    }
    group.children.push(...childRules);
    this.finalizeAnim(group, st);
    return record(group);
  }

  private scanBlocked(l: any) {
    if (l.tm !== undefined) this.blocked.add('time remap (tm)');
  }

  /**
   * Layer masks (masksProperties) -> a `clip-path` with one path() per mask,
   * unioned. Only static add-mode masks at full opacity convert; other modes,
   * inverted/animated masks or reduced opacity block the layer. Mask expansion
   * (x != 0) converts anyway (expansion is ignored) with a warning.
   */
  private maskClipPath(l: any): string | null {
    const masks = l.masksProperties;
    if (!Array.isArray(masks) || masks.length === 0) return null;
    const paths: string[] = [];
    for (const m of masks) {
      if (m.mode && m.mode !== 'a') { this.blocked.add(`mask mode '${m.mode}'`); return null; }
      if (m.inv) { this.blocked.add('inverted mask (inv)'); return null; }
      const o = prop(m.o);
      if (o && (o.animated || (o.at(0)[0] ?? 100) < 100)) { this.blocked.add('mask opacity < 100'); return null; }
      const pt = m.pt;
      if (!pt || pt.a === 1 || !pt.k) { this.blocked.add('animated mask shape'); return null; }
      const x = prop(m.x);
      if (x && Math.abs(x.at(0)[0] ?? 0) > 1e-6) this.warnOnce(`mask expansion on '${l.nm || l.ind}' ignored`);
      const d = shapeToPath(pt.k);
      if (d) paths.push(`path('${d}')`);
    }
    return paths.length ? `clip-path: ${paths.join(' ')}` : null;
  }

  // --- transform (ks / tr) -> decls + channels ----------------------------

  private applyTransform(ks: any, rule: Rule, st: number) {
    if (!ks) return;
    const o = prop(ks.o);
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

    const idxAt = (t: number) => {
      let best = 0;
      for (let i = 0; i < kfs.length; i++) if (kfs[i].t <= t) best = i;
      return best;
    };
    rule.channels.push({
      priority: 6,
      kfs,
      sample: (t) => ({ offsetDistance: frac[idxAt(t)] }),
    });
    // rotation still applies statically or via its own channel (handled by caller path).
    void r;
  }

  // --- shape items --------------------------------------------------------

  private processItems(
    items: any[],
    prefix: string,
    inherited: { fill: string | null; stroke: string | null }
  ): Rule[] {
    // Resolve this level's paint style (nearest fill/stroke wins).
    let fill: string | null = inherited.fill;
    let fillCh: ((t: number) => Sample) | null = null;
    let fillKfs: Kf[] | null = null;
    let stroke: string | null = inherited.stroke;
    let strokeWidth: number | null = null;
    let lineCap: string | null = null;
    let dashArray: number[] | null = null;
    let dashOffset = 0;
    let gradientFill: string | null = null;
    let fillCount = 0;
    let fillRule: number | null = null;
    let trim: { start: number; end: number; offset: number } | null = null;

    for (const it of items) {
      switch (it.ty) {
        case 'fl': {
          fillCount++;
          const c = prop(it.c);
          const o = prop(it.o);
          const op = o && !o.animated ? (o.at(0)[0] ?? 100) / 100 : 1;
          if (o && o.animated) this.warnOnce('animated fill opacity baked to first value');
          if (c && c.animated && c.kfs) {
            fillKfs = c.kfs;
            fillCh = (t) => ({ fill: lottieColor(c.at(t), op) });
            fill = lottieColor(c.at(c.kfs[0].t), op);
          } else if (c) {
            fill = lottieColor(c.at(0), op);
          }
          if (it.r === 1 || it.r === 2) fillRule = it.r;
          break;
        }
        case 'st': {
          const c = prop(it.c);
          const w = prop(it.w);
          if (c) stroke = c.animated ? lottieColor(c.at(c.kfs![0].t)) : lottieColor(c.at(0));
          if (w) strokeWidth = w.at(0)[0] ?? 0;
          lineCap = it.lc === 2 ? 'round' : it.lc === 3 ? 'square' : 'butt';
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
        case 'gf':
        case 'gs': {
          gradientFill = this.buildGradient(it);
          // Animated stops -> a fill channel of gradient() strings per keyframe.
          if (it.g && it.g.k && it.g.k.a === 1) {
            const gk = it.g.k.k as Kf[];
            fillKfs = gk;
            fillCh = (t) => ({ fill: this.gradientCssAt(it, t) ?? gradientFill! });
          }
          break;
        }
        case 'tm': {
          const s = prop(it.s), e = prop(it.e), o = prop(it.o);
          if ((s && s.animated) || (e && e.animated) || (o && o.animated))
            this.warnOnce('animated trim baked to first value');
          trim = {
            start: s ? s.at(0)[0] ?? 0 : 0,
            end: e ? e.at(0)[0] ?? 100 : 100,
            offset: o ? (o.at(0)[0] ?? 0) / 360 : 0,
          };
          break;
        }
        default:
          if (it.ty in BLOCKED_MODIFIERS) this.blocked.add(BLOCKED_MODIFIERS[it.ty]);
      }
    }
    if (fillCount > 1) this.warnOnce('group has multiple fills; last one used');

    const effectiveFill = gradientFill ?? fill;
    const style = { fill: effectiveFill, stroke };

    const applyStyle = (rule: Rule) => {
      if (effectiveFill) rule.decls.push(`fill: ${effectiveFill}`);
      else rule.decls.push(`fill: none`);
      if (stroke) rule.decls.push(`stroke: ${stroke}`);
      if (strokeWidth != null) rule.decls.push(`stroke-width: ${num(strokeWidth)}px`);
      if (lineCap && lineCap !== 'butt') rule.decls.push(`stroke-linecap: ${lineCap}`);
      if (dashArray) rule.decls.push(`stroke-dasharray: ${dashArray.map((d) => `${num(d)}px`).join(' ')}`);
      if (dashOffset) rule.decls.push(`stroke-dashoffset: ${num(dashOffset)}px`);
      if (fillRule === 2) rule.decls.push(`fill-rule: evenodd`);
      if (trim) {
        rule.decls.push(`trim-start: ${num(trim.start)}%`, `trim-end: ${num(trim.end)}%`);
        if (trim.offset) rule.decls.push(`trim-offset: ${num(trim.offset, 3)}`);
      }
      if (fillCh && fillKfs) rule.channels.push({ priority: 1, kfs: fillKfs, sample: fillCh });
    };

    const out: Rule[] = [];
    let dcount = 0;
    for (const it of items) {
      if (it.ty === 'gr') {
        const gid = this.uniqueId(prefix + '-' + (it.nm ? it.nm : `g${dcount++}`));
        const grp: Rule = { id: gid, type: 'group', decls: [], channels: [], children: [] };
        const tr = (it.it || []).find((x: any) => x.ty === 'tr');
        if (tr) this.applyTransform(trToKs(tr), grp, 0);
        grp.children.push(...this.processItems(it.it || [], gid, style));
        this.finalizeAnim(grp, 0);
        out.push(grp);
      } else if (it.ty === 'rc' || it.ty === 'el' || it.ty === 'sh' || it.ty === 'sr') {
        const drawable = this.buildDrawable(it, prefix + '-' + (it.nm ? it.nm : `s${dcount++}`));
        if (drawable) {
          applyStyle(drawable);
          this.finalizeAnim(drawable, 0);
          out.push(drawable);
        }
      }
    }
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
      // Polystar: sy 1 = star, 2 = polygon. pt=points, or/ir=radii, r=rotation
      // (deg), os/is=roundness (%), p=center. points is static; radii/rotation/
      // center animate. Geometry is synthesized into a path downstream.
      const star = it.sy !== 2;
      const rule: Rule = { id, type: star ? 'star' : 'polygon', decls: [], channels: [], children: [] };
      const p = prop(it.p), pt = prop(it.pt), or = prop(it.or), ir = prop(it.ir),
        rot = prop(it.r), os = prop(it.os), is = prop(it.is);
      const pv = p ? p.at(0) : [0, 0];
      rule.decls.push(`points: ${num(pt ? pt.at(0)[0] : 5, 0)}`);
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
    if (it.ks && it.ks.a === 1) {
      const kfs = it.ks.k as Kf[];
      rule.decls.push(`d: '${shapeToPath(shapeKf(kfs[0]))}'`);
      rule.channels.push({ priority: 6, kfs, sample: (t) => ({ d: shapeToPath(shapeAt(kfs, t)) }) });
      return rule;
    }
    const shp = it.ks ? it.ks.k : null;
    if (!shp) return null;
    rule.decls.push(`d: '${shapeToPath(shp)}'`);
    return rule;
  }

  private buildGradient(it: any): string | null {
    const g = it.g;
    if (!g || !g.k) return null;
    // Animated stops: emit a fill channel of full gradient() strings per keyframe
    // (Popcorn interpolates them; see registry 'gradient'). Static: bake at t0.
    return this.gradientCssAt(it, g.k.a === 1 ? g.k.k[0].t : 0);
  }

  /** Build the CSS gradient string for `it` at frame `t` (samples animated stops). */
  private gradientCssAt(it: any, t: number): string | null {
    const g = it.g;
    if (!g || !g.k) return null;
    const flat: number[] = g.k.a === 1 ? sampleAt(g.k.k, t) : g.k.k;
    const count = g.p || Math.floor(flat.length / 4);
    const stops: string[] = [];
    for (let i = 0; i < count; i++) {
      const pos = flat[i * 4];
      const col = lottieColor([flat[i * 4 + 1], flat[i * 4 + 2], flat[i * 4 + 3]]);
      stops.push(`${col} ${num(pos * 100)}%`);
    }
    if (flat.length > count * 4) this.warnOnce('gradient alpha stops ignored');
    if (it.t === 2) {
      this.warnOnce('radial gradient position is approximate (centered on bbox)');
      return `radial-gradient(${stops.join(', ')})`;
    }
    // Linear: CSS angle from the s->e vector (CSS 0deg = up, 90deg = right).
    const s = prop(it.s)?.at(t) ?? [0, 0];
    const e = prop(it.e)?.at(t) ?? [1, 0];
    const angle = (Math.atan2(e[0] - s[0], -(e[1] - s[1])) * 180) / Math.PI;
    return `linear-gradient(${num(angle)}deg, ${stops.join(', ')})`;
  }

  // --- animation assembly -------------------------------------------------

  private finalizeAnim(rule: Rule, st: number) {
    if (rule.channels.length === 0) return;

    // Union of keyframe times across the node's channels.
    const timeSet = new Set<number>();
    for (const ch of rule.channels) for (const k of ch.kfs) timeSet.add(k.t);
    const times = [...timeSet].sort((a, b) => a - b);

    // A single time = degenerate; bake it as static and drop the animation.
    if (times.length < 2) {
      const s = mergeSamples(rule.channels.map((c) => c.sample(times[0] ?? 0)));
      rule.decls.push(...declsFromSample(s));
      rule.channels = [];
      return;
    }

    const primary = rule.channels.reduce((a, b) => (b.priority > a.priority ? b : a));
    const primTimes = new Set(primary.kfs.map((k) => k.t));
    if (rule.channels.some((ch) => ch !== primary && ch.kfs.some((k) => !primTimes.has(k.t))))
      this.crossSampled = true;

    const t0 = times[0], tN = times[times.length - 1];
    const span = tN - t0;

    rule.durationSec = span / this.fr;
    rule.delaySec = (t0 - this.ip) / this.fr + st / this.fr;
    rule.animName = this.uniqueId(rule.id + '-k');
    rule.animBlocks = [];

    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const sample = mergeSamples(rule.channels.map((c) => c.sample(t)));
      const block: { offset: number; decls: string[]; easing?: string } = {
        offset: (span > 0 ? (t - t0) / span : 0) * 100,
        decls: declsFromSample(sample),
      };
      if (i < times.length - 1) {
        const easing = this.segmentEasing(primary, t);
        if (easing) block.easing = easing;
      }
      rule.animBlocks.push(block);
    }
  }

  /** Per-segment easing from the primary channel's departing keyframe. */
  private segmentEasing(primary: Channel, t: number): string | null {
    const kfs = primary.kfs;
    let idx = kfs.findIndex((k) => k.t === t);
    if (idx < 0) {
      // Union introduced a foreign time; fall back to the containing segment.
      for (let i = 0; i < kfs.length - 1; i++) if (t >= kfs[i].t && t < kfs[i + 1].t) { idx = i; break; }
      this.crossSampled = true;
    }
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

function mergeSamples(samples: Sample[]): Sample {
  return Object.assign({}, ...samples);
}

function declsFromSample(s: Sample): string[] {
  const out: string[] = [];
  const tf: string[] = [];
  if (s.tx !== undefined || s.ty !== undefined) tf.push(`translate(${num(s.tx ?? 0)}px, ${num(s.ty ?? 0)}px)`);
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
  if (s.trimOffset !== undefined) out.push(`trim-offset: ${num(s.trimOffset, 3)}`);
  if (s.outerRadius !== undefined) out.push(`outer-radius: ${num(s.outerRadius)}px`);
  if (s.innerRadius !== undefined) out.push(`inner-radius: ${num(s.innerRadius)}px`);
  if (s.starRotation !== undefined) out.push(`rotation: ${num(s.starRotation)}deg`);
  if (s.d !== undefined) out.push(`d: '${s.d}'`);
  return out;
}

// ---------------------------------------------------------------------------
// Lottie bezier -> SVG path
// ---------------------------------------------------------------------------

/** The bezier shape object carried by an animated-path keyframe (s is [shape]). */
function shapeKf(kf: Kf): any {
  const s = kf.s as unknown;
  return Array.isArray(s) ? s[0] : s;
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

/** A group `tr` item has the same shape as a layer `ks`. */
function trToKs(tr: any): any {
  return { o: tr.o, r: tr.r, p: tr.p, a: tr.a, s: tr.s, sk: tr.sk };
}

/** Lottie track-matte type (tt) -> Popcorn matte mode. */
const MATTE_MODE: Record<number, string> = { 1: 'alpha', 2: 'alpha-invert', 3: 'luma', 4: 'luma-invert' };

/** Resolve an image asset to a src: embedded data URI if present, else u + p. */
function assetSrc(asset: any): string {
  const p = asset.p || '';
  if (typeof p === 'string' && p.startsWith('data:')) return p;
  return `${asset.u || ''}${p}`;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeKeyframes(rule: Rule): string {
  const lines: string[] = [`@keyframes ${rule.animName} {`];
  for (const b of rule.animBlocks!) {
    const inner = b.decls.map((d) => `${d};`);
    if (b.easing) inner.push(`animation-timing-function: ${b.easing};`);
    lines.push(`  ${num(b.offset)}% { ${inner.join(' ')} }`);
  }
  lines.push(`}`);
  return lines.join('\n');
}

function serializeRule(rule: Rule, depth: number, top: boolean): string {
  const pad = '  '.repeat(depth);
  const head = top ? `#${rule.id}` : `> #${rule.id}`;
  const lines: string[] = [`${pad}${head} {`];
  const ip = pad + '  ';
  lines.push(`${ip}type: ${rule.type};`);
  for (const d of rule.decls) lines.push(`${ip}${d};`);
  if (rule.animName) {
    const delay = rule.delaySec && Math.abs(rule.delaySec) > 1e-6;
    const durTok = `${num(rule.durationSec!, 3)}s`;
    const parts = [rule.animName, durTok, 'linear', '1'];
    if (delay) parts.push(`${num(rule.delaySec!, 3)}s`);
    lines.push(`${ip}animation: ${parts.join(' ')};`);
    lines.push(`${ip}animation-fill-mode: both;`);
  }
  for (const c of rule.children) lines.push(serializeRule(c, depth + 1, false));
  lines.push(`${pad}}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(css: string): string[] {
  const errors: string[] = [];
  try {
    const sheet = parse(css);
    buildSceneGraph(sheet);
  } catch (e: any) {
    errors.push(e.message);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function convertFile(path: string): { css: string; warnings: string[]; blocked: Set<string> } {
  const lottie = JSON.parse(readFileSync(path, 'utf8'));
  const c = new Converter();
  const css = c.convert(lottie);
  return { css, warnings: c.warnings, blocked: c.blocked };
}

function walkJson(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkJson(p, out);
    else if (name.endsWith('.json') && !name.endsWith('-meta.json')) out.push(p);
  }
  return out;
}

function runBatch(dir: string) {
  const files = walkJson(dir).sort();
  let clean = 0, warn = 0, blockedCount = 0, failed = 0;
  const blockerTally = new Map<string, number>();
  const rows: string[] = [];

  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    let res;
    try {
      res = convertFile(f);
    } catch (e: any) {
      failed++;
      rows.push(`  FAIL      ${rel}  (${e.message})`);
      continue;
    }
    const errors = validate(res.css);
    const blocked = [...res.blocked];
    for (const b of blocked) blockerTally.set(b, (blockerTally.get(b) || 0) + 1);

    if (errors.length) {
      failed++;
      rows.push(`  FAIL      ${rel}  validate: ${errors[0]}`);
    } else if (blocked.length) {
      blockedCount++;
      rows.push(`  BLOCKED   ${rel}  [${blocked.join('; ')}]`);
    } else if (res.warnings.length) {
      warn++;
      rows.push(`  WARN      ${rel}  (${res.warnings.join('; ')})`);
    } else {
      clean++;
      rows.push(`  CLEAN     ${rel}`);
    }
  }

  console.log(rows.join('\n'));
  console.log('\n' + '-'.repeat(60));
  console.log(`total ${files.length}: clean ${clean}, warn ${warn}, blocked ${blockedCount}, failed ${failed}`);
  if (blockerTally.size) {
    console.log('\ntop blockers:');
    [...blockerTally.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}x  ${k}`));
  }
}

function main() {
  const argv = process.argv.slice(2);
  const doValidate = argv.includes('--validate');
  const batchIdx = argv.indexOf('--batch');
  if (batchIdx >= 0) {
    const dir = argv[batchIdx + 1];
    if (!dir) { console.error('--batch requires a directory'); process.exit(1); }
    runBatch(dir);
    return;
  }

  const positional = argv.filter((a, i) => !a.startsWith('-') && argv[i - 1] !== '-o');
  const input = positional[0];
  if (!input) {
    console.error('usage: bun tools/lottie2popcorn.ts <in.json> [-o out.css] [--validate]');
    console.error('       bun tools/lottie2popcorn.ts --batch <dir> [--validate]');
    process.exit(1);
  }
  const oIdx = argv.indexOf('-o');
  const outPath = oIdx >= 0 ? argv[oIdx + 1] : null;

  const { css, warnings, blocked } = convertFile(input);
  if (outPath) { writeFileSync(outPath, css); console.error(`wrote ${outPath}`); }
  else process.stdout.write(css);

  for (const w of warnings) console.error(`warning: ${w}`);
  for (const b of blocked) console.error(`blocked: ${b}`);
  if (doValidate) {
    const errors = validate(css);
    if (errors.length) { for (const e of errors) console.error(`validate error: ${e}`); process.exit(1); }
    console.error('validate: ok');
  }
}

// Only run the CLI when executed directly, so tests can import the Converter.
if (import.meta.main) main();
