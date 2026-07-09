import { parse } from "@popcorn/parser";
import { AnimationScheduler } from "./animation/scheduler";
import { Canvas2DRenderer } from "./renderer/canvas2d";
import { SVGRenderer } from "./renderer/svg";
import { RenderLoop } from "./runtime/loop";
import {
  computeViewport,
  type FitMode,
  viewportMatrix,
} from "./runtime/viewport";
import { buildSceneGraph } from "./scene/builder";

/**
 * PopcornPlayer Web Component
 *
 * Usage — `src` is a URL to fetch (http(s), relative, `data:`, `blob:`):
 * ```html
 * <popcorn-player
 *   src="scene.css"
 *   loop
 *   controls
 *   fit="contain"
 *   background="#1a1a2e"
 * ></popcorn-player>
 * ```
 *
 * Or set the DSL source *text* directly (the inline channel — not a URL):
 * ```js
 * const player = document.querySelector('popcorn-player');
 * player.source = myDslCode;
 * ```
 *
 * The player is responsive: the canvas fills the host, whose default size comes
 * from the scene's `:root` aspect ratio but can be constrained by the parent.
 */
// Degrade the base class to an inert stub when there's no DOM (RN, bun tests),
// so importing the package barrel stays headless-safe; it's the real HTMLElement
// in a browser. The class is only ever instantiated by `customElements`, which
// only exists where HTMLElement does.
const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

export class PopcornPlayer extends HTMLElementBase {
  private canvas: HTMLCanvasElement;
  // Live SVG surface, created lazily when renderer="svg" (default is canvas).
  private svg: SVGSVGElement | null = null;
  private renderer: Canvas2DRenderer | SVGRenderer | null = null;
  private useSvg = false;
  private renderLoop: RenderLoop | null = null;
  private scheduler: AnimationScheduler | null = null;
  private _source: string = "";
  // Bumped on every load request (a src fetch or a .source set). A fetch that
  // resolves with a stale token has been superseded and must not clobber the
  // newer load.
  private _loadToken = 0;

  // Intrinsic scene size (from `:root`, falling back to width/height attrs).
  private sceneWidth: number = 400;
  private sceneHeight: number = 300;

  private resizeObserver: ResizeObserver | null = null;

