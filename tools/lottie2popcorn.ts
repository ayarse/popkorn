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
  sr: 'polystar (sr)',
  rp: 'repeater (rp)',
  rd: 'round-corners (rd)',
  mm: 'merge (mm)',
  op: 'offset-path modifier (op)',
  zz: 'zig-zag (zz)',
  pb: 'pucker-bloat (pb)',
};

class Converter {
  warnings: string[] = [];
  blocked = new Set<string>();
  private ids = new Set<string>();
  private crossSampled = false;
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

    const layers: any[] = Array.isArray(lottie.layers) ? lottie.layers : [];
    const byInd = new Map<number, any>();
    for (const l of layers) if (typeof l.ind === 'number') byInd.set(l.ind, l);

    const convertible = (l: any) => l && (l.ty === 1 || l.ty === 3 || l.ty === 4);

    // Record blocked non-convertible layer types.
    for (const l of layers) {
      if (convertible(l)) continue;
      const feat =
        l.ty === 0 ? 'precomp layer (ty 0)' :
        l.ty === 2 ? 'image layer (ty 2)' :
        l.ty === 5 ? 'text layer (ty 5)' :
        `layer type ${l.ty}`;
      this.blocked.add(feat);
    }

    // children[parentInd] = convertible child layers, array order preserved.
    const childrenOf = new Map<number, any[]>();
    const roots: any[] = [];
    for (const l of layers) {
      if (!convertible(l)) continue;
      const parent = l.parent;
      if (typeof parent === 'number' && convertible(byInd.get(parent))) {
        (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(l);
      } else {
        roots.push(l);
      }
    }

    const buildLayer = (l: any): Rule | null => {
      try {
        return this.buildLayerRule(l, childrenOf);
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

  // --- layer -> rule ------------------------------------------------------

  private buildLayerRule(l: any, childrenOf: Map<number, any[]>): Rule {
    const id = this.uniqueId(l.nm || `layer-${l.ind}`);
    const st = l.st || 0;

    this.scanBlocked(l);

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
        childRules.push(this.buildLayerRule(cl, childrenOf));
      } catch (e: any) {
        this.warnOnce(`child layer ${cl.ind} skipped: ${e.message}`);
      }
    }

    if (l.ty === 1) {
      // Solid: a rect of sw x sh filled with sc, plus the layer transform.
      const rect: Rule = { id, type: 'rect', decls: [], channels: [], children: [] };
      rect.decls.push(`x: 0`, `y: 0`, `width: ${num(l.sw)}px`, `height: ${num(l.sh)}px`);
      if (l.sc) rect.decls.push(`fill: ${l.sc}`);
      this.applyTransform(l.ks, rect, st);
      if (childRules.length === 0) {
        this.finalizeAnim(rect, st);
        return rect;
      }
      // Solid used as a parent: wrap the rect in a group carrying the transform.
      const group: Rule = { id, type: 'group', decls: [], channels: [], children: [] };
      this.applyTransform(l.ks, group, st);
      rect.id = this.uniqueId(id + '-rect');
      rect.decls = rect.decls.filter((d) => !d.startsWith('transform') && !d.startsWith('opacity'));
      rect.channels = [];
      group.children.push(rect, ...childRules);
      this.finalizeAnim(group, st);
      return group;
    }

    // Null (ty 3) and shape (ty 4) are both groups.
    const group: Rule = { id, type: 'group', decls: [], channels: [], children: [] };
    this.applyTransform(l.ks, group, st);

    if (l.ty === 4 && Array.isArray(l.shapes)) {
      const shapeChildren = this.processItems(l.shapes, id, { fill: null, stroke: null });
      group.children.push(...shapeChildren);
    }
    group.children.push(...childRules);
    this.finalizeAnim(group, st);
    return group;
  }

  private scanBlocked(l: any) {
    if (Array.isArray(l.masksProperties) && l.masksProperties.length > 0) this.blocked.add('layer mask (masksProperties)');
    if (l.tt !== undefined) this.blocked.add('track matte (tt)');
    if (l.tm !== undefined) this.blocked.add('time remap (tm)');
    if (l.hasMask) this.blocked.add('layer mask');
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
    let gradientFill: string | null = null;
    let fillCount = 0;
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
          break;
        }
        case 'st': {
          const c = prop(it.c);
          const w = prop(it.w);
          if (c) stroke = c.animated ? lottieColor(c.at(c.kfs![0].t)) : lottieColor(c.at(0));
          if (w) strokeWidth = w.at(0)[0] ?? 0;
          lineCap = it.lc === 2 ? 'round' : it.lc === 3 ? 'square' : 'butt';
          break;
        }
        case 'gf':
        case 'gs': {
          gradientFill = this.buildGradient(it);
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
      } else if (it.ty === 'rc' || it.ty === 'el' || it.ty === 'sh') {
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
    // sh: static bezier path
    if (it.ks && it.ks.a === 1) { this.blocked.add('animated bezier path (sh a:1)'); return null; }
    const rule: Rule = { id, type: 'path', decls: [], channels: [], children: [] };
    const shp = it.ks ? (it.ks.a === 1 ? it.ks.k[0].s : it.ks.k) : null;
    if (!shp) return null;
    rule.decls.push(`d: '${shapeToPath(shp)}'`);
    return rule;
  }

  private buildGradient(it: any): string | null {
    const g = it.g;
    if (!g || !g.k) return null;
    if (g.k.a === 1) { this.blocked.add('animated gradient stops'); return null; }
    const flat: number[] = g.k.k;
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
    const s = prop(it.s)?.at(0) ?? [0, 0];
    const e = prop(it.e)?.at(0) ?? [1, 0];
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
  return out;
}

// ---------------------------------------------------------------------------
// Lottie bezier -> SVG path
// ---------------------------------------------------------------------------

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
    let durTok = `${num(rule.durationSec!, 3)}s`;
    // Builder quirk: 1000ms is the "unset" sentinel; nudge if a delay follows.
    if (delay && Math.abs(rule.durationSec! * 1000 - 1000) < 1e-6) durTok = `1000.5ms`;
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

main();
