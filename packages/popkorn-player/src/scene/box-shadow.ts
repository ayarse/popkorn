import type { PathCommand, ResolvedClip } from "../renderer/types";
import { computePathBounds, roundedRectPath } from "./path-parser";
import { polystarToCommands } from "./polystar";
import type {
  CircleData,
  EllipseData,
  PathData,
  PolystarData,
  RectData,
  ShapeData,
} from "./types";

// A full ellipse (or circle, rx===ry) as four clockwise quarter-arcs — the shape
// primitives the renderer draws natively don't compose into the compound inset
// path, so box-shadow geometry expresses circles/ellipses as path commands.
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

// Translate absolute path commands by (dx,dy). Arc radii/flags are unchanged —
// only the endpoint moves (an arc offset is a rigid translation).
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

// The shape's own outline as path commands, moved by (dx,dy) and inflated by
// `spread` (a negative spread deflates — used for the inset hole). Rect/circle/
// ellipse inflate exactly; a path/star/polygon only translates (spread is
// ignored — NOTE: outline offsetting an arbitrary path is out of scope). Returns
// null only for shapes with no outline (group/text/image).
export function shapeOutline(
  sd: ShapeData,
  dx: number,
  dy: number,
  spread: number,
): PathCommand[] | null {
  if (sd.type === "rect") {
    const r = sd as RectData;
    const x = r.x - spread + dx;
    const y = r.y - spread + dy;
    const w = r.width + 2 * spread;
    const h = r.height + 2 * spread;
    if (r.cornerRadii) {
      const grow = (v: number) => Math.max(0, v + spread);
      return roundedRectPath(x, y, w, h, [
        grow(r.cornerRadii[0]),
        grow(r.cornerRadii[1]),
        grow(r.cornerRadii[2]),
        grow(r.cornerRadii[3]),
      ]);
    }
    const rx = r.rx > 0 ? Math.max(0, r.rx + spread) : 0;
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
    const c = sd as CircleData;
    const rr = Math.max(0, c.r + spread);
    return ellipseCommands(c.cx + dx, c.cy + dy, rr, rr);
  }
  if (sd.type === "ellipse") {
    const e = sd as EllipseData;
    return ellipseCommands(
      e.cx + dx,
      e.cy + dy,
      Math.max(0, e.rx + spread),
      Math.max(0, e.ry + spread),
    );
  }
  if (sd.type === "path") {
    return translateCommands((sd as PathData).commands, dx, dy);
  }
  if (sd.type === "star" || sd.type === "polygon") {
    return translateCommands(polystarToCommands(sd as PolystarData), dx, dy);
  }
  return null;
}

// The shape's outline as a clip region so an inset shadow shows only inside it.
// Shape-accurate: a rounded rect and per-corner rect clip to their real outline
// (path clip), not the bounding box; ellipse/path/star clip to their outline;
// only a sharp rect and a circle use the cheap native clip primitives.
export function shapeClip(sd: ShapeData): ResolvedClip | null {
  if (sd.type === "rect") {
    const r = sd as RectData;
    if (r.cornerRadii || r.rx > 0) {
      const outline = shapeOutline(sd, 0, 0, 0);
      return outline ? { type: "path", commands: outline } : null;
    }
    return { type: "rect", x: r.x, y: r.y, width: r.width, height: r.height };
  }
  if (sd.type === "circle") {
    const c = sd as CircleData;
    return { type: "circle", cx: c.cx, cy: c.cy, r: c.r };
  }
  const outline = shapeOutline(sd, 0, 0, 0);
  return outline ? { type: "path", commands: outline } : null;
}

// The shape's outline, offset by (dx,dy) and inflated by `spread` — the outer
// shadow silhouette. Null for shapes without an outline (routes to the filter
// drop-shadow path instead).
export function outerShadowCommands(
  sd: ShapeData,
  dx: number,
  dy: number,
  spread: number,
): PathCommand[] | null {
  return shapeOutline(sd, dx, dy, spread);
}

// A compound (evenodd) path for an inset shadow: a big cover rect with the shape
// — deflated by `spread` and offset by (dx,dy) — punched out as a hole. The
// caller clips to the shape (see shapeClip), so only the inner rim of shadow
// colour shows; spread shrinks the hole, blur softens it. Null for outline-less
// shapes.
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
    const r = sd as RectData;
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  if (sd.type === "circle") {
    const c = sd as CircleData;
    return { x: c.cx - c.r, y: c.cy - c.r, w: c.r * 2, h: c.r * 2 };
  }
  if (sd.type === "ellipse") {
    const e = sd as EllipseData;
    return { x: e.cx - e.rx, y: e.cy - e.ry, w: e.rx * 2, h: e.ry * 2 };
  }
  const outline = shapeOutline(sd, 0, 0, 0);
  if (!outline) return null;
  const b = computePathBounds(outline);
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}
