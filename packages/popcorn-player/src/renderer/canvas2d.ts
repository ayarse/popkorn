import type { Renderer } from './interface';
import type { Color, PathCommand, Matrix3x3 } from './types';
import { colorToCSS } from './types';

/**
 * Canvas 2D implementation of the Renderer interface
 * Used for the PoC - can be swapped for ThorVG later
 */
export class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private fillColor: string | null = '#000000';
  private strokeColor: string | null = null;
  private strokeWidth: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  beginFrame(): void {
    this.clear();
    // Reset state
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
  }

  endFrame(): void {
    // No-op for Canvas2D (immediate mode)
  }

  drawRect(x: number, y: number, w: number, h: number, rx = 0, ry = 0): void {
    this.ctx.beginPath();
    if (rx > 0 || ry > 0) {
      // Use roundRect for rounded corners
      this.ctx.roundRect(x, y, w, h, [rx, ry]);
    } else {
      this.ctx.rect(x, y, w, h);
    }
    this.applyFillAndStroke();
  }

  drawCircle(cx: number, cy: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.applyFillAndStroke();
  }

  drawEllipse(cx: number, cy: number, rx: number, ry: number): void {
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.applyFillAndStroke();
  }

  drawPath(commands: PathCommand[]): void {
    this.ctx.beginPath();
    let currentX = 0;
    let currentY = 0;
    let lastControlX = 0;
    let lastControlY = 0;
    let lastCommand: string | null = null;

    for (const cmd of commands) {
      switch (cmd.type) {
        case 'M':
          this.ctx.moveTo(cmd.x, cmd.y);
          currentX = cmd.x;
          currentY = cmd.y;
          break;
        case 'L':
          this.ctx.lineTo(cmd.x, cmd.y);
          currentX = cmd.x;
          currentY = cmd.y;
          break;
        case 'H':
          this.ctx.lineTo(cmd.x, currentY);
          currentX = cmd.x;
          break;
        case 'V':
          this.ctx.lineTo(currentX, cmd.y);
          currentY = cmd.y;
          break;
        case 'C':
          this.ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
          lastControlX = cmd.x2;
          lastControlY = cmd.y2;
          currentX = cmd.x;
          currentY = cmd.y;
          break;
        case 'S': {
          // Smooth curve - reflect last control point
          let cx1 = currentX;
          let cy1 = currentY;
          if (lastCommand === 'C' || lastCommand === 'S') {
            cx1 = 2 * currentX - lastControlX;
            cy1 = 2 * currentY - lastControlY;
          }
          this.ctx.bezierCurveTo(cx1, cy1, cmd.x2, cmd.y2, cmd.x, cmd.y);
          lastControlX = cmd.x2;
          lastControlY = cmd.y2;
          currentX = cmd.x;
          currentY = cmd.y;
          break;
        }
        case 'Q':
          this.ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
          lastControlX = cmd.x1;
          lastControlY = cmd.y1;
          currentX = cmd.x;
          currentY = cmd.y;
          break;
        case 'T': {
          // Smooth quadratic - reflect last control point
          let qx = currentX;
          let qy = currentY;
          if (lastCommand === 'Q' || lastCommand === 'T') {
            qx = 2 * currentX - lastControlX;
            qy = 2 * currentY - lastControlY;
          }
          this.ctx.quadraticCurveTo(qx, qy, cmd.x, cmd.y);
          lastControlX = qx;
          lastControlY = qy;
          currentX = cmd.x;
          currentY = cmd.y;
          break;
        }
        case 'A':
          // Arc - convert to canvas arc
          this.drawArc(
            currentX, currentY,
            cmd.rx, cmd.ry,
            cmd.angle,
            cmd.largeArc,
            cmd.sweep,
            cmd.x, cmd.y
          );
          currentX = cmd.x;
          currentY = cmd.y;
          break;
        case 'Z':
          this.ctx.closePath();
          break;
      }
      lastCommand = cmd.type;
    }
    this.applyFillAndStroke();
  }

  private drawArc(
    _x1: number, _y1: number,
    _rx: number, _ry: number,
    _angle: number,
    _largeArc: boolean,
    _sweep: boolean,
    x2: number, y2: number
  ): void {
    // Simplified arc drawing - use line for now
    // Full SVG arc implementation is complex
    // For the PoC, we'll approximate with a line
    this.ctx.lineTo(x2, y2);
  }

  setFill(color: Color | null): void {
    this.fillColor = color ? colorToCSS(color) : null;
  }

  setStroke(color: Color | null, width: number): void {
    this.strokeColor = color ? colorToCSS(color) : null;
    this.strokeWidth = width;
  }

  setOpacity(opacity: number): void {
    this.ctx.globalAlpha = opacity;
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }

  rotate(angle: number): void {
    this.ctx.rotate(angle);
  }

  scale(sx: number, sy: number): void {
    this.ctx.scale(sx, sy);
  }

  transform(m: Matrix3x3): void {
    // Matrix3x3 is [a, b, tx, c, d, ty, 0, 0, 1]
    // Canvas transform takes (a, b, c, d, e, f) = (a, c, b, d, tx, ty)
    this.ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
  }

  setTransform(m: Matrix3x3): void {
    // Matrix3x3 is [a, b, tx, c, d, ty, 0, 0, 1]
    // Canvas setTransform takes (a, b, c, d, e, f) = (a, c, b, d, tx, ty)
    this.ctx.setTransform(m[0], m[3], m[1], m[4], m[2], m[5]);
  }

  getWidth(): number {
    return this.ctx.canvas.width;
  }

  getHeight(): number {
    return this.ctx.canvas.height;
  }

  private applyFillAndStroke(): void {
    if (this.fillColor) {
      this.ctx.fillStyle = this.fillColor;
      this.ctx.fill();
    }
    if (this.strokeColor) {
      this.ctx.strokeStyle = this.strokeColor;
      this.ctx.lineWidth = this.strokeWidth;
      this.ctx.stroke();
    }
  }
}
