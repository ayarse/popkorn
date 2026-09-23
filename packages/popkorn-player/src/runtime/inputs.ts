/** Cursor, touch and scroll state for input(cursor.*)/input(scroll.*). */

import { deviceToScene, IDENTITY_VIEWPORT, type Viewport } from "./viewport.js";

export interface InputState {
  cursor: {
    x: number;
    y: number;
    isDown: boolean;
    // Latched until the loop consumes it, so a tap between frames still edges.
    pressed: boolean;
  };
  scroll: {
    x: number;
    y: number;
    // 0..1 over the scrollable range; raw offset stays in x/y.
    progress: number;
  };
  time: number;
}

export class InputTracker {
  private state: InputState = {
    cursor: { x: 0, y: 0, isDown: false, pressed: false },
    scroll: { x: 0, y: 0, progress: 0 },
    time: 0,
  };

  private canvas: HTMLCanvasElement | null = null;
  // Device px → scene coords, so hit-testing and input(cursor.*) survive fit/DPR.
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

    canvas.addEventListener("mousemove", this.boundHandlers.mouseMove);
    canvas.addEventListener("mousedown", this.boundHandlers.mouseDown);
    canvas.addEventListener("mouseup", this.boundHandlers.mouseUp);
    window.addEventListener("scroll", this.boundHandlers.scroll);
  }

  detach(): void {
    if (this.canvas && this.boundHandlers) {
      this.canvas.removeEventListener(
        "mousemove",
        this.boundHandlers.mouseMove,
      );
      this.canvas.removeEventListener(
        "mousedown",
        this.boundHandlers.mouseDown,
      );
      this.canvas.removeEventListener("mouseup", this.boundHandlers.mouseUp);
      window.removeEventListener("scroll", this.boundHandlers.scroll);
    }
    this.canvas = null;
    this.boundHandlers = null;
  }

  getState(): InputState {
    return this.state;
  }

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
    // CSS px → device px (×dpr) → scene (inverse viewport).
    const deviceX = (e.clientX - rect.left) * this.dpr;
    const deviceY = (e.clientY - rect.top) * this.dpr;
    const scene = deviceToScene(this.viewport, deviceX, deviceY);
    this.state.cursor.x = scene.x;
    this.state.cursor.y = scene.y;
  }

  private handleMouseDown(_e: MouseEvent): void {
    this.state.cursor.isDown = true;
    this.state.cursor.pressed = true;
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

/** scrollY / max(1, range); the max keeps a zero range at 0 rather than NaN. */
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
