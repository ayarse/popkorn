import { computePathBounds, roundedRectPath } from "../scene/path-parser.js";
import type { MaskMode, TextAnchor } from "../scene/types.js";
import type { PaintBox } from "./gradient-geometry.js";
import { resolveGradient } from "./gradient-geometry.js";
import type { Renderer } from "./interface.js";
import { PaintStateRenderer } from "./paint-state.js";
import { resolveStrokeDash } from "./stroke.js";
import type {
  CornerRadii,
  GradientData,
  Matrix3x3,
  PathCommand,
  ResolvedClip,
} from "./types.js";
import {
  IDENTITY_MATRIX,
  invertMatrix,
  multiplyMatrices,
  parseColor,
} from "./types.js";

const SVGNS = "http://www.w3.org/2000/svg";

// Per-renderer def-id prefix: url(#id) resolves document-wide, so two SVG players' ids must not collide.
let rendererBuildSeq = 0;

// --- pure helpers (DOM-free; unit-tested headlessly) -------------------------

/** Serialize PathCommand[] to an SVG `d` string. The grammar already IS SVG. */
export function pathToD(commands: PathCommand[]): string {
  let d = "";
  for (const c of commands) {
    switch (c.type) {
      case "M":
        d += `M${c.x} ${c.y}`;
        break;
      case "L":
        d += `L${c.x} ${c.y}`;
        break;
      case "H":
        d += `H${c.x}`;
        break;
      case "V":
        d += `V${c.y}`;
        break;
      case "C":
        d += `C${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.x} ${c.y}`;
        break;
      case "S":
        d += `S${c.x2} ${c.y2} ${c.x} ${c.y}`;
        break;
      case "Q":
        d += `Q${c.x1} ${c.y1} ${c.x} ${c.y}`;
        break;
      case "T":
        d += `T${c.x} ${c.y}`;
        break;
      case "A":
        d += `A${c.rx} ${c.ry} ${c.angle} ${c.largeArc ? 1 : 0} ${c.sweep ? 1 : 0} ${c.x} ${c.y}`;
        break;
      case "Z":
        d += "Z";
        break;
    }
  }
  return d;
}

/** Matrix3x3 [a,b,tx, c,d,ty, …] -> SVG `matrix(a,b,c,d,e,f)` = (m0, m3, m1, m4, m2, m5). */
export function matrixToSVG(m: Matrix3x3): string {
  return `matrix(${m[0]},${m[3]},${m[1]},${m[4]},${m[2]},${m[5]})`;
}

interface GradientRealized {
  tag: "linearGradient" | "radialGradient";
  coords: Record<string, number>;
  stops: { offset: number; color: string; opacity?: number }[];
}

/** GradientData -> userSpaceOnUse gradient attrs; rgba()/hex8 stops split into stop-color + stop-opacity. */
export function realizeGradientAttrs(
  g: GradientData,
  b: PaintBox,
): GradientRealized {
  const resolved = resolveGradient(g, b);
  const stops = resolved.stops.map(({ offset, color }) => {
    // Named/hex6/rgb pass through; only rgba()/hex8 split out an opacity.
    if (
      color.startsWith("rgba") ||
      (color.startsWith("#") && color.length === 9)
    ) {
      const c = parseColor(color);
      return { offset, color: `rgb(${c.r}, ${c.g}, ${c.b})`, opacity: c.a };
    }
    return { offset, color };
  });

  if (resolved.type === "linear") {
    return {
      tag: "linearGradient",
      coords: {
        x1: resolved.x1,
        y1: resolved.y1,
        x2: resolved.x2,
        y2: resolved.y2,
      },
      stops,
    };
  }
  if (resolved.type === "radial") {
    return {
      tag: "radialGradient",
      coords: {
        cx: resolved.cx,
        cy: resolved.cy,
        r: resolved.r,
        fx: resolved.fx,
        fy: resolved.fy,
      },
      stops,
    };
  }
  // Conic is intercepted by applyPaint (conicFallbackColor); guard keeps the union exhaustive.
  throw new Error("SVG has no conic-gradient primitive");
}

// NOTE: SVG has no conic primitive; degrades to a flat fill of the middle stop (pinned divergence).
export function conicFallbackColor(g: GradientData): string {
  if (g.type !== "conic-gradient" || g.stops.length === 0) return "none";
  return g.stops[Math.floor((g.stops.length - 1) / 2)].color;
}

