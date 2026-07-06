import { parse } from '@popcorn/parser';
import { Canvas2DRenderer } from './renderer/canvas2d';
import { buildSceneGraph } from './scene/builder';
import { RenderLoop } from './runtime/loop';
import { AnimationScheduler } from './animation/scheduler';

/**
 * PopcornPlayer Web Component
 *
 * Usage:
 * ```html
 * <popcorn-player
 *   src="..."
 *   width="400"
 *   height="300"
 *   background="#1a1a2e"
 * ></popcorn-player>
 * ```
 *
 * Or set source programmatically:
 * ```js
 * const player = document.querySelector('popcorn-player');
 * player.source = myDslCode;
 * ```
 */
export class PopcornPlayer extends HTMLElement {
  private canvas: HTMLCanvasElement;
  private renderer: Canvas2DRenderer | null = null;
  private renderLoop: RenderLoop | null = null;
  private scheduler: AnimationScheduler | null = null;
  private _source: string = '';

  static get observedAttributes() {
    return ['src', 'width', 'height', 'background'];
  }

  constructor() {
    super();

    // Create shadow DOM
    const shadow = this.attachShadow({ mode: 'open' });

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: inline-block;
      }
      canvas {
        display: block;
      }
    `;

    shadow.appendChild(style);
    shadow.appendChild(this.canvas);
  }

  connectedCallback() {
    // Set initial dimensions
    this.updateDimensions();

    // Initialize if we have source
    if (this._source) {
      this.initializePlayer();
    }
  }

  disconnectedCallback() {
    this.stop();
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
    switch (name) {
      case 'src':
        if (newValue !== null) {
          this.source = newValue;
        }
        break;
      case 'width':
      case 'height':
        this.updateDimensions();
        break;
      case 'background':
        if (this.renderLoop) {
          this.renderLoop.setBackgroundColor(newValue);
        }
        break;
    }
  }

  /**
   * Get or set the DSL source code
   */
  get source(): string {
    return this._source;
  }

  set source(value: string) {
    this._source = value;
    if (this.isConnected) {
      this.initializePlayer();
    }
  }

  /**
   * Get the canvas width
   */
  get width(): number {
    return this.canvas.width;
  }

  set width(value: number) {
    this.setAttribute('width', String(value));
  }

  /**
   * Get the canvas height
   */
  get height(): number {
    return this.canvas.height;
  }

  set height(value: number) {
    this.setAttribute('height', String(value));
  }

  /**
   * Get or set the background color
   */
  get background(): string | null {
    return this.getAttribute('background');
  }

  set background(value: string | null) {
    if (value) {
      this.setAttribute('background', value);
    } else {
      this.removeAttribute('background');
    }
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

  private updateDimensions(): void {
    const width = parseInt(this.getAttribute('width') || '400', 10);
    const height = parseInt(this.getAttribute('height') || '300', 10);

    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  private async initializePlayer(): Promise<void> {
    // Stop any existing loop
    this.stop();

    if (!this._source) {
      return;
    }

    try {
      // Parse the DSL
      const ast = parse(this._source);

      // Build scene graph
      const sceneRoot = buildSceneGraph(ast);

      // Initialize renderer
      this.renderer = new Canvas2DRenderer(this.canvas);

      // Create scheduler
      this.scheduler = new AnimationScheduler();

      // Create render loop
      this.renderLoop = new RenderLoop(this.renderer, this.scheduler);
      this.renderLoop.setScene(sceneRoot);

      // Set background color if specified
      const bg = this.getAttribute('background');
      if (bg) {
        this.renderLoop.setBackgroundColor(bg);
      }

      // Set up variable resolver with AST variables
      const variableResolver = this.renderLoop.getVariableResolver();
      variableResolver.setVariables(ast.variables);

      // Attach input tracker
      const inputTracker = this.renderLoop.getInputTracker();
      inputTracker.attach(this.canvas);

      // Start playback
      this.renderLoop.start();

      // Dispatch ready event
      this.dispatchEvent(new CustomEvent('ready', { detail: { sceneRoot } }));
    } catch (error) {
      console.error('PopcornPlayer: Failed to initialize', error);
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    }
  }
}

/**
 * Register the custom element
 */
export function registerPopcornPlayer(): void {
  if (!customElements.get('popcorn-player')) {
    customElements.define('popcorn-player', PopcornPlayer);
  }
}

// Auto-register when imported
if (typeof window !== 'undefined') {
  registerPopcornPlayer();
}
