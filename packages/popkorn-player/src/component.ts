import { parse } from "@popkorn/parser";
import { Canvas2DRenderer } from "./renderer/canvas2d.js";
import { SVGRenderer } from "./renderer/svg.js";
import { type ClickDetail, RenderLoop } from "./runtime/loop.js";
import {
  computeViewport,
  type FitMode,
  viewportMatrix,
} from "./runtime/viewport.js";
import { buildSceneGraph } from "./scene/builder.js";
import type {
  AnimatableValue,
  AnimationDirection,
  AnimationFillMode,
  AnimationInstance,
  SceneNode,
  TimingFunction,
  Transform,
} from "./scene/types.js";

/** One keyframe stop for the timeline UI; `easing` is the transition FROM here. */
export interface TimelineKeyframe {
  offset: number; // 0..1
  value: string;
  easing?: TimingFunction;
}

export interface TimelineAnimationProperty {
  property: string;
  keyframes: TimelineKeyframe[];
}

export interface TimelineAnimation {
  name: string;
  delay: number; // ms (may be negative)
  duration: number; // ms
  iterationCount: number; // Infinity for infinite
  timingFunction: TimingFunction; // animation-level easing (plain union, as-is)
  direction: AnimationDirection;
  fillMode: AnimationFillMode;
  // Declaring rule's selector (e.g. `#btn:state(door.open)`); round-trips into retimeAnimation.
  ruleSelector: string;
  // `machine` is null for an un-namespaced `:state(name)`.
  state?: { machine: string | null; state: string };
  properties: TimelineAnimationProperty[];
}

export interface TimelineTrack {
  nodeName: string;
  animations: TimelineAnimation[];
}

function nodeLabel(node: SceneNode): string {
  if (node.className) return `.${node.className}`;
  return node.id === "root" ? "root" : `#${node.id}`;
}

/** Integers as-is, else ≤3 decimals. */
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/** Non-default Transform channels, e.g. `x 20, rot 45°`; all defaults read `none`. */
function formatTransform(t: Transform): string {
  const parts: string[] = [];
  if (t.translateX) parts.push(`x ${formatNumber(t.translateX)}`);
  if (t.translateY) parts.push(`y ${formatNumber(t.translateY)}`);
  if (t.rotate) parts.push(`rot ${formatNumber(t.rotate)}°`);
  if (t.scaleX !== 1 || t.scaleY !== 1)
    parts.push(
      t.scaleX === t.scaleY
        ? `scale ${formatNumber(t.scaleX)}`
        : `scale ${formatNumber(t.scaleX)},${formatNumber(t.scaleY)}`,
    );
  if (t.skewX) parts.push(`skewX ${formatNumber(t.skewX)}°`);
  if (t.skewY) parts.push(`skewY ${formatNumber(t.skewY)}°`);
  return parts.length ? parts.join(", ") : "none";
}

export function formatAnimatableValue(v: AnimatableValue): string {
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const first = v[0] as { type?: string } | undefined;
    return first && /^[A-Za-z]$/.test(first.type ?? "") ? "path" : "filter";
  }
  // GradientData (`type` ends in `-gradient`) or a Transform (no `type`).
  if ("type" in v && typeof v.type === "string" && v.type.endsWith("gradient"))
    return "gradient";
  return formatTransform(v as Transform);
}

function toTimelineAnimation(
  a: AnimationInstance,
  ruleSelector: string,
  state?: { machine: string | null; state: string },
): TimelineAnimation {
  const anim: TimelineAnimation = {
    name: a.name,
    delay: a.delay,
    duration: a.duration,
    // Infinity stays; callers cap it at scene duration.
    iterationCount: a.iterationCount,
    timingFunction: a.timingFunction,
    direction: a.direction,
    fillMode: a.fillMode,
    ruleSelector,
    properties: a.tracks.map((track) => ({
      property: track.property,
      keyframes: track.stops.map((s) => {
        const stop: TimelineKeyframe = {
          offset: s.offset,
          value: formatAnimatableValue(s.value),
        };
        if (s.easing !== undefined) stop.easing = s.easing;
        return stop;
      }),
    })),
  };
  if (state) anim.state = state;
  return anim;
}

