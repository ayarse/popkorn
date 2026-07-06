import type { PathCommand } from '../renderer/types';
import type { SceneNode, ShapeData } from './types';

/**
 * Parse SVG path data string into PathCommand array
 */
export function parsePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const tokens = tokenizePath(d);
  let i = 0;

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    i++;

    const isRelative = cmd === cmd.toLowerCase();
    const command = cmd.toUpperCase();

    switch (command) {
      case 'M': {
        const x = parseFloat(tokens[i++]);
        const y = parseFloat(tokens[i++]);
        const absX = isRelative ? currentX + x : x;
        const absY = isRelative ? currentY + y : y;
        commands.push({ type: 'M', x: absX, y: absY });
        currentX = absX;
        currentY = absY;
        startX = absX;
        startY = absY;

        // Additional coordinate pairs are treated as lineto
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const lx = parseFloat(tokens[i++]);
          const ly = parseFloat(tokens[i++]);
          const absLX = isRelative ? currentX + lx : lx;
          const absLY = isRelative ? currentY + ly : ly;
          commands.push({ type: 'L', x: absLX, y: absLY });
          currentX = absLX;
          currentY = absLY;
        }
        break;
      }

      case 'L': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;
          commands.push({ type: 'L', x: absX, y: absY });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'H': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x = parseFloat(tokens[i++]);
          const absX = isRelative ? currentX + x : x;
          commands.push({ type: 'H', x: absX });
          currentX = absX;
        }
        break;
      }

      case 'V': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const y = parseFloat(tokens[i++]);
          const absY = isRelative ? currentY + y : y;
          commands.push({ type: 'V', y: absY });
          currentY = absY;
        }
        break;
      }

      case 'C': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x1 = parseFloat(tokens[i++]);
          const y1 = parseFloat(tokens[i++]);
          const x2 = parseFloat(tokens[i++]);
          const y2 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX1 = isRelative ? currentX + x1 : x1;
          const absY1 = isRelative ? currentY + y1 : y1;
          const absX2 = isRelative ? currentX + x2 : x2;
          const absY2 = isRelative ? currentY + y2 : y2;
          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({
            type: 'C',
            x1: absX1, y1: absY1,
            x2: absX2, y2: absY2,
            x: absX, y: absY
          });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'S': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x2 = parseFloat(tokens[i++]);
          const y2 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX2 = isRelative ? currentX + x2 : x2;
          const absY2 = isRelative ? currentY + y2 : y2;
          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({
            type: 'S',
            x2: absX2, y2: absY2,
            x: absX, y: absY
          });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'Q': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x1 = parseFloat(tokens[i++]);
          const y1 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX1 = isRelative ? currentX + x1 : x1;
          const absY1 = isRelative ? currentY + y1 : y1;
          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({
            type: 'Q',
            x1: absX1, y1: absY1,
            x: absX, y: absY
          });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'T': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({ type: 'T', x: absX, y: absY });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'A': {
        while (i < tokens.length && !isNaN(parseFloat(tokens[i]))) {
          const rx = parseFloat(tokens[i++]);
          const ry = parseFloat(tokens[i++]);
          const angle = parseFloat(tokens[i++]);
          const largeArc = tokens[i++] === '1';
          const sweep = tokens[i++] === '1';
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);

          const absX = isRelative ? currentX + x : x;
          const absY = isRelative ? currentY + y : y;

          commands.push({
            type: 'A',
            rx, ry, angle, largeArc, sweep,
            x: absX, y: absY
          });
          currentX = absX;
          currentY = absY;
        }
        break;
      }

      case 'Z': {
        commands.push({ type: 'Z' });
        currentX = startX;
        currentY = startY;
        break;
      }
    }
  }

  return commands;
}