  // Controls UI (shadow DOM).
  private controlsEl: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private scrub: HTMLInputElement;
  private timeEl: HTMLSpanElement;
  private scrubbing = false;
  private wasPlaying = false;

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
    ];
  }

  constructor() {
    super();

    const shadow = this.attachShadow({ mode: "open" });

    // Canvas fills the host; the ResizeObserver drives its backing store.
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

    // Build the controls overlay (hidden unless the `controls` attr is set).
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
    // Responsive: repaint + resize the backing store whenever the host resizes.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.syncSize());
      this.resizeObserver.observe(this);
    }

    if (this._source) {
      this.initializePlayer();
    }
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stop();
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    newValue: string | null,
  ) {
    switch (name) {
      case "src":
        if (newValue !== null) {
          this.loadFromUrl(newValue);
        }
        break;
      case "width":
      case "height":
        // Only a fallback scene size (used when there's no :root stage config); re-fit.
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
      // `autoplay` only affects the initial start, handled in initializePlayer.
    }
  }

  /**
   * Get or set the DSL source code
   */
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

  /**
   * The `src` URL to load DSL source from. Reflects the attribute. Accepts any
   * URL `fetch()` understands — http(s), relative, `data:`, `blob:`. For inline
   * DSL *text*, set `.source` instead (that's the raw-text channel).
   */
  get src(): string | null {
    return this.getAttribute("src");
  }

  set src(value: string | null) {
    if (value === null) this.removeAttribute("src");
    else this.setAttribute("src", value);
  }

  /** Fetch DSL source from a URL and load it, guarding against stale fetches. */
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
      console.error("PopcornPlayer: Failed to load src", error);
      this.dispatchEvent(new CustomEvent("error", { detail: { error } }));
    }
  }

  /**
   * Get the canvas width
   */
  get width(): number {
    return this.canvas.width;
  }

  set width(value: number) {
    this.setAttribute("width", String(value));
  }

  /**
   * Get the canvas height
   */
  get height(): number {
    return this.canvas.height;
  }

  set height(value: number) {
    this.setAttribute("height", String(value));
  }

  /**
   * Get or set the background color
   */
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

  /** Whether the timeline loops. */
  get loop(): boolean {
    return this.boolAttr("loop");
  }

  set loop(value: boolean) {
    if (value) this.setAttribute("loop", "");
    else this.removeAttribute("loop");
  }

  /** Whether the controls overlay is shown. */
  get controls(): boolean {
    return this.boolAttr("controls");
  }

  set controls(value: boolean) {
    if (value) this.setAttribute("controls", "");
    else this.removeAttribute("controls");
  }

  /**
   * Whether playback auto-starts. DEVIATION from the HTML-media convention:
   * default is TRUE — an absent `autoplay` attribute means autoplay unless it is
   * explicitly `autoplay="false"`. This preserves the historical auto-start
   * behavior (back-compat wins over the HTML boolean-attribute norm).
   */
  get autoplay(): boolean {
    return this.getAttribute("autoplay") !== "false";
  }

  set autoplay(value: boolean) {
    this.setAttribute("autoplay", value ? "true" : "false");
  }

  /** How the scene is fitted into the host (contain | cover | fill | none). */
  get fit(): FitMode {
    const v = this.getAttribute("fit");
    return v === "cover" || v === "fill" || v === "none" ? v : "contain";
  }

  set fit(value: FitMode) {
    this.setAttribute("fit", value);
  }

  /**
   * Start playback
   */
  play(): void {
    if (this.renderLoop) {
      this.renderLoop.start();
    }
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (this.renderLoop) {
      this.renderLoop.stop();
    }
  }

  /**
   * Reset animations to initial state
   */
  reset(): void {
    if (this.renderLoop) {
      this.renderLoop.reset();
    }
  }

  /**
   * Freeze the timeline (interaction stays live).
   */
  pause(): void {
    this.renderLoop?.pause();
  }

  /**
   * Resume the timeline from where it was paused.
   */
  resume(): void {
    this.renderLoop?.resume();
  }

  /**
   * Jump to a timeline position in milliseconds and render it, even while paused.
   */
  seek(ms: number): void {
    this.renderLoop?.seek(ms);
  }

  // --- Host variable API (state-machine inputs) ------------------------------
  // Set before the scene loads is remembered and applied on init; fire/get
  // before load no-op / return undefined (a momentary trigger has no meaning
  // without a running loop), matching how seek() tolerates the not-loaded case.
  private pendingVariables: Map<string, number | boolean> = new Map();

  /** Set an author-declared `--variable` (number or boolean) from the host. */
  setVariable(name: string, value: number | boolean): void {
    const resolver = this.renderLoop?.getVariableResolver();
    if (resolver) {
      resolver.setVariable(name, value);
      this.renderLoop?.redraw();
    } else {
      this.pendingVariables.set(name, value);
    }
  }

  /** Read an author-declared `--variable`'s current value (undefined if unknown). */
  getVariable(name: string): number | boolean | string | undefined {
    return this.renderLoop?.getVariableResolver().getVariable(name);
  }

  /**
   * Fire an event into the scene. If `name` resolves to an author-declared
   * `trigger` variable it is fired as one (reads `true` for one frame); any
   * other name is enqueued as a machine `on event(name)` occurrence. This one
   * method covers both `--tap` trigger vars and opaque host event names.
   */
  fire(name: string): void {
    if (!this.renderLoop) return;
    const resolver = this.renderLoop.getVariableResolver();
    if (resolver.getVariable(name) !== undefined) {
      resolver.fire(name);
    } else {
      this.renderLoop.enqueueMachineEvent(name);
    }
  }

  /**
   * Current timeline position in milliseconds.
   */
  get currentTime(): number {
    return this.renderLoop?.currentTime ?? 0;
  }

  /** Scene duration in milliseconds (0 when the scene has no animations). */
  get duration(): number {
    return this.renderLoop?.duration ?? 0;
  }

  /** Whether the timeline is currently frozen. */
  get paused(): boolean {
    return this.renderLoop?.paused ?? true;
  }

  private boolAttr(name: string): boolean {
    const v = this.getAttribute(name);
    return v !== null && v !== "false";
  }

  private async initializePlayer(): Promise<void> {
    // Stop any existing loop
    this.stop();

    if (!this._source) {
      return;
    }

    try {
      const ast = parse(this._source);

      // Intrinsic scene size: `:root` wins, else the width/height attrs.
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

      // Backend: canvas (default) or a retained SVG surface (renderer="svg").
      // The viewport handling below is identical for both — the fit/DPR matrix
      // is folded into the transforms the loop hands the renderer.
      this.useSvg = this.getAttribute("renderer") === "svg";
      const surface = this.useSvg ? this.ensureSvg() : this.canvas;
      this.canvas.style.display = this.useSvg ? "none" : "block";
      if (this.svg) this.svg.style.display = this.useSvg ? "block" : "none";
      this.renderer = this.useSvg
        ? new SVGRenderer(this.svg!)
        : new Canvas2DRenderer(this.canvas);
      this.scheduler = new AnimationScheduler();

      this.renderLoop = new RenderLoop(this.renderer, this.scheduler);
      this.renderLoop.setScene(sceneRoot);
      this.renderLoop.setSceneSize(this.sceneWidth, this.sceneHeight);
      this.renderLoop.setLoop(this.boolAttr("loop"));
      this.renderLoop.setFrameCallback((t) => this.onFrame(t));
      // Non-looping timeline reached its end -> notify the host once (Lottie's
      // `complete`). Looping/state-machine scenes never fire it.
      this.renderLoop.setCompleteCallback(() => {
        this.dispatchEvent(new CustomEvent("complete"));
      });
      // Machine transitions/emits -> DOM events for the host.
      this.renderLoop.setMachineEventCallback((o) => {
        if (o.type === "statechange") {
          this.dispatchEvent(
            new CustomEvent("statechange", {
              detail: { machine: o.machine, from: o.from, to: o.to },
            }),
          );
        } else {
          this.dispatchEvent(
            new CustomEvent("machine-event", {
              detail: { machine: o.machine, name: o.name },
            }),
          );
        }
      });

      // Background: explicit attr wins, else the authored `:root` background.
      const bg =
        this.getAttribute("background") ?? ast.canvas?.background ?? null;
      if (bg) {
        this.renderLoop.setBackgroundColor(bg);
      }

      const variableResolver = this.renderLoop.getVariableResolver();
      variableResolver.setVariables(ast.variables);

      // Apply any host setVariable() calls made before the scene loaded.
      for (const [name, value] of this.pendingVariables) {
        variableResolver.setVariable(name, value);
      }
      this.pendingVariables.clear();

      // Input stays on the active surface; the inverse-viewport path in
      // InputTracker works unchanged for either element (only getBoundingClientRect
      // + pointer listeners, both present on canvas and svg).
      const inputTracker = this.renderLoop.getInputTracker();
      inputTracker.attach(surface as HTMLCanvasElement);

      // Size the backing store and compute the fit viewport before first paint.
      this.syncSize();

      // Autoplay default TRUE (see the `autoplay` getter). When off, keep the
      // loop running so interaction stays live but freeze the timeline at 0.
      this.renderLoop.start();
      if (!this.autoplay) {
        this.renderLoop.pause();
      }

      this.refreshControls();

      this.dispatchEvent(
        new CustomEvent("ready", {
          detail: { sceneRoot, duration: this.duration },
        }),
      );
    } catch (error) {
      console.error("PopcornPlayer: Failed to initialize", error);
      this.dispatchEvent(new CustomEvent("error", { detail: { error } }));
    }
  }

  /** Lazily create the SVG surface and append it into the shadow root. */
  private ensureSvg(): SVGSVGElement {
    if (!this.svg) {
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      // Insert before the controls overlay so the overlay stays on top.
      this.shadowRoot!.insertBefore(this.svg, this.controlsEl);
    }
    return this.svg;
  }

  /**
   * Match the render surface's backing store to the host element × devicePixelRatio
   * and recompute the fit viewport (shared with the render root and input mapping).
   */
  private syncSize(): void {
    if (!this.renderLoop) return;

    // Measure the active render surface (which is inset above the controls bar),
    // not the host, so the fit viewport matches the real drawable area.
    const surface: Element = this.useSvg && this.svg ? this.svg : this.canvas;
    const rect = surface.getBoundingClientRect();
    const elemW = rect.width || this.sceneWidth;
    const elemH = rect.height || this.sceneHeight;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;

    const bw = Math.max(1, Math.round(elemW * dpr));
    const bh = Math.max(1, Math.round(elemH * dpr));
    // Both backends work in the same device-px space (viewport folds in DPR/fit);
    // each backend's resize() sizes its own surface (canvas w/h vs SVG viewBox).
    this.renderer?.resize(bw, bh);

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

    // While running, the next rAF frame repaints; when paused/stopped, force one.
    if (!this.renderLoop.running) this.renderLoop.redraw();
  }

  // --- Controls --------------------------------------------------------------

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

  /** Per-frame tick from the loop: advance the scrubber + readout (unless dragging). */
  private onFrame(t: number): void {
    if (!this.boolAttr("controls")) return;
    if (!this.scrubbing) {
      const d = this.duration;
      // The loop clamps the timeline to duration when not looping, but a scene
      // with no animations (d = 0) still free-runs; clamp the readout/scrubber
      // so they never exceed the total.
      const shown = d > 0 ? Math.min(t, d) : 0;
      this.scrub.value = String(shown);
      this.timeEl.textContent = `${formatTime(shown)} / ${formatTime(d)}`;
    }
  }

  /** Sync the controls bar to the current attr + scene state. */
  private refreshControls(): void {
    const show = this.boolAttr("controls");
    this.controlsEl.style.display = show ? "flex" : "none";
    // Reserve (or release) the bar's height so the surface doesn't render under
    // it; re-fit since the surface box just changed.
    this.style.setProperty("--pc-controls-h", show ? "32px" : "0px");
    this.syncSize();
    if (!show) return;
    const d = this.duration;
    this.scrub.max = String(d);
    this.scrub.disabled = d <= 0;
    this.scrub.value = String(this.currentTime);
    this.playBtn.textContent = this.paused ? "▶" : "❚❚";
    this.timeEl.textContent = `${formatTime(this.currentTime)} / ${formatTime(d)}`;
  }
}

/** Format milliseconds as m:ss.t (minutes:seconds.tenths). */
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds * 10) % 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/**
 * Register the custom element
 */
export function registerPopcornPlayer(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("popcorn-player")) {
    customElements.define("popcorn-player", PopcornPlayer);
  }
}

// Auto-register when imported. Guard both `window` and `customElements`
// separately: RN/Hermes environments (e.g. Expo) can have a `window` global
// polyfill without `customElements`, and this file is reachable from the
// barrel import, so the ReferenceError would throw at module load.
if (typeof window !== "undefined" && typeof customElements !== "undefined") {
  registerPopcornPlayer();
}
