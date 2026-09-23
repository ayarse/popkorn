/** Cursor, touch and scroll state for input(cursor.*)/input(scroll.*). */

import { isFunctionValue, isKeywordValue, type Value } from "@popkorn/parser";
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

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener("mousemove", this.handleMouseMove);
    canvas.addEventListener("mousedown", this.handleMouseDown);
    canvas.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("scroll", this.handleScroll);
  }

  detach(): void {
    if (this.canvas) {
      this.canvas.removeEventListener("mousemove", this.handleMouseMove);
      this.canvas.removeEventListener("mousedown", this.handleMouseDown);
      this.canvas.removeEventListener("mouseup", this.handleMouseUp);
      window.removeEventListener("scroll", this.handleScroll);
    }
    this.canvas = null;
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

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    // CSS px → device px (×dpr) → scene (inverse viewport).
    const deviceX = (e.clientX - rect.left) * this.dpr;
    const deviceY = (e.clientY - rect.top) * this.dpr;
    const scene = deviceToScene(this.viewport, deviceX, deviceY);
    this.state.cursor.x = scene.x;
    this.state.cursor.y = scene.y;
  };

  private handleMouseDown = (): void => {
    this.state.cursor.isDown = true;
    this.state.cursor.pressed = true;
  };

  private handleMouseUp = (): void => {
    this.state.cursor.isDown = false;
  };

  private handleScroll = (): void => {
    this.state.scroll.x = window.scrollX;
    this.state.scroll.y = window.scrollY;
    this.state.scroll.progress = scrollProgress(
      window.scrollY,
      document.documentElement?.scrollHeight ?? 0,
      window.innerHeight,
    );
  };
}

/** scrollY / max(1, range); the max keeps a zero range at 0 rather than NaN. */
export function scrollProgress(
  scrollY: number,
  scrollHeight: number,
  innerHeight: number,
): number {
  return scrollY / Math.max(1, scrollHeight - innerHeight);
}

/** `input(cursor.x)` → "cursor.x"; null for anything else. */
export function inputPathOf(v: Value): string | null {
  if (!isFunctionValue(v) || v.name !== "input") return null;
  const arg = v.args[0];
  return arg && isKeywordValue(arg) ? arg.value : null;
}
