import type { CornerRadii, PathCommand } from "../renderer/types.js";
import { clamp01 } from "./matrix.js";
import { polystarToCommands } from "./polystar.js";
import type { SceneNode, ShapeData } from "./types.js";

// Per-corner rect outline ([tl, tr, br, bl], clockwise), shared by SVG and Skia so corners can't drift.
// NOTE: radii clamp independently to half the shorter side; CSS proportional overflow scaling isn't implemented.
export function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  corners: CornerRadii,
): PathCommand[] {
  const max = Math.min(Math.abs(w), Math.abs(h)) / 2;
  const clamp = (r: number) => Math.max(0, Math.min(r, max));
  const [tl, tr, br, bl] = [
    clamp(corners[0]),
    clamp(corners[1]),
    clamp(corners[2]),
    clamp(corners[3]),
  ];
  const cmds: PathCommand[] = [];
  const arc = (r: number, ex: number, ey: number) =>
    cmds.push(
      r > 0
        ? {
            type: "A",
            rx: r,
            ry: r,
            angle: 0,
            largeArc: false,
            sweep: true,
            x: ex,
            y: ey,
          }
        : { type: "L", x: ex, y: ey },
    );
  cmds.push({ type: "M", x: x + tl, y });
  cmds.push({ type: "L", x: x + w - tr, y });
  arc(tr, x + w, y + tr);
  cmds.push({ type: "L", x: x + w, y: y + h - br });
  arc(br, x + w - br, y + h);
  cmds.push({ type: "L", x: x + bl, y: y + h });
  arc(bl, x, y + h - bl);
  cmds.push({ type: "L", x, y: y + tl });
  arc(tl, x + tl, y);
  cmds.push({ type: "Z" });
  return cmds;
}

// Arg slots per command: x/y shift by the current point when relative, f is an arc flag, n is plain.
const PATH_ARGS: Record<string, string> = {
  M: "xy",
  L: "xy",
  H: "x",
  V: "y",
  C: "xyxyxy",
  S: "xyxy",
  Q: "xyxy",
  T: "xy",
  A: "nnnffxy",
};

function makeCommand(type: string, a: number[]): PathCommand {
  switch (type) {
    case "M":
      return { type: "M", x: a[0], y: a[1] };
    case "L":
      return { type: "L", x: a[0], y: a[1] };
    case "T":
      return { type: "T", x: a[0], y: a[1] };
    case "H":
      return { type: "H", x: a[0] };
    case "V":
      return { type: "V", y: a[0] };
    case "C":
      return {
        type: "C",
        x1: a[0],
        y1: a[1],
        x2: a[2],
        y2: a[3],
        x: a[4],
        y: a[5],
      };
    case "S":
      return { type: "S", x2: a[0], y2: a[1], x: a[2], y: a[3] };
    case "Q":
      return { type: "Q", x1: a[0], y1: a[1], x: a[2], y: a[3] };
    default:
      return {
        type: "A",
        rx: a[0],
        ry: a[1],
        angle: a[2],
        largeArc: a[3] === 1,
        sweep: a[4] === 1,
        x: a[5],
        y: a[6],
      };
  }
}

export function parsePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const tokens = tokenizePath(d);
  const args: number[] = [];
  let i = 0;

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  // Compact notation glues arc flags onto the next number (`011.5` = 0,1,1.5): peel one char.
  const readFlag = (): boolean => {
    const tok = tokens[i];
    const flag = tok[0] === "1";
    const rest = tok.slice(1);
    if (rest.length > 0) tokens[i] = rest;
    else i++;
    return flag;
  };
  const hasNumber = (): boolean =>
    i < tokens.length && !Number.isNaN(parseFloat(tokens[i]));

  // SVG error handling: an incomplete command ends the path; everything before it renders.
  parse: while (i < tokens.length) {
    const cmd = tokens[i];
    i++;

    const isRelative = cmd === cmd.toLowerCase();
    const command = cmd.toUpperCase();

    if (command === "Z") {
      commands.push({ type: "Z" });
      currentX = startX;
      currentY = startY;
      continue;
    }
    const slots = PATH_ARGS[command];
    if (slots === undefined) continue;

    // M's first pair is unconditional; extra pairs are implicit lineto.
    let type = command;
    let first = command === "M";
    while (first || hasNumber()) {
      for (let k = 0; k < slots.length; k++) {
        const slot = slots[k];
        if (!hasNumber()) break parse;
        if (slot === "f") {
          const c = tokens[i][0];
          if (c !== "0" && c !== "1") break parse;
          args[k] = readFlag() ? 1 : 0;
          continue;
        }
        const v = parseFloat(tokens[i++]);
        args[k] =
          !isRelative || slot === "n"
            ? v
            : slot === "x"
              ? currentX + v
              : currentY + v;
      }
      commands.push(makeCommand(type, args));
      const xi = slots.lastIndexOf("x");
      const yi = slots.lastIndexOf("y");
      if (xi >= 0) currentX = args[xi];
      if (yi >= 0) currentY = args[yi];
      if (first) {
        startX = currentX;
        startY = currentY;
        type = "L";
        first = false;
      }
    }
  }

  return commands;
}

