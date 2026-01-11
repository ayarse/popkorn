/**
 * Input tracking for cursor, touch, etc.
 * This is for Phase 3 (stretch goal) but we set up the structure now.
 */

export interface InputState {
  cursor: {
    x: number;
    y: number;
    isDown: boolean;
  };
  scroll: {
    x: number;
    y: number;
  };
  time: number;
}

export class InputTracker {
  private state: InputState = {
    cursor: { x: 0, y: 0, isDown: false },
    scroll: { x: 0, y: 0 },
    time: 0,
  };

  private canvas: HTMLCanvasElement | null = null;
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

  update(time: number): void {
    this.state.time = time;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.state.cursor.x = e.clientX - rect.left;
    this.state.cursor.y = e.clientY - rect.top;
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
  }
}

let tracker: InputTracker | null = null;

export function getInputTracker(): InputTracker {
  if (!tracker) {
    tracker = new InputTracker();
  }
  return tracker;
}

export function createInputTracker(): InputTracker {
  return new InputTracker();
}