/**
 * A canvas path builder: satisfied by both CanvasRenderingContext2D and Path2D.
 * Lets drawPath, clip-path realization, and hit-testing share one code path so
 * their geometry (including arcs) is identical.
 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  ellipse(
    x: number, y: number, rx: number, ry: number, rotation: number,
    startAngle: number, endAngle: number, counterclockwise?: boolean
  ): void;
  closePath(): void;
}

/**
 * Emit parsed path commands into a PathSink. Mirrors SVG path semantics,
 * including smooth-curve reflection and real elliptical arcs.
 */
export function applyCommandsToPath(sink: PathSink, commands: PathCommand[]): void {
  let currentX = 0;
  let currentY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCommand: string | null = null;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        sink.moveTo(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'L':
        sink.lineTo(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'H':
        sink.lineTo(cmd.x, currentY);
        currentX = cmd.x;
        break;
      case 'V':
        sink.lineTo(currentX, cmd.y);
        currentY = cmd.y;
        break;
      case 'C':
        sink.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        lastControlX = cmd.x2;
        lastControlY = cmd.y2;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'S': {
        let cx1 = currentX;
        let cy1 = currentY;
        if (lastCommand === 'C' || lastCommand === 'S') {
          cx1 = 2 * currentX - lastControlX;
          cy1 = 2 * currentY - lastControlY;
        }
        sink.bezierCurveTo(cx1, cy1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        lastControlX = cmd.x2;
        lastControlY = cmd.y2;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'Q':
        sink.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        lastControlX = cmd.x1;
        lastControlY = cmd.y1;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'T': {
        let qx = currentX;
        let qy = currentY;
        if (lastCommand === 'Q' || lastCommand === 'T') {
          qx = 2 * currentX - lastControlX;
          qy = 2 * currentY - lastControlY;
        }
        sink.quadraticCurveTo(qx, qy, cmd.x, cmd.y);
        lastControlX = qx;
        lastControlY = qy;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'A': {
        const seg = arcToEllipse(
          currentX, currentY, cmd.rx, cmd.ry, cmd.angle, cmd.largeArc, cmd.sweep, cmd.x, cmd.y
        );
        if (seg) {
          sink.ellipse(
            seg.cx, seg.cy, seg.rx, seg.ry, seg.rotation,
            seg.startAngle, seg.endAngle, seg.counterclockwise
          );
        } else {
          // Degenerate arc (zero radius / coincident endpoints) -> straight line.
          sink.lineTo(cmd.x, cmd.y);
        }
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'Z':
        sink.closePath();
        break;
    }
    lastCommand = cmd.type;
  }
}

export interface ArcSegment {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;   // radians
  startAngle: number; // radians
  endAngle: number;   // radians
  counterclockwise: boolean;
}

/**
 * Convert an SVG endpoint-parameterized elliptical arc to center parameters
 * suitable for CanvasRenderingContext2D.ellipse / Path2D.ellipse.
 *
 * Implements the SVG spec conversion (Appendix F.6.5 / F.6.6): zero radii or
 * coincident endpoints degenerate to a straight line (returns null); radii too
 * small to span the endpoints are scaled up (F.6.6).
 */
export function arcToEllipse(
  x1: number, y1: number,
  rxIn: number, ryIn: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number, y2: number
): ArcSegment | null {
  // Coincident endpoints: arc reduces to nothing / a line.
  if (x1 === x2 && y1 === y2) return null;
  // Zero radius: straight line per spec.
  if (rxIn === 0 || ryIn === 0) return null;

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Step 1: compute (x1', y1') — midpoint offset in the rotated frame.
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Step 1.5 (F.6.6): scale up radii if they can't span the endpoints.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // Step 2: compute center (cx', cy') in the rotated frame.
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
  const den = rx2 * y1p2 + ry2 * x1p2;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;

  // Step 3: back to the untransformed coordinate system.
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // Step 4: start angle and sweep angle.
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const startAngle = angleBetween(1, 0, ux, uy);
  let deltaAngle = angleBetween(ux, uy, vx, vy);
  if (!sweep && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  if (sweep && deltaAngle < 0) deltaAngle += 2 * Math.PI;

  return {
    cx,
    cy,
    rx,
    ry,
    rotation: phi,
    startAngle,
    endAngle: startAngle + deltaAngle,
    counterclockwise: deltaAngle < 0,
  };
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  let ang = Math.acos(Math.max(-1, Math.min(1, len === 0 ? 1 : dot / len)));
  if (ux * vy - uy * vx < 0) ang = -ang;
  return ang;
}

/**
 * Axis-aligned bounds of parsed path commands, from anchor and control points.
 * Approximate (control points overshoot the true curve) but sufficient for
 * anchoring gradients to a path's box.
 */
export function computePathBounds(commands: PathCommand[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let currentX = 0;
  let currentY = 0;

  const acc = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
      case 'L':
      case 'T':
      case 'A':
        acc(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'H':
        acc(cmd.x, currentY);
        currentX = cmd.x;
        break;
      case 'V':
        acc(currentX, cmd.y);
        currentY = cmd.y;
        break;
      case 'C':
        acc(cmd.x1, cmd.y1);
        acc(cmd.x2, cmd.y2);
        acc(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'S':
        acc(cmd.x2, cmd.y2);
        acc(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case 'Q':
        acc(cmd.x1, cmd.y1);
        acc(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
    }
  }

  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Samples per curved segment when flattening for length. Fixed-step keeps this
// allocation-free and deterministic; it is plenty for trim-path visuals.
// ponytail: adaptive subdivision (error-bounded) would be tighter for extreme curves.
const LENGTH_SAMPLES = 32;

/**
 * Total length of a parsed path's outline. Straight segments are exact;
 * quadratic/cubic beziers and elliptical arcs are flattened by fixed-step
 * sampling and summed. Matches applyCommandsToPath's control-point tracking so
 * smooth (S/T) segments measure the same curve that gets drawn.
 */
export function computePathLength(commands: PathCommand[]): number {
  let total = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCommand: string | null = null;

  const line = (x2: number, y2: number) => {
    total += Math.hypot(x2 - currentX, y2 - currentY);
    currentX = x2;
    currentY = y2;
  };

  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    let px = currentX;
    let py = currentY;
    for (let k = 1; k <= LENGTH_SAMPLES; k++) {
      const t = k / LENGTH_SAMPLES;
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const d = t * t * t;
      const sx = a * currentX + b * x1 + c * x2 + d * x;
      const sy = a * currentY + b * y1 + c * y2 + d * y;
      total += Math.hypot(sx - px, sy - py);
      px = sx;
      py = sy;
    }
    currentX = x;
    currentY = y;
  };

  const quad = (x1: number, y1: number, x: number, y: number) => {
    let px = currentX;
    let py = currentY;
    for (let k = 1; k <= LENGTH_SAMPLES; k++) {
      const t = k / LENGTH_SAMPLES;
      const mt = 1 - t;
      const sx = mt * mt * currentX + 2 * mt * t * x1 + t * t * x;
      const sy = mt * mt * currentY + 2 * mt * t * y1 + t * t * y;
      total += Math.hypot(sx - px, sy - py);
      px = sx;
      py = sy;
    }
    currentX = x;
    currentY = y;
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        currentX = cmd.x;
        currentY = cmd.y;
        startX = cmd.x;
        startY = cmd.y;
        break;
      case 'L':
        line(cmd.x, cmd.y);
        break;
      case 'H':
        line(cmd.x, currentY);
        break;
      case 'V':
        line(currentX, cmd.y);
        break;
      case 'C':
        cubic(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        lastControlX = cmd.x2;
        lastControlY = cmd.y2;
        break;
      case 'S': {
        let cx1 = currentX;
        let cy1 = currentY;
        if (lastCommand === 'C' || lastCommand === 'S') {
          cx1 = 2 * currentX - lastControlX;
          cy1 = 2 * currentY - lastControlY;
        }
        cubic(cx1, cy1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        lastControlX = cmd.x2;
        lastControlY = cmd.y2;
        break;
      }
      case 'Q':
        quad(cmd.x1, cmd.y1, cmd.x, cmd.y);
        lastControlX = cmd.x1;
        lastControlY = cmd.y1;
        break;
      case 'T': {
        let qx = currentX;
        let qy = currentY;
        if (lastCommand === 'Q' || lastCommand === 'T') {
          qx = 2 * currentX - lastControlX;
          qy = 2 * currentY - lastControlY;
        }
        quad(qx, qy, cmd.x, cmd.y);
        lastControlX = qx;
        lastControlY = qy;
        break;
      }
      case 'A': {
        const seg = arcToEllipse(
          currentX, currentY, cmd.rx, cmd.ry, cmd.angle, cmd.largeArc, cmd.sweep, cmd.x, cmd.y
        );
        if (seg) {
          const cosR = Math.cos(seg.rotation);
          const sinR = Math.sin(seg.rotation);
          let px = currentX;
          let py = currentY;
          for (let k = 1; k <= LENGTH_SAMPLES; k++) {
            const a = seg.startAngle + ((seg.endAngle - seg.startAngle) * k) / LENGTH_SAMPLES;
            const ex = seg.rx * Math.cos(a);
            const ey = seg.ry * Math.sin(a);
            const sx = seg.cx + ex * cosR - ey * sinR;
            const sy = seg.cy + ex * sinR + ey * cosR;
            total += Math.hypot(sx - px, sy - py);
            px = sx;
            py = sy;
          }
        } else {
          line(cmd.x, cmd.y);
        }
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case 'Z':
        line(startX, startY);
        break;
    }
    lastCommand = cmd.type;
  }

  return total;
}

/**
 * Ramanujan's second approximation for an ellipse's perimeter. Exact for a
 * circle (rx === ry); within ~1e-5 relative error for typical eccentricities.
 * Approximate — good enough for trim-path length.
 */
export function ellipsePerimeter(rx: number, ry: number): number {
  const a = Math.abs(rx);
  const b = Math.abs(ry);
  if (a === 0 && b === 0) return 0;
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * Total outline length of a shape's geometry. Analytic for circle/ellipse/rect
 * (rounded corners = 4 quarter-ellipse arcs = one full ellipse perimeter);
 * paths are flattened. Groups have no outline.
 */
export function shapeOutlineLength(sd: ShapeData): number {
  switch (sd.type) {
    case 'circle':
      return 2 * Math.PI * Math.abs(sd.r);
    case 'ellipse':
      return ellipsePerimeter(sd.rx, sd.ry);
    case 'rect': {
      const rx = Math.min(Math.abs(sd.rx), sd.width / 2);
      const ry = Math.min(Math.abs(sd.ry), sd.height / 2);
      const straight = 2 * (sd.width - 2 * rx) + 2 * (sd.height - 2 * ry);
      return straight + ellipsePerimeter(rx, ry);
    }
    case 'path':
      return computePathLength(sd.commands);
    default:
      return 0;
  }
}

/**
 * Cached outline length for a node. Recomputed only when a geometry apply has
 * flagged outlineLengthDirty (see the registry), so static shapes measure once.
 */
export function outlineLength(node: SceneNode): number {
  if (!node.outlineLengthDirty && node.cachedOutlineLength !== null) {
    return node.cachedOutlineLength;
  }
  const len = shapeOutlineLength(node.shapeData);
  node.cachedOutlineLength = len;
  node.outlineLengthDirty = false;
  return len;
}

function tokenizePath(d: string): string[] {
  const tokens: string[] = [];
  const regex = /([MmLlHhVvCcSsQqTtAaZz])|(-?[\d.]+)/g;
  let match;

  while ((match = regex.exec(d)) !== null) {
    tokens.push(match[0]);
  }

  return tokens;
}