// Satisfied by CanvasRenderingContext2D and Path2D, so draw, clip and hit-test share geometry.
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  closePath(): void;
}

// SVG semantics, including smooth-curve reflection and real elliptical arcs; `arcEnd` gets each arc's exact endpoint.
export function applyCommandsToPath(
  sink: PathSink,
  commands: PathCommand[],
  arcEnd?: (x: number, y: number) => void,
): void {
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCommand: string | null = null;

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        sink.moveTo(cmd.x, cmd.y);
        currentX = startX = cmd.x;
        currentY = startY = cmd.y;
        break;
      case "L":
        sink.lineTo(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "H":
        sink.lineTo(cmd.x, currentY);
        currentX = cmd.x;
        break;
      case "V":
        sink.lineTo(currentX, cmd.y);
        currentY = cmd.y;
        break;
      case "C":
        sink.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        lastControlX = cmd.x2;
        lastControlY = cmd.y2;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "S": {
        let cx1 = currentX;
        let cy1 = currentY;
        if (lastCommand === "C" || lastCommand === "S") {
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
      case "Q":
        sink.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        lastControlX = cmd.x1;
        lastControlY = cmd.y1;
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "T": {
        let qx = currentX;
        let qy = currentY;
        if (lastCommand === "Q" || lastCommand === "T") {
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
      case "A": {
        const seg = arcToEllipse(
          currentX,
          currentY,
          cmd.rx,
          cmd.ry,
          cmd.angle,
          cmd.largeArc,
          cmd.sweep,
          cmd.x,
          cmd.y,
        );
        if (seg) {
          sink.ellipse(
            seg.cx,
            seg.cy,
            seg.rx,
            seg.ry,
            seg.rotation,
            seg.startAngle,
            seg.endAngle,
            seg.counterclockwise,
          );
          arcEnd?.(cmd.x, cmd.y);
        } else {
          sink.lineTo(cmd.x, cmd.y);
        }
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case "Z":
        sink.closePath();
        currentX = startX;
        currentY = startY;
        break;
    }
    lastCommand = cmd.type;
  }
}

interface ArcSegment {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number; // radians
  startAngle: number; // radians
  endAngle: number; // radians
  counterclockwise: boolean;
}

// SVG endpoint arc to center params (spec F.6.5/F.6.6); null when degenerate, undersized radii scale up.
export function arcToEllipse(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): ArcSegment | null {
  if (x1 === x2 && y1 === y2) return null;
  if (rxIn === 0 || ryIn === 0) return null;

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Step 1: midpoint offset in the rotated frame.
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

  // Step 2: center in the rotated frame.
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

  // Step 3: back to user space.
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

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

// From anchor and control points: conservative, enough for gradient anchoring.
export function computePathBounds(commands: PathCommand[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
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
      case "M":
      case "L":
      case "T":
      case "A":
        acc(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "H":
        acc(cmd.x, currentY);
        currentX = cmd.x;
        break;
      case "V":
        acc(currentX, cmd.y);
        currentY = cmd.y;
        break;
      case "C":
        acc(cmd.x1, cmd.y1);
        acc(cmd.x2, cmd.y2);
        acc(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "S":
        acc(cmd.x2, cmd.y2);
        acc(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "Q":
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

// NOTE: fixed samples per curve (allocation-free, deterministic); adaptive subdivision would be tighter.
const LENGTH_SAMPLES = 32;

// Fixed-step flattener shared by length, hit-test and motion path, driven by the same walk as rendering.
function flattenPath(
  commands: PathCommand[],
  emit: (x: number, y: number, isMove: boolean) => void,
): void {
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  const point = (x: number, y: number) => {
    emit(x, y, false);
    currentX = x;
    currentY = y;
  };

  applyCommandsToPath(
    {
      moveTo(x, y) {
        emit(x, y, true);
        currentX = startX = x;
        currentY = startY = y;
      },
      lineTo: point,
      bezierCurveTo(x1, y1, x2, y2, x, y) {
        const x0 = currentX;
        const y0 = currentY;
        for (let k = 1; k <= LENGTH_SAMPLES; k++) {
          const t = k / LENGTH_SAMPLES;
          const mt = 1 - t;
          const a = mt * mt * mt;
          const b = 3 * mt * mt * t;
          const c = 3 * mt * t * t;
          const d = t * t * t;
          point(
            a * x0 + b * x1 + c * x2 + d * x,
            a * y0 + b * y1 + c * y2 + d * y,
          );
        }
      },
      quadraticCurveTo(x1, y1, x, y) {
        const x0 = currentX;
        const y0 = currentY;
        for (let k = 1; k <= LENGTH_SAMPLES; k++) {
          const t = k / LENGTH_SAMPLES;
          const mt = 1 - t;
          point(
            mt * mt * x0 + 2 * mt * t * x1 + t * t * x,
            mt * mt * y0 + 2 * mt * t * y1 + t * t * y,
          );
        }
      },
      ellipse(cx, cy, rx, ry, rotation, startAngle, endAngle) {
        const cosR = Math.cos(rotation);
        const sinR = Math.sin(rotation);
        for (let k = 1; k <= LENGTH_SAMPLES; k++) {
          const a = startAngle + ((endAngle - startAngle) * k) / LENGTH_SAMPLES;
          const ex = rx * Math.cos(a);
          const ey = ry * Math.sin(a);
          point(cx + ex * cosR - ey * sinR, cy + ex * sinR + ey * cosR);
        }
      },
      closePath() {
        point(startX, startY);
      },
    },
    commands,
    (x, y) => {
      currentX = x;
      currentY = y;
    },
  );
}

// M jumps add no length (SVG getTotalLength semantics).
export function computePathLength(commands: PathCommand[]): number {
  let total = 0;
  let px = 0;
  let py = 0;
  flattenPath(commands, (x, y, isMove) => {
    if (!isMove) total += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  });
  return total;
}

// One open polyline per subpath, from the shared flattener so hit-testing matches the drawn curve.
export function flattenToSubpaths(
  commands: PathCommand[],
): { x: number; y: number }[][] {
  const subpaths: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] | null = null;
  flattenPath(commands, (x, y, isMove) => {
    if (isMove || current === null) {
      current = [];
      subpaths.push(current);
    }
    current.push({ x, y });
  });
  return subpaths;
}

// Flattened outline with a cumulative arc-length table; built once (offset-path is static).
export interface MotionPath {
  points: { x: number; y: number }[];
  cumulative: number[]; // arc length at each point; cumulative[0] === 0
  length: number;
}

// M jumps add zero length, so samplePathAt snaps across the gap instead of interpolating it.
export function buildMotionPath(commands: PathCommand[]): MotionPath {
  const points: { x: number; y: number }[] = [];
  const cumulative: number[] = [];
  let total = 0;
  flattenPath(commands, (x, y, isMove) => {
    if (points.length > 0 && !isMove) {
      const last = points[points.length - 1];
      total += Math.hypot(x - last.x, y - last.y);
    }
    points.push({ x, y });
    cumulative.push(total);
  });
  if (points.length === 0) {
    points.push({ x: 0, y: 0 });
    cumulative.push(0);
  }
  return { points, cumulative, length: total };
}

// Angle in radians.
export function samplePathAt(
  mp: MotionPath,
  distance01: number,
): { x: number; y: number; angle: number } {
  const pts = mp.points;
  if (pts.length === 1 || mp.length === 0) {
    return { x: pts[0].x, y: pts[0].y, angle: 0 };
  }

  const target = clamp01(distance01) * mp.length;
  const cum = mp.cumulative;

  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  // Clamp so a target at the very end still has a segment.
  const i = Math.min(lo, pts.length - 2);
  const a = pts[i];
  const b = pts[i + 1];
  const segLen = cum[i + 1] - cum[i];
  const f = segLen > 0 ? (target - cum[i]) / segLen : 0;

  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

// Ramanujan II: exact for circles, ~1e-5 relative error otherwise.
function ellipsePerimeter(rx: number, ry: number): number {
  const a = Math.abs(rx);
  const b = Math.abs(ry);
  if (a === 0 && b === 0) return 0;
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

// Analytic for circle/ellipse/rect (rounded corners sum to one ellipse perimeter); paths flatten.
export function shapeOutlineLength(sd: ShapeData): number {
  switch (sd.type) {
    case "circle":
      return 2 * Math.PI * Math.abs(sd.r);
    case "ellipse":
      return ellipsePerimeter(sd.rx, sd.ry);
    case "rect": {
      // Four quarter-circles plus the straight remainder of each edge.
      if (sd.cornerRadii) {
        const cap = Math.min(sd.width, sd.height) / 2;
        const [tl, tr, br, bl] = sd.cornerRadii.map((r) =>
          Math.max(0, Math.min(r, cap)),
        );
        const straight =
          Math.max(0, sd.width - tl - tr) +
          Math.max(0, sd.height - tr - br) +
          Math.max(0, sd.width - br - bl) +
          Math.max(0, sd.height - bl - tl);
        const arcs = (Math.PI / 2) * (tl + tr + br + bl);
        return straight + arcs;
      }
      const rx = Math.min(Math.abs(sd.rx || sd.ry), sd.width / 2);
      const ry = Math.min(Math.abs(sd.ry || sd.rx), sd.height / 2);
      const straight = 2 * (sd.width - 2 * rx) + 2 * (sd.height - 2 * ry);
      return straight + ellipsePerimeter(rx, ry);
    }
    case "path":
      return computePathLength(sd.commands);
    case "star":
    case "polygon":
      return computePathLength(polystarToCommands(sd));
    default:
      return 0;
  }
}

// Recomputed only when the registry flags outlineLengthDirty.
export function outlineLength(node: SceneNode): number {
  if (!node.outlineLengthDirty && node.cachedOutlineLength !== null) {
    return node.cachedOutlineLength;
  }
  const len = shapeOutlineLength(node.shapeData);
  node.cachedOutlineLength = len;
  node.outlineLengthDirty = false;
  return len;
}

const PATH_TOKEN =
  /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;

function tokenizePath(d: string): string[] {
  return d.match(PATH_TOKEN) ?? [];
}
