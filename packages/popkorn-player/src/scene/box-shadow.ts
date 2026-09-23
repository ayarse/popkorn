import type { PathCommand, ResolvedClip } from "../renderer/types.js";
import { computePathBounds, roundedRectPath } from "./path-parser.js";
import { polystarToCommands } from "./polystar.js";
import type { ShapeData } from "./types.js";

// Ellipse as four clockwise quarter-arcs so it composes into compound shadow paths.
function ellipseCommands(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): PathCommand[] {
  const a = (x: number, y: number): PathCommand => ({
    type: "A",
    rx,
    ry,
    angle: 0,
    largeArc: false,
    sweep: true,
    x,
    y,
  });
  return [
    { type: "M", x: cx + rx, y: cy },
    a(cx, cy + ry),
    a(cx - rx, cy),
    a(cx, cy - ry),
    a(cx + rx, cy),
    { type: "Z" },
  ];
}

// Arcs translate rigidly: only endpoints move.
function translateCommands(
  commands: PathCommand[],
  dx: number,
  dy: number,
): PathCommand[] {
  return commands.map((c) => {
    switch (c.type) {
      case "M":
      case "L":
      case "T":
        return { ...c, x: c.x + dx, y: c.y + dy };
      case "H":
        return { ...c, x: c.x + dx };
      case "V":
        return { ...c, y: c.y + dy };
      case "C":
        return {
          ...c,
          x1: c.x1 + dx,
          y1: c.y1 + dy,
          x2: c.x2 + dx,
          y2: c.y2 + dy,
          x: c.x + dx,
          y: c.y + dy,
        };
      case "S":
        return {
          ...c,
          x2: c.x2 + dx,
          y2: c.y2 + dy,
          x: c.x + dx,
          y: c.y + dy,
        };
      case "Q":
        return { ...c, x1: c.x1 + dx, y1: c.y1 + dy, x: c.x + dx, y: c.y + dy };
      case "A":
        return { ...c, x: c.x + dx, y: c.y + dy };
      default:
        return c; // Z
    }
  });
}

// Outline moved by (dx,dy) and inflated by spread; null for group/text/image.
// NOTE: path/star/polygon only translate; offsetting an arbitrary outline is out of scope.
export function shapeOutline(
  sd: ShapeData,
  dx: number,
  dy: number,
  spread: number,
): PathCommand[] | null {
  if (sd.type === "rect") {
    const x = sd.x - spread + dx;
    const y = sd.y - spread + dy;
    const w = sd.width + 2 * spread;
    const h = sd.height + 2 * spread;
    if (sd.cornerRadii) {
      const grow = (v: number) => Math.max(0, v + spread);
      return roundedRectPath(x, y, w, h, [
        grow(sd.cornerRadii[0]),
        grow(sd.cornerRadii[1]),
        grow(sd.cornerRadii[2]),
        grow(sd.cornerRadii[3]),
      ]);
    }
    const rx = sd.rx > 0 ? Math.max(0, sd.rx + spread) : 0;
    if (rx > 0) return roundedRectPath(x, y, w, h, [rx, rx, rx, rx]);
    return [
      { type: "M", x, y },
      { type: "L", x: x + w, y },
      { type: "L", x: x + w, y: y + h },
      { type: "L", x, y: y + h },
      { type: "Z" },
    ];
  }
  if (sd.type === "circle") {
    const rr = Math.max(0, sd.r + spread);
    return ellipseCommands(sd.cx + dx, sd.cy + dy, rr, rr);
  }
  if (sd.type === "ellipse") {
    return ellipseCommands(
      sd.cx + dx,
      sd.cy + dy,
      Math.max(0, sd.rx + spread),
      Math.max(0, sd.ry + spread),
    );
  }
  if (sd.type === "path") {
    return translateCommands(sd.commands, dx, dy);
  }
  if (sd.type === "star" || sd.type === "polygon") {
    return translateCommands(polystarToCommands(sd), dx, dy);
  }
  return null;
}

// Shape-accurate clip for inset shadows; only sharp rect and circle use native clip primitives.
export function shapeClip(sd: ShapeData): ResolvedClip | null {
  if (sd.type === "rect") {
    if (sd.cornerRadii || sd.rx > 0) {
      const outline = shapeOutline(sd, 0, 0, 0);
      return outline ? { type: "path", commands: outline } : null;
    }
    return {
      type: "rect",
      x: sd.x,
      y: sd.y,
      width: sd.width,
      height: sd.height,
    };
  }
  if (sd.type === "circle") {
    return { type: "circle", cx: sd.cx, cy: sd.cy, r: sd.r };
  }
  const outline = shapeOutline(sd, 0, 0, 0);
  return outline ? { type: "path", commands: outline } : null;
}

// Evenodd cover rect with the deflated, offset shape punched out; caller clips to the shape.
export function insetShadowCommands(
  sd: ShapeData,
  dx: number,
  dy: number,
  spread: number,
): PathCommand[] | null {
  const hole = shapeOutline(sd, dx, dy, -spread);
  if (!hole) return null;
  const b = shapeBounds(sd);
  if (!b) return null;
  const m = 1e4;
  const cover: PathCommand[] = [
    { type: "M", x: b.x - m, y: b.y - m },
    { type: "L", x: b.x + b.w + m, y: b.y - m },
    { type: "L", x: b.x + b.w + m, y: b.y + b.h + m },
    { type: "L", x: b.x - m, y: b.y + b.h + m },
    { type: "Z" },
  ];
  return [...cover, ...hole];
}

function shapeBounds(
  sd: ShapeData,
): { x: number; y: number; w: number; h: number } | null {
  if (sd.type === "rect") {
    return { x: sd.x, y: sd.y, w: sd.width, h: sd.height };
  }
  if (sd.type === "circle") {
    return { x: sd.cx - sd.r, y: sd.cy - sd.r, w: sd.r * 2, h: sd.r * 2 };
  }
  if (sd.type === "ellipse") {
    return { x: sd.cx - sd.rx, y: sd.cy - sd.ry, w: sd.rx * 2, h: sd.ry * 2 };
  }
  const outline = shapeOutline(sd, 0, 0, 0);
  if (!outline) return null;
  const b = computePathBounds(outline);
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}
