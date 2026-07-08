/**
 * Input tracking for cursor, touch, etc.
 * This is for Phase 3 (stretch goal) but we set up the structure now.
 */

import { IDENTITY_VIEWPORT, type Viewport } from './viewport';

export interface InputState {
  cursor: {
    x: number;
    y: number;
    isDown: boolean;
  };
  scroll: {
    x: number;
    y: number;
    // Page scroll normalized to 0..1 by the scrollable range; the raw offset
    // stays available as x/y. Feeds input(scroll.progress) for scrubbing.
    progress: number;
  };
  time: number;
}

export class InputTracker {
  private state: InputState = {
    cursor: { x: 0, y: 0, isDown: false },
    scroll: { x: 0, y: 0, progress: 0 },
    time: 0,
  };

  private canvas: HTMLCanvasElement | null = null;
  // Maps pointer coords (CSS px, ×dpr -> device px) back to scene coords, so
  // hit-testing and input(cursor.*) keep working under any fit / DPR. Default is
  // identity at dpr 1 (canvas px == scene px).
  private viewport: Viewport = IDENTITY_VIEWPORT;
  private dpr: number = 1;
  private boundHandlers: {
    mouseMove: (e: MouseEvent) => void;
    mouseDown: (e: MouseEvent) => void;
    mouseUp: (e: MouseEvent) => void;
    scroll: (e: Event) => void;
  } | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    this.boundHandlers = {
      mouseMove: this.handleMouseMove.bind(this),
      mouseDown: this.handleMouseDown.bind(this),
      mouseUp: this.handleMouseUp.bind(this),
      scroll: this.handleScroll.bind(this),
    };

    canvas.addEventListener('mousemove', this.boundHandlers.mouseMove);
    canvas.addEventListener('mousedown', this.boundHandlers.mouseDown);
    canvas.addEventListener('mouseup', this.boundHandlers.mouseUp);
    window.addEventListener('scroll', this.boundHandlers.scroll);
  }

  detach(): void {
    if (this.canvas && this.boundHandlers) {
      this.canvas.removeEventListener('mousemove', this.boundHandlers.mouseMove);
      this.canvas.removeEventListener('mousedown', this.boundHandlers.mouseDown);
      this.canvas.removeEventListener('mouseup', this.boundHandlers.mouseUp);
      window.removeEventListener('scroll', this.boundHandlers.scroll);
    }
    this.canvas = null;
    this.boundHandlers = null;
  }

  getState(): InputState {
    return this.state;
  }

  /** Set the scene<-device mapping so cursor coords resolve to scene space. */
  setViewport(viewport: Viewport, dpr: number): void {
    this.viewport = viewport;
    this.dpr = dpr;
  }

  update(time: number): void {
    this.state.time = time;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    // CSS px within the canvas -> device px (×dpr) -> scene coords (inverse
    // viewport). getBoundingClientRect is CSS px regardless of backing-store size.
    const deviceX = (e.clientX - rect.left) * this.dpr;
    const deviceY = (e.clientY - rect.top) * this.dpr;
    this.state.cursor.x = (deviceX - this.viewport.offsetX) / this.viewport.scaleX;
    this.state.cursor.y = (deviceY - this.viewport.offsetY) / this.viewport.scaleY;
  }

  private handleMouseDown(_e: MouseEvent): void {
    this.state.cursor.isDown = true;
  }

  private handleMouseUp(_e: MouseEvent): void {
    this.state.cursor.isDown = false;
  }

  private handleScroll(_e: Event): void {
    this.state.scroll.x = window.scrollX;
    this.state.scroll.y = window.scrollY;
    this.state.scroll.progress = scrollProgress(
      window.scrollY,
      document.documentElement?.scrollHeight ?? 0,
      window.innerHeight,
    );
  }
}

/**
 * Page scroll normalized to 0..1: scrollY / max(1, scrollHeight - innerHeight).
 * The max(1,…) guards the zero-range case (content shorter than the viewport)
 * so progress stays 0 rather than NaN/Infinity.
 */
export function scrollProgress(
  scrollY: number,
  scrollHeight: number,
  innerHeight: number,
): number {
  return scrollY / Math.max(1, scrollHeight - innerHeight);
}

export function createInputTracker(): InputTracker {
  return new InputTracker();
}