// Inert stub base class when there's no DOM (RN, bun tests) so the barrel import stays headless-safe.
const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

// <popkorn-player src="scene.css" loop controls fit="contain">; set `.source` for inline DSL text.
export class PopkornPlayer extends HTMLElementBase {
  private canvas: HTMLCanvasElement;
  // Created lazily when renderer="svg".
  private svg: SVGSVGElement | null = null;
  // Not named `renderer`: a same-named field would swallow React's `el.renderer = 'svg'` prop write.
  private backend: Canvas2DRenderer | SVGRenderer | null = null;
  private useSvg = false;
  private renderLoop: RenderLoop | null = null;
  private _source: string = "";
  // Bumped per load request; a fetch resolving with a stale token is dropped.
  private _loadToken = 0;

  // From `:root`, falling back to width/height attrs.
  private sceneWidth: number = 400;
  private sceneHeight: number = 300;

  private resizeObserver: ResizeObserver | null = null;
  private _resizeRaf: number | null = null;
  private _lastSize: { bw: number; bh: number; dpr: number } | null = null;

  private controlsEl: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private scrub: HTMLInputElement;
  private timeEl: HTMLSpanElement;
  private scrubbing = false;
  private wasPlaying = false;
  // Last cursor written, so the DOM is touched only on change.
  private _lastCursor = "";

  static get observedAttributes() {
    return [
      "src",
      "width",
      "height",
      "background",
      "loop",
      "controls",
      "fit",
      "autoplay",
      "renderer",
    ];
  }