/** Diff-set an attribute against a per-element cache; null removes. */
export function diffAttr(
  el: {
    setAttribute(n: string, v: string): void;
    removeAttribute(n: string): void;
  },
  cache: Map<string, string>,
  name: string,
  value: string | null,
): void {
  const prev = cache.get(name);
  if (value === null) {
    if (prev !== undefined) {
      el.removeAttribute(name);
      cache.delete(name);
    }
  } else if (prev !== value) {
    el.setAttribute(name, value);
    cache.set(name, value);
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- track-matte plumbing (DOM-free; unit-tested headlessly) -----------------

export type MaskFilterPrimitive = "luminanceToAlpha" | "invertAlpha";

/**
 * Track-matte mode -> `mask-type` + optional coverage filter. Inverted modes run the
 * filter over the whole widened region so empty area gets coverage 1 and shows through.
 */
export function maskModePlumbing(mode: MaskMode): {
  maskType: "alpha" | "luminance";
  filter: MaskFilterPrimitive[] | null;
} {
  switch (mode) {
    case "alpha":
      return { maskType: "alpha", filter: null };
    case "luminance":
      return { maskType: "luminance", filter: null };
    case "alpha-invert":
      return { maskType: "alpha", filter: ["invertAlpha"] };
    case "luminance-invert":
      return { maskType: "alpha", filter: ["luminanceToAlpha", "invertAlpha"] };
  }
}

/** Device rect [0,0,w,h] bbox in the user space `inv` maps to; sizes mask/filter regions to cover the surface. */
export function deviceRegionInUserSpace(
  inv: Matrix3x3,
  w: number,
  h: number,
): PaintBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]) {
    const ux = inv[0] * x + inv[1] * y + inv[2];
    const uy = inv[3] * x + inv[4] * y + inv[5];
    if (ux < minX) minX = ux;
    if (uy < minY) minY = uy;
    if (ux > maxX) maxX = ux;
    if (uy > maxY) maxY = uy;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// --- retained group tree -----------------------------------------------------

// One <g> per scene node: its shapes first, then child <g>s, so document order = paint order.
interface GroupEntry {
  key: string;
  g: SVGGElement;
  worldAtOpen: Matrix3x3; // ctm captured at beginNode (= this node's parent world)
  shapes: SVGElement[]; // shape elements by draw slot, reused across frames
  drawCursor: number; // next draw slot this frame
  childKeys: string[]; // child group keys visited this frame (paint order)
  prevChildKeys: string[]; // last frame's, to gate reordering
  clipThisFrame: boolean;
  maskCursor: number; // next compositeMask slot under this group this frame
  filterCursor: number; // next compositeFilter slot under this group this frame
  lastFrame: number;
}

interface DefEntry {
  el: SVGElement;
  lastFrame: number;
}
interface GradEntry extends DefEntry {
  tag: string;
  sig: string;
}
interface ClipEntry extends DefEntry {
  sig: string;
}

// A track-matte: <mask> in defs holding the source `container`, plus an optional inverting `filterEl`.
interface MaskEntry {
  maskEl: SVGElement; // <mask> in defs
  filterG: SVGElement; // <g> child of <mask>; carries the mode filter, holds container
  filterEl: SVGElement | null; // <filter> in defs (inverted modes only)
  container: GroupEntry; // pushed while drawing the mask source
  modeSig: string; // last mode plumbing, to gate primitive rebuilds
  lastFrame: number;
}

/**
 * Retained, diffing SVG backend: one <g> per beginNode key, mark/sweep per frame.
 * Each <g> carries its LOCAL matrix (invert(parentWorld) · ctm) from the CTM mirror.
 */
export class SVGRenderer extends PaintStateRenderer implements Renderer {
  private svg: SVGSVGElement;
  private defs: SVGDefsElement;
  private root: GroupEntry; // persistent base layer (background + scene root nest here)
  private groups = new Map<string, GroupEntry>();
  private gradients = new Map<string, GradEntry>();
  private clips = new Map<string, ClipEntry>();
  private masks = new Map<string, MaskEntry>();
  private attrCache = new WeakMap<Element, Map<string, string>>();
  private textCache = new WeakMap<Element, string>();
  private imageHrefs = new WeakMap<Element, string>();
  private pendingImages = new Set<Promise<void>>();

  private width = 0;
  private height = 0;
  private frame = 0;
  private idp: string; // per-build def-id prefix (see rendererBuildSeq)

  private groupStack: GroupEntry[] = [];

  // Owning-mask key prefix: a source shared by several masks gets an independent <g> tree per mask.
  private keyPrefix = "";

  constructor(svg: SVGSVGElement) {
    super();
    this.svg = svg;
    this.idp = `b${rendererBuildSeq++}_`;
    // Clear a prior renderer's defs/root on the reused <svg>, or stale same-id defs win lookups.
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    this.defs = document.createElementNS(SVGNS, "defs");
    const rootG = document.createElementNS(SVGNS, "g") as SVGGElement;
    svg.appendChild(this.defs);
    svg.appendChild(rootG);
    this.root = {
      key: "__root__",
      g: rootG,
      worldAtOpen: IDENTITY_MATRIX,
      shapes: [],
      drawCursor: 0,
      childKeys: [],
      prevChildKeys: [],
      clipThisFrame: false,
      maskCursor: 0,
      filterCursor: 0,
      lastFrame: 0,
    };
    const wAttr = parseFloat(svg.getAttribute("width") || "0");
    const hAttr = parseFloat(svg.getAttribute("height") || "0");
    this.width = wAttr || 0;
    this.height = hAttr || 0;
  }

  /** Width/height in device px with a matching viewBox, so the DPR scale maps back onto the CSS box. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.svg.setAttribute("width", String(width));
    this.svg.setAttribute("height", String(height));
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  // --- frame lifecycle -------------------------------------------------------

  clear(): void {
    // No-op: retained mode reconciles via the mark/sweep in endFrame.
  }

  beginFrame(): void {
    this.frame++;
    this.resetCtm();
    // Reset the root layer; loose draws (the background) land here.
    this.root.drawCursor = 0;
    this.root.childKeys = [];
    this.root.worldAtOpen = IDENTITY_MATRIX;
    this.root.clipThisFrame = false;
    this.root.maskCursor = 0;
    this.root.filterCursor = 0;
    this.root.lastFrame = this.frame;
    this.groupStack.length = 0;
    this.groupStack.push(this.root);
    this.keyPrefix = "";
  }

  endFrame(): void {
    this.reconcileGroup(this.root);
    // Sweep nodes/defs not visited this frame.
    for (const [key, e] of this.groups) {
      if (e.lastFrame !== this.frame) {
        e.g.remove();
        this.groups.delete(key);
      }
    }
    for (const [id, e] of this.gradients) {
      if (e.lastFrame !== this.frame) {
        e.el.remove();
        this.gradients.delete(id);
      }
    }
    for (const [id, e] of this.clips) {
      if (e.lastFrame !== this.frame) {
        e.el.remove();
        this.clips.delete(id);
      }
    }
    for (const [id, m] of this.masks) {
      if (m.lastFrame !== this.frame) {
        m.maskEl.remove(); // takes filterG + container + source <g>s with it
        if (m.filterEl) m.filterEl.remove();
        this.masks.delete(id);
      }
    }
  }

  // --- retained-node bracket -------------------------------------------------

  beginNode(key: string): void {
    // Flush the parent's <g> transform (ctm is at parent world), then nest.
    this.flushGroupTransform();
    const parent = this.top();
    // Mask namespace (see keyPrefix); def ids derive from this key, so they separate too.
    const fullKey = this.keyPrefix + key;
    parent.childKeys.push(fullKey);

    let e = this.groups.get(fullKey);
    if (!e) {
      const g = document.createElementNS(SVGNS, "g") as SVGGElement;
      parent.g.appendChild(g);
      e = {
        key: fullKey,
        g,
        worldAtOpen: this.ctm,
        shapes: [],
        drawCursor: 0,
        childKeys: [],
        prevChildKeys: [],
        clipThisFrame: false,
        maskCursor: 0,
        filterCursor: 0,
        lastFrame: this.frame,
      };
      this.groups.set(fullKey, e);
    } else if (e.g.parentNode !== parent.g) {
      // Re-home if the node moved under a different parent.
      parent.g.appendChild(e.g);
    }
    e.worldAtOpen = this.ctm;
    e.drawCursor = 0;
    e.childKeys = [];
    e.clipThisFrame = false;
    e.maskCursor = 0;
    e.filterCursor = 0;
    e.lastFrame = this.frame;
    this.groupStack.push(e);
  }

  endNode(): void {
    const e = this.groupStack.pop();
    if (e) this.reconcileGroup(e);
  }

  // --- shapes ----------------------------------------------------------------

  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    rx = 0,
    ry = 0,
    corners?: CornerRadii,
  ): void {
    // NOTE: <rect> rx/ry is uniform-only, so per-corner radii emit a <path> (pinned divergence).
    if (corners) {
      const el = this.allocShape("path");
      this.setAttr(el, "d", pathToD(roundedRectPath(x, y, w, h, corners)));
      this.applyPaint(el, { x, y, width: w, height: h });
      return;
    }
    const el = this.allocShape("rect");
    this.setAttr(el, "x", String(x));
    this.setAttr(el, "y", String(y));
    this.setAttr(el, "width", String(w));
    this.setAttr(el, "height", String(h));
    this.setAttr(el, "rx", rx > 0 ? String(rx) : null);
    this.setAttr(el, "ry", ry > 0 ? String(ry) : null);
    this.applyPaint(el, { x, y, width: w, height: h });
  }

  drawCircle(cx: number, cy: number, r: number): void {
    const el = this.allocShape("circle");
    this.setAttr(el, "cx", String(cx));
    this.setAttr(el, "cy", String(cy));
    this.setAttr(el, "r", String(r));
    this.applyPaint(el, { x: cx - r, y: cy - r, width: r * 2, height: r * 2 });
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number): void {
    const el = this.allocShape("ellipse");
    this.setAttr(el, "cx", String(cx));
    this.setAttr(el, "cy", String(cy));
    this.setAttr(el, "rx", String(rx));
    this.setAttr(el, "ry", String(ry));
    this.applyPaint(el, {
      x: cx - rx,
      y: cy - ry,
      width: rx * 2,
      height: ry * 2,
    });
  }

  drawPath(commands: PathCommand[]): void {
    const el = this.allocShape("path");
    this.setAttr(el, "d", pathToD(commands));
    this.applyPaint(el, computePathBounds(commands));
  }

  drawText(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    fontFamily: string,
    fontWeight: string,
    anchor: TextAnchor,
    letterSpacing = 0,
  ): void {
    const el = this.allocShape("text");
    this.setAttr(el, "x", String(x));
    this.setAttr(el, "y", String(y));
    this.setAttr(el, "font-family", fontFamily);
    this.setAttr(el, "font-size", String(fontSize));
    this.setAttr(el, "font-weight", fontWeight);
    this.setAttr(el, "text-anchor", anchor);
    this.setAttr(
      el,
      "letter-spacing",
      letterSpacing ? String(letterSpacing) : null,
    );
    if (this.textCache.get(el) !== text) {
      el.textContent = text;
      this.textCache.set(el, text);
    }
    // Bounds for gradients are approximate without measureText; ~0.6em advance.
    const width = text.length * fontSize * 0.6;
    const ax =
      anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    this.applyPaint(el, { x: ax, y: y - fontSize, width, height: fontSize });
  }

  drawImage(
    src: string,
    x: number,
    y: number,
    w: number,
    h: number,
    sx?: number,
    sy?: number,
    sw?: number,
    sh?: number,
  ): void {
    if (!src) return;
    this.flushGroupTransform();
    const cropped =
      sx !== undefined &&
      sy !== undefined &&
      sw !== undefined &&
      sh !== undefined;

    if (cropped) {
      // Source crop: nested <svg viewBox=sx sy sw sh> clips to the frame.
      // NOTE: relies on SVG2 intrinsic <image> sizing; SVG 1.1 would need the natural size stamped.
      const outer = this.allocShape("svg");
      this.setAttr(outer, "x", String(x));
      this.setAttr(outer, "y", String(y));
      this.setAttr(outer, "width", w > 0 ? String(w) : null);
      this.setAttr(outer, "height", h > 0 ? String(h) : null);
      this.setAttr(outer, "viewBox", `${sx} ${sy} ${sw} ${sh}`);
      this.setAttr(outer, "preserveAspectRatio", "none");
      let inner = outer.firstElementChild as SVGElement | null;
      if (!inner || inner.tagName !== "image") {
        while (outer.firstChild) outer.removeChild(outer.firstChild);
        inner = document.createElementNS(SVGNS, "image") as SVGElement;
        outer.appendChild(inner);
      }
      this.setAttr(inner, "preserveAspectRatio", "none");
      if (this.imageHrefs.get(inner) !== src) {
        inner.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", src);
        this.setAttr(inner, "href", src);
        this.imageHrefs.set(inner, src);
        this.trackImageLoad(inner);
      }
      this.setAttr(
        outer,
        "opacity",
        this.opacity === 1 ? null : String(this.opacity),
      );
      return;
    }

    const el = this.allocShape("image");
    // Stretch to the box like Canvas drawImage.
    this.setAttr(el, "preserveAspectRatio", "none");
    this.setAttr(el, "x", String(x));
    this.setAttr(el, "y", String(y));
    this.setAttr(el, "width", w > 0 ? String(w) : null);
    this.setAttr(el, "height", h > 0 ? String(h) : null);
    if (this.imageHrefs.get(el) !== src) {
      el.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", src);
      this.setAttr(el, "href", src);
      this.imageHrefs.set(el, src);
      this.trackImageLoad(el);
    }
    this.setAttr(
      el,
      "opacity",
      this.opacity === 1 ? null : String(this.opacity),
    );
  }

  private trackImageLoad(el: Element): void {
    const p = new Promise<void>((resolve) => {
      el.addEventListener("load", () => resolve(), { once: true });
      el.addEventListener("error", () => resolve(), { once: true });
    });
    this.pendingImages.add(p);
    void p.finally(() => this.pendingImages.delete(p));
  }

  whenImagesSettled(): Promise<void> {
    return Promise.all([...this.pendingImages]).then(() => undefined);
  }

  // --- clip ------------------------------------------------------------------

  clip(clip: ResolvedClip): void {
    const top = this.top();
    this.flushGroupTransform();
    this.ensureClip(top.key, clip);
    top.clipThisFrame = true;
  }

  // --- composites: track mattes + CSS filters --------------------------------

  /**
   * <mask> composite: content in an identity wrapper <g mask=url()> under the parent,
   * source in a container inside the <mask>; both based at the parent world `pw`.
   */
  compositeMask(
    mode: MaskMode,
    drawContent: () => void,
    drawMask: () => void,
  ): void {
    // Flush the parent's transform first, or a parent whose only child is this masked node never writes it.
    this.flushGroupTransform();
    const parent = this.top();
    const pw = this.ctm; // parent world = mask base (see class/method docs)
    const idx = parent.maskCursor++;
    const maskId = `${this.idp}mask_${parent.key}_${idx}`;
    const filterId = `${this.idp}mfilter_${parent.key}_${idx}`;
    const wrapperKey = `${parent.key}$mw${idx}`;

    const plumb = maskModePlumbing(mode);
    const region = deviceRegionInUserSpace(
      invertMatrix(pw),
      this.width,
      this.height,
    );
    const m = this.ensureMask(maskId, pw);

    // Mode plumbing, gated on change.
    const modeSig = `${plumb.maskType}|${plumb.filter?.join(",") ?? ""}`;
    if (m.modeSig !== modeSig) {
      if (plumb.maskType === "alpha") {
        m.maskEl.setAttribute("mask-type", "alpha");
        m.maskEl.setAttribute("style", "mask-type:alpha"); // style form too, for engines that ignore the attribute
      } else {
        m.maskEl.removeAttribute("mask-type");
        m.maskEl.removeAttribute("style");
      }
      if (plumb.filter) {
        this.ensureMaskFilter(m, filterId, plumb.filter);
        m.filterG.setAttribute("filter", `url(#${filterId})`);
      } else {
        m.filterG.removeAttribute("filter");
        if (m.filterEl) {
          m.filterEl.remove();
          m.filterEl = null;
        }
      }
      m.modeSig = modeSig;
    }
    // Region every frame (parent transform animates); cheap, few attrs.
    this.setRegion(m.maskEl, region);
    if (m.filterEl) this.setRegion(m.filterEl, region);
    m.lastFrame = this.frame;

    this.save();

    // Content -> wrapper <g mask=url(#maskId)>, standing in for the node in paint order.
    const wrapper = this.ensureSynthetic(wrapperKey, parent.g, pw);
    parent.childKeys.push(wrapperKey);
    this.setAttr(wrapper.g, "mask", `url(#${maskId})`);
    this.groupStack.push(wrapper);
    drawContent();
    this.groupStack.pop();
    this.reconcileGroup(wrapper);

    // Source -> <mask> container, keys namespaced by this mask (stacks for nested mattes).
    const c = m.container;
    c.worldAtOpen = pw;
    c.drawCursor = 0;
    c.childKeys = [];
    c.clipThisFrame = false;
    c.maskCursor = 0;
    c.filterCursor = 0;
    c.lastFrame = this.frame;
    this.groupStack.push(c);
    const savedPrefix = this.keyPrefix;
    this.keyPrefix = `${savedPrefix + maskId}$`;
    drawMask();
    this.keyPrefix = savedPrefix;
    this.groupStack.pop();
    this.reconcileGroup(c);

    this.restore();
  }

  supportsFilter(): boolean {
    return typeof document !== "undefined";
  }

  // The filter applies on a group in parent user space, so the CTM supplies the parent scale.
  filtersUseUserSpace(): boolean {
    return true;
  }

  /** CSS filter on an identity wrapper <g> outside any mask wrapper; the parent CTM scales the lengths. */
  compositeFilter(filter: string, drawContent: () => void): void {
    // Flush the parent's transform first (see compositeMask).
    this.flushGroupTransform();
    const parent = this.top();
    const pw = this.ctm;
    const idx = parent.filterCursor++;
    const wrapperKey = `${parent.key}$fw${idx}`;

    this.save();
    const wrapper = this.ensureSynthetic(wrapperKey, parent.g, pw);
    parent.childKeys.push(wrapperKey);
    // Filter functions go in style; the `filter` attribute only takes url().
    this.setAttr(wrapper.g, "style", filter ? `filter: ${filter}` : null);
    this.groupStack.push(wrapper);
    drawContent();
    this.groupStack.pop();
    this.reconcileGroup(wrapper);
    this.restore();
  }

  // --- transform stack (CTM mirror) ------------------------------------------

  save(): void {
    this.pushCtm();
  }
  restore(): void {
    this.popCtm();
  }
  transform(m: Matrix3x3): void {
    this.concatCtm(m);
  }
  setTransform(m: Matrix3x3): void {
    this.ctm = m;
  }

  getWidth(): number {
    return this.width;
  }
  getHeight(): number {
    return this.height;
  }

  // --- internals -------------------------------------------------------------

  private top(): GroupEntry {
    return this.groupStack[this.groupStack.length - 1];
  }

  private setAttr(el: Element, name: string, value: string | null): void {
    let c = this.attrCache.get(el);
    if (!c) {
      c = new Map();
      this.attrCache.set(el, c);
    }
    diffAttr(el, c, name, value);
  }

  /** Diff-set the current <g> transform to its local matrix. */
  private flushGroupTransform(): void {
    const top = this.top();
    const local = multiplyMatrices(invertMatrix(top.worldAtOpen), this.ctm);
    this.setAttr(top.g, "transform", matrixToSVG(local));
  }

  private allocShape(tag: string): SVGElement {
    const top = this.top();
    this.flushGroupTransform();
    const i = top.drawCursor++;
    const existing = top.shapes[i];
    if (existing && existing.tagName === tag) return existing;
    const el = document.createElementNS(SVGNS, tag) as SVGElement;
    if (existing) {
      top.g.replaceChild(el, existing);
      this.attrCache.delete(existing);
    } else {
      // Keep shapes before child <g>s so document order = paint order.
      top.g.insertBefore(el, this.firstGroupChild(top.g));
    }
    top.shapes[i] = el;
    return el;
  }

  private firstGroupChild(g: Element): ChildNode | null {
    for (let n = g.firstChild; n; n = n.nextSibling) {
      if ((n as Element).tagName === "g") return n;
    }
    return null;
  }

  private applyPaint(el: SVGElement, bounds: PaintBox): void {
    const top = this.top();

    if (this.fillGradient && this.fillGradient.type === "conic-gradient") {
      // NOTE: no SVG conic primitive (pinned divergence).
      this.setAttr(el, "fill", conicFallbackColor(this.fillGradient));
    } else if (this.fillGradient) {
      const id = `${this.idp}g_${top.key}_${top.drawCursor - 1}_fill`;
      this.ensureGradient(id, this.fillGradient, bounds);
      this.setAttr(el, "fill", `url(#${id})`);
    } else {
      this.setAttr(el, "fill", this.fillColor ?? "none");
    }
    this.setAttr(el, "fill-rule", this.fillRule);

    // Stroke: trim/dash via the shared resolver.
    const dashDecision = resolveStrokeDash(
      this.trim,
      this.dashArray,
      this.dashOffset,
    );
    let stroke: string | null;
    if (!dashDecision.stroke) {
      stroke = "none";
    } else if (this.strokeGradient?.type === "conic-gradient") {
      stroke = conicFallbackColor(this.strokeGradient); // pinned divergence
    } else if (this.strokeGradient) {
      const id = `${this.idp}g_${top.key}_${top.drawCursor - 1}_stroke`;
      this.ensureGradient(id, this.strokeGradient, bounds);
      stroke = `url(#${id})`;
    } else {
      stroke = this.strokeColor ?? "none";
    }
    this.setAttr(el, "stroke", stroke);

    if (stroke !== "none") {
      this.setAttr(el, "stroke-width", String(this.strokeWidth));
      this.setAttr(el, "stroke-linecap", this.lineCap);
      this.setAttr(el, "stroke-linejoin", this.lineJoin);
      this.setAttr(el, "stroke-miterlimit", String(this.miterLimit));

      const dash = dashDecision.dashArray;
      const dashOff = dashDecision.dashOffset;
      this.setAttr(
        el,
        "stroke-dasharray",
        dash.length > 0 ? dash.join(" ") : null,
      );
      this.setAttr(
        el,
        "stroke-dashoffset",
        dashOff !== 0 ? String(dashOff) : null,
      );
    } else {
      this.setAttr(el, "stroke-width", null);
      this.setAttr(el, "stroke-dasharray", null);
      this.setAttr(el, "stroke-dashoffset", null);
    }

    this.setAttr(
      el,
      "paint-order",
      this.paintOrder === "stroke" ? "stroke" : null,
    );
    // The loop folds group opacity into per-leaf alpha; set it on the leaf, never the <g>.
    this.setAttr(
      el,
      "opacity",
      this.opacity === 1 ? null : String(this.opacity),
    );
    // mix-blend-mode has no presentation attr; 'normal' clears it.
    this.setAttr(
      el,
      "style",
      this.blendMode === "normal" ? null : `mix-blend-mode:${this.blendMode}`,
    );
  }

  private ensureGradient(id: string, g: GradientData, bounds: PaintBox): void {
    const r = realizeGradientAttrs(g, bounds);
    const sig = JSON.stringify(r);
    let e = this.gradients.get(id);
    if (e && e.tag !== r.tag) {
      e.el.remove();
      this.gradients.delete(id);
      e = undefined;
    }
    if (!e) {
      const el = document.createElementNS(SVGNS, r.tag) as SVGElement;
      el.setAttribute("id", id);
      el.setAttribute("gradientUnits", "userSpaceOnUse");
      this.defs.appendChild(el);
      e = { el, tag: r.tag, sig: "", lastFrame: this.frame };
      this.gradients.set(id, e);
    }
    if (e.sig !== sig) {
      for (const [k, v] of Object.entries(r.coords))
        e.el.setAttribute(k, String(v));
      while (e.el.firstChild) e.el.removeChild(e.el.firstChild);
      for (const s of r.stops) {
        const stop = document.createElementNS(SVGNS, "stop");
        stop.setAttribute("offset", String(s.offset));
        stop.setAttribute("stop-color", s.color);
        if (s.opacity !== undefined && s.opacity < 1)
          stop.setAttribute("stop-opacity", String(s.opacity));
        e.el.appendChild(stop);
      }
      e.sig = sig;
    }
    e.lastFrame = this.frame;
  }

  private ensureClip(key: string, clip: ResolvedClip): void {
    const id = `${this.idp}clip_${key}`;
    let e = this.clips.get(id);
    if (!e) {
      const el = document.createElementNS(SVGNS, "clipPath") as SVGElement;
      el.setAttribute("id", id);
      el.setAttribute("clipPathUnits", "userSpaceOnUse");
      this.defs.appendChild(el);
      e = { el, sig: "", lastFrame: this.frame };
      this.clips.set(id, e);
    }
    const sig = JSON.stringify(clip) + "|" + this.fillRule;
    if (e.sig !== sig) {
      while (e.el.firstChild) e.el.removeChild(e.el.firstChild);
      let shape: SVGElement;
      if (clip.type === "rect") {
        shape = document.createElementNS(SVGNS, "rect");
        shape.setAttribute("x", String(clip.x));
        shape.setAttribute("y", String(clip.y));
        shape.setAttribute("width", String(clip.width));
        shape.setAttribute("height", String(clip.height));
      } else if (clip.type === "circle") {
        shape = document.createElementNS(SVGNS, "circle");
        shape.setAttribute("cx", String(clip.cx));
        shape.setAttribute("cy", String(clip.cy));
        shape.setAttribute("r", String(clip.r));
      } else {
        shape = document.createElementNS(SVGNS, "path");
        shape.setAttribute("d", pathToD(clip.commands));
      }
      if (this.fillRule === "evenodd")
        shape.setAttribute("clip-rule", "evenodd");
      e.el.appendChild(shape);
      e.sig = sig;
    }
    e.lastFrame = this.frame;
  }

  /** Get-or-create a matte's <mask>; `pw` is the referencing element's user space. */
  private ensureMask(id: string, pw: Matrix3x3): MaskEntry {
    let m = this.masks.get(id);
    if (!m) {
      const maskEl = document.createElementNS(SVGNS, "mask") as SVGElement;
      maskEl.setAttribute("id", id);
      maskEl.setAttribute("maskUnits", "userSpaceOnUse");
      maskEl.setAttribute("maskContentUnits", "userSpaceOnUse");
      const filterG = document.createElementNS(SVGNS, "g") as SVGElement;
      maskEl.appendChild(filterG);
      this.defs.appendChild(maskEl);
      const containerG = document.createElementNS(SVGNS, "g") as SVGGElement;
      filterG.appendChild(containerG);
      const container: GroupEntry = {
        key: `${id}$c`,
        g: containerG,
        worldAtOpen: pw,
        shapes: [],
        drawCursor: 0,
        childKeys: [],
        prevChildKeys: [],
        clipThisFrame: false,
        maskCursor: 0,
        filterCursor: 0,
        lastFrame: this.frame,
      };
      m = {
        maskEl,
        filterG,
        filterEl: null,
        container,
        modeSig: "",
        lastFrame: this.frame,
      };
      this.masks.set(id, m);
    }
    return m;
  }

  /** Build the inverting filter, in sRGB so luminanceToAlpha matches canvas2d's luma. */
  private ensureMaskFilter(
    m: MaskEntry,
    filterId: string,
    prims: MaskFilterPrimitive[],
  ): void {
    let f = m.filterEl;
    if (!f) {
      f = document.createElementNS(SVGNS, "filter") as SVGElement;
      f.setAttribute("id", filterId);
      f.setAttribute("filterUnits", "userSpaceOnUse");
      f.setAttribute("color-interpolation-filters", "sRGB");
      this.defs.appendChild(f);
      m.filterEl = f;
    }
    while (f.firstChild) f.removeChild(f.firstChild);
    for (const p of prims) {
      if (p === "luminanceToAlpha") {
        const fe = document.createElementNS(SVGNS, "feColorMatrix");
        fe.setAttribute("type", "luminanceToAlpha");
        f.appendChild(fe);
      } else {
        const ct = document.createElementNS(SVGNS, "feComponentTransfer");
        const fa = document.createElementNS(SVGNS, "feFuncA");
        fa.setAttribute("type", "table");
        fa.setAttribute("tableValues", "1 0");
        ct.appendChild(fa);
        f.appendChild(ct);
      }
    }
  }

  private setRegion(el: SVGElement, r: PaintBox): void {
    el.setAttribute("x", String(r.x));
    el.setAttribute("y", String(r.y));
    el.setAttribute("width", String(r.width));
    el.setAttribute("height", String(r.height));
  }

  /** Get-or-create a mask/filter wrapper <g>, swept and reordered like a node group. */
  private ensureSynthetic(
    key: string,
    parentG: SVGGElement,
    worldAtOpen: Matrix3x3,
  ): GroupEntry {
    let e = this.groups.get(key);
    if (!e) {
      const g = document.createElementNS(SVGNS, "g") as SVGGElement;
      parentG.appendChild(g);
      e = {
        key,
        g,
        worldAtOpen,
        shapes: [],
        drawCursor: 0,
        childKeys: [],
        prevChildKeys: [],
        clipThisFrame: false,
        maskCursor: 0,
        filterCursor: 0,
        lastFrame: this.frame,
      };
      this.groups.set(key, e);
    } else if (e.g.parentNode !== parentG) {
      parentG.appendChild(e.g);
    }
    e.worldAtOpen = worldAtOpen;
    e.drawCursor = 0;
    e.childKeys = [];
    e.clipThisFrame = false;
    e.maskCursor = 0;
    e.filterCursor = 0;
    e.lastFrame = this.frame;
    return e;
  }

  /** Trim stale shapes, reconcile clip-path, reorder child <g>s when the key sequence changed. */
  private reconcileGroup(e: GroupEntry): void {
    this.setAttr(
      e.g,
      "clip-path",
      e.clipThisFrame ? `url(#${this.idp}clip_${e.key})` : null,
    );

    for (let i = e.shapes.length - 1; i >= e.drawCursor; i--) {
      const el = e.shapes[i];
      if (el) {
        el.remove();
        this.attrCache.delete(el);
      }
      e.shapes.pop();
    }

    if (!arraysEqual(e.childKeys, e.prevChildKeys)) {
      for (const k of e.childKeys) {
        const c = this.groups.get(k);
        if (c) e.g.appendChild(c.g); // moves after shapes → correct paint order
      }
      e.prevChildKeys = e.childKeys.slice();
    }
  }
}