  constructor() {
    super();

    const shadow = this.attachShadow({ mode: "open" });

    this.canvas = document.createElement("canvas");

    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: block;
        position: relative;
        width: var(--pc-width, 400px);
        aspect-ratio: var(--pc-aspect, 4 / 3);
        max-width: 100%;
      }
      canvas, svg {
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        /* Fill the host, but reserve the controls bar's height at the bottom so
           the scene renders above it rather than under it (var is 0 when the
           controls are hidden). An explicit height is required: <canvas>/<svg>
           are replaced elements, so top/bottom insets don't stretch them —
           height:auto would fall back to the intrinsic backing-store size. */
        height: calc(100% - var(--pc-controls-h, 0px));
      }
      .pc-controls {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 32px;
        box-sizing: border-box;
        display: none;
        align-items: center;
        gap: 8px;
        padding: 0 10px;
        background: rgba(0, 0, 0, 0.55);
        font: 12px system-ui, -apple-system, sans-serif;
        color: #fff;
        user-select: none;
      }
      .pc-controls button {
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        padding: 0;
        width: 18px;
      }
      .pc-controls input[type="range"] {
        flex: 1;
        min-width: 40px;
        accent-color: #4ecdc4;
        cursor: pointer;
      }
      .pc-time {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
    `;

    this.controlsEl = document.createElement("div");
    this.controlsEl.className = "pc-controls";

    this.playBtn = document.createElement("button");
    this.playBtn.type = "button";
    this.playBtn.textContent = "❚❚";
    this.playBtn.addEventListener("click", () => this.togglePlay());

    this.scrub = document.createElement("input");
    this.scrub.type = "range";
    this.scrub.min = "0";
    this.scrub.max = "0";
    this.scrub.step = "1";
    this.scrub.value = "0";
    this.scrub.addEventListener("input", () => this.onScrubInput());
    this.scrub.addEventListener("change", () => this.onScrubChange());

    this.timeEl = document.createElement("span");
    this.timeEl.className = "pc-time";
    this.timeEl.textContent = "0:00.0 / 0:00.0";

    this.controlsEl.append(this.playBtn, this.scrub, this.timeEl);

    shadow.append(style, this.canvas, this.controlsEl);
  }

  connectedCallback() {
    if (typeof ResizeObserver !== "undefined") {
      // Coalesce resize bursts (splitter drags) into one realloc + repaint per frame.
      this.resizeObserver = new ResizeObserver(() => {
        if (this._resizeRaf !== null) return;
        this._resizeRaf = requestAnimationFrame(() => {
          this._resizeRaf = null;
          this.syncSize();
        });
      });
      this.resizeObserver.observe(this);
    }

    if (this._source) {
      this.initializePlayer();
    }
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this._resizeRaf !== null) {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = null;
    }
    this.renderLoop?.getInputTracker().detach();
    this.stop();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ) {
    // Skip no-op attribute writes: a rebuild would discard machine and interaction state.
    if (oldValue === newValue) return;
    switch (name) {
      case "src":
        if (newValue !== null) {
          this.loadFromUrl(newValue);
        }
        break;
      case "width":
      case "height":
        // Fallback scene size (no :root stage config); re-fit.
        this.syncSize();
        break;
      case "background":
        if (this.renderLoop) {
          this.renderLoop.setBackgroundColor(newValue);
        }
        break;
      case "loop":
        this.renderLoop?.setLoop(this.boolAttr("loop"));
        break;
      case "controls":
        this.refreshControls();
        break;
      case "fit":
        this.syncSize();
        break;
      case "renderer": {
        // Backend swap re-inits, restoring timeline position and play state.
        if (!this.renderLoop) break; // not initialized yet; init will read it
        const t = this.currentTime;
        const wasPaused = this.paused;
        void this.initializePlayer().then(() => {
          this.seek(t);
          if (wasPaused) this.pause();
        });
        break;
      }
      // `autoplay` only affects the initial start.
    }
  }

  /** `"canvas"` (default) or `"svg"`; reflected so React's property writes take effect. */
  get renderer(): string | null {
    return this.getAttribute("renderer");
  }

  set renderer(value: string | null) {
    if (value === null) this.removeAttribute("renderer");
    else this.setAttribute("renderer", value);
  }

  get source(): string {
    return this._source;
  }

  set source(value: string) {
    this._loadToken++; // supersede any in-flight src fetch
    this._source = value;
    if (this.isConnected) {
      this.initializePlayer();
    }
  }

  /** Any URL `fetch()` understands; for inline DSL text set `.source`. */
  get src(): string | null {
    return this.getAttribute("src");
  }

  set src(value: string | null) {
    if (value === null) this.removeAttribute("src");
    else this.setAttribute("src", value);
  }

  private async loadFromUrl(url: string): Promise<void> {
    const token = ++this._loadToken;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
      const text = await res.text();
      if (token !== this._loadToken) return; // superseded by a newer load
      this._source = text;
      if (this.isConnected) this.initializePlayer();
    } catch (error) {
      if (token !== this._loadToken) return;
      console.error("PopkornPlayer: Failed to load src", error);
      this.dispatchEvent(
        new CustomEvent("popkorn:error", { detail: { error } }),
      );
    }
  }

  get width(): number {
    return this.canvas.width;
  }

  set width(value: number) {
    this.setAttribute("width", String(value));
  }

  get height(): number {
    return this.canvas.height;
  }

  set height(value: number) {
    this.setAttribute("height", String(value));
  }

  get background(): string | null {
    return this.getAttribute("background");
  }

  set background(value: string | null) {
    if (value) {
      this.setAttribute("background", value);
    } else {
      this.removeAttribute("background");
    }
  }

  get loop(): boolean {
    return this.boolAttr("loop");
  }

  set loop(value: boolean) {
    if (value) this.setAttribute("loop", "");
    else this.removeAttribute("loop");
  }

  get controls(): boolean {
    return this.boolAttr("controls");
  }

  set controls(value: boolean) {
    if (value) this.setAttribute("controls", "");
    else this.removeAttribute("controls");
  }

  /** Default TRUE, unlike HTML media: only `autoplay="false"` disables it. */
  get autoplay(): boolean {
    return this.getAttribute("autoplay") !== "false";
  }

  set autoplay(value: boolean) {
    this.setAttribute("autoplay", value ? "true" : "false");
  }

  /** contain | cover | fill | none */
  get fit(): FitMode {
    const v = this.getAttribute("fit");
    return v === "cover" || v === "fill" || v === "none" ? v : "contain";
  }

  set fit(value: FitMode) {
    this.setAttribute("fit", value);
  }

  play(): void {
    if (this.renderLoop) {
      this.renderLoop.start();
    }
  }

  stop(): void {
    if (this.renderLoop) {
      this.renderLoop.stop();
    }
  }

  reset(): void {
    if (this.renderLoop) {
      this.renderLoop.reset();
    }
  }

  /** Freeze the timeline (interaction stays live). */
  pause(): void {
    this.renderLoop?.pause();
  }

  resume(): void {
    this.renderLoop?.resume();
  }

  /** Jump to `ms` and render it, even while paused. */
  seek(ms: number): void {
    this.renderLoop?.seek(ms);
  }

  // --- Host variable API: sets before load are replayed on init; fire/get no-op until loaded ---
  private pendingVariables: Map<string, number | boolean | string> = new Map();

  /** Numbers/booleans feed bindings and machine inputs; a string is a paint color. */
  setVariable(name: string, value: number | boolean | string): void {
    const resolver = this.renderLoop?.getVariableResolver();
    if (resolver) {
      resolver.setVariable(name, value);
      this.renderLoop?.redraw();
    } else {
      this.pendingVariables.set(name, value);
    }
  }

  getVariable(name: string): number | boolean | string | undefined {
    return this.renderLoop?.getVariableResolver().getVariable(name);
  }

  /** A `trigger` variable fires for one frame; any other name is a machine `on event(name)`. */
  fire(name: string): void {
    if (!this.renderLoop) return;
    const resolver = this.renderLoop.getVariableResolver();
    if (resolver.getVariable(name) !== undefined) {
      resolver.fire(name);
    } else {
      this.renderLoop.enqueueMachineEvent(name);
    }
  }

  get currentTime(): number {
    return this.renderLoop?.currentTime ?? 0;
  }

  /** 0 when the scene has no animations. */
  get duration(): number {
    return this.renderLoop?.duration ?? 0;
  }

  get paused(): boolean {
    return this.renderLoop?.paused ?? true;
  }

  /** Serializable per-node animation snapshot for an external timeline UI. */
  getTimelineTracks(): TimelineTrack[] {
    const root = this.renderLoop?.getScene();
    if (!root) return [];
    const tracks: TimelineTrack[] = [];

    const walk = (node: SceneNode): void => {
      const label = nodeLabel(node);
      const animations: TimelineAnimation[] = [];
      for (const a of node.animations)
        animations.push(toTimelineAnimation(a, label));
      // Machine `:state()`-scoped animations, tagged with state and selector.
      for (const ss of node.stateStyles) {
        const scoped = ss.machine ? `${ss.machine}.${ss.name}` : ss.name;
        const selector = `${label}:state(${scoped})`;
        for (const a of ss.animations)
          animations.push(
            toTimelineAnimation(a, selector, {
              machine: ss.machine,
              state: ss.name,
            }),
          );
      }
      if (animations.length > 0) tracks.push({ nodeName: label, animations });
      for (const child of node.children) walk(child);
    };

    walk(root);
    return tracks;
  }

  /** Each machine's current state and entry time (ms); refresh on `statechange`. */
  getMachineStates(): { machine: string; state: string; entryTime: number }[] {
    return this.renderLoop?.getStateMachineRunner().snapshot() ?? [];
  }

  private boolAttr(name: string): boolean {
    const v = this.getAttribute(name);
    return v !== null && v !== "false";
  }

  private async initializePlayer(): Promise<void> {
    this.stop();
    this.renderLoop?.getInputTracker().detach();

    if (!this._source) {
      return;
    }

    try {
      const ast = parse(this._source);

      this.sceneWidth =
        ast.canvas?.width ?? parseInt(this.getAttribute("width") || "400", 10);
      this.sceneHeight =
        ast.canvas?.height ??
        parseInt(this.getAttribute("height") || "300", 10);

      // Default host size = scene aspect (overridable by the parent's CSS).
      this.style.setProperty("--pc-width", `${this.sceneWidth}px`);
      this.style.setProperty(
        "--pc-aspect",
        `${this.sceneWidth} / ${this.sceneHeight}`,
      );

      const sceneRoot = buildSceneGraph(ast);

      // The fit/DPR viewport folds into loop transforms, so both backends share it.
      this.useSvg = this.getAttribute("renderer") === "svg";
      const surface = this.useSvg ? this.ensureSvg() : this.canvas;
      this.canvas.style.display = this.useSvg ? "none" : "block";
      if (this.svg) this.svg.style.display = this.useSvg ? "block" : "none";
      this.backend = this.useSvg
        ? new SVGRenderer(this.svg!)
        : new Canvas2DRenderer(this.canvas);
      this._lastSize = null;
      this.renderLoop = new RenderLoop(this.backend);
      this.renderLoop.setScene(sceneRoot);
      this.renderLoop.setSceneSize(this.sceneWidth, this.sceneHeight);
      // Artboard clipping on by default; `:root { overflow: visible }` opts out.
      this.renderLoop.setClip(ast.canvas?.overflow !== "visible");
      this.renderLoop.setLoop(this.boolAttr("loop"));
      this.renderLoop.setFrameCallback((t) => this.onFrame(t));
      // Non-looping end -> `complete` once; looping/machine scenes never fire it.
      this.renderLoop.setCompleteCallback(() => {
        this.dispatchEvent(new CustomEvent("popkorn:complete"));
      });
      this.renderLoop.setMachineEventCallback((o) => {
        if (o.type === "statechange") {
          this.dispatchEvent(
            new CustomEvent("popkorn:statechange", {
              detail: { machine: o.machine, from: o.from, to: o.to },
            }),
          );
        } else {
          this.dispatchEvent(
            new CustomEvent("popkorn:machine-event", {
              detail: { machine: o.machine, name: o.name },
            }),
          );
        }
      });
      // Click = press+release on the same node; fires with or without machines.
      this.renderLoop.setClickCallback((detail: ClickDetail) => {
        this.dispatchEvent(new CustomEvent("popkorn:click", { detail }));
      });

      // Explicit attr wins, else the authored `:root` background.
      const bg =
        this.getAttribute("background") ?? ast.canvas?.background ?? null;
      if (bg) {
        this.renderLoop.setBackgroundColor(bg);
      }

      const variableResolver = this.renderLoop.getVariableResolver();
      variableResolver.setVariables(ast.variables);

      // Replay setVariable() calls made before load.
      for (const [name, value] of this.pendingVariables) {
        variableResolver.setVariable(name, value);
      }
      this.pendingVariables.clear();

      const inputTracker = this.renderLoop.getInputTracker();
      inputTracker.attach(surface as HTMLCanvasElement);

      this.syncSize();

      // Autoplay off: the loop still runs for interaction, timeline frozen at 0.
      this.renderLoop.start();
      if (!this.autoplay) {
        this.renderLoop.pause();
      }

      this.refreshControls();

      this.dispatchEvent(
        new CustomEvent("popkorn:ready", {
          detail: { sceneRoot, duration: this.duration },
        }),
      );
    } catch (error) {
      console.error("PopkornPlayer: Failed to initialize", error);
      this.dispatchEvent(
        new CustomEvent("popkorn:error", { detail: { error } }),
      );
    }
  }

  private ensureSvg(): SVGSVGElement {
    if (!this.svg) {
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      // Before the controls overlay so the overlay stays on top.
      this.shadowRoot!.insertBefore(this.svg, this.controlsEl);
    }
    return this.svg;
  }

  /** Backing store = surface size × DPR; recomputes the fit viewport shared with input mapping. */
  private syncSize(): void {
    if (!this.renderLoop) return;

    // Measure the surface (inset above the controls bar), not the host.
    const surface: Element = this.useSvg && this.svg ? this.svg : this.canvas;
    const rect = surface.getBoundingClientRect();
    const elemW = rect.width || this.sceneWidth;
    const elemH = rect.height || this.sceneHeight;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;

    const bw = Math.max(1, Math.round(elemW * dpr));
    const bh = Math.max(1, Math.round(elemH * dpr));
    // Observer fires without a real size change; skip the realloc + repaint.
    const last = this._lastSize;
    if (last && last.bw === bw && last.bh === bh && last.dpr === dpr) return;
    this._lastSize = { bw, bh, dpr };
    this.backend?.resize(bw, bh);

    const vp = computeViewport(
      this.sceneWidth,
      this.sceneHeight,
      elemW,
      elemH,
      dpr,
      this.fit,
    );
    this.renderLoop.setViewport(viewportMatrix(vp));
    this.renderLoop.getInputTracker().setViewport(vp, dpr);

    // Paused/stopped: force a repaint; running loops repaint next frame.
    if (!this.renderLoop.running) this.renderLoop.redraw();
  }

  // --- Controls ---

  private togglePlay(): void {
    if (!this.renderLoop) return;
    if (this.renderLoop.paused) this.resume();
    else this.pause();
    this.playBtn.textContent = this.paused ? "▶" : "❚❚";
  }

  private onScrubInput(): void {
    if (!this.scrubbing) {
      this.wasPlaying = !this.paused;
      this.scrubbing = true;
    }
    this.pause();
    const t = Number(this.scrub.value);
    this.seek(t);
    this.timeEl.textContent = `${formatTime(t)} / ${formatTime(this.duration)}`;
  }

  private onScrubChange(): void {
    this.scrubbing = false;
    if (this.wasPlaying) this.resume();
    this.playBtn.textContent = this.paused ? "▶" : "❚❚";
  }

  /** Per-frame tick: advances the scrubber + readout unless dragging. */
  private onFrame(t: number): void {
    // Fires every frame even with controls hidden (drives external timelines).
    const d = this.duration;
    this.dispatchEvent(
      new CustomEvent("popkorn:timeupdate", {
        detail: { time: d > 0 ? Math.min(t, d) : 0, duration: d },
      }),
    );
    // Mirror the hovered node's `cursor: pointer`; hover is already resolved by the interaction manager.
    this.syncCursor();
    if (!this.boolAttr("controls")) return;
    if (!this.scrubbing) {
      const d = this.duration;
      const finite = isFinite(d);
      // Animation-less scenes (d = 0) free-run; clamp the readout.
      const shown = d > 0 ? Math.min(t, d) : 0;
      if (finite) {
        this.scrub.value = String(shown);
        this.timeEl.textContent = `${formatTime(shown)} / ${formatTime(d)}`;
      }
      // Unbounded: scrubber and readout are hidden.
    }
  }

  private syncCursor(): void {
    const hovered = this.renderLoop?.getInteractionManager().getHoveredNode();
    const cursor = hovered?.cursorPointer ? "pointer" : "";
    if (cursor === this._lastCursor) return;
    this._lastCursor = cursor;
    const surface = this.useSvg && this.svg ? this.svg : this.canvas;
    surface.style.cursor = cursor;
  }

  private refreshControls(): void {
    const show = this.boolAttr("controls");
    this.controlsEl.style.display = show ? "flex" : "none";
    // Reserve the bar's height so the surface doesn't render under it; re-fit.
    this.style.setProperty("--pc-controls-h", show ? "32px" : "0px");
    this.syncSize();
    if (!show) return;
    const d = this.duration;
    const finite = isFinite(d);
    // Unbounded scenes have no endpoint: play/pause only (like Rive's state machines).
    this.scrub.style.display = finite ? "" : "none";
    this.timeEl.style.display = finite ? "" : "none";
    this.scrub.max = String(finite ? d : 0);
    this.scrub.disabled = !finite || d <= 0;
    this.scrub.value = String(this.currentTime);
    this.playBtn.textContent = this.paused ? "▶" : "❚❚";
    if (finite)
      this.timeEl.textContent = `${formatTime(this.currentTime)} / ${formatTime(d)}`;
  }
}

/** m:ss.t */
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds * 10) % 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export function registerPopkornPlayer(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("popkorn-player")) {
    customElements.define("popkorn-player", PopkornPlayer);
  }
}

// No-op where `customElements` is absent (RN/Hermes may polyfill `window` without it).
registerPopkornPlayer();
