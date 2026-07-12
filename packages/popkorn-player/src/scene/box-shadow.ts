import type { PathCommand, ResolvedClip } from "../renderer/types";
import { roundedRectPath } from "./path-parser";
import type { CircleData, EllipseData, RectData, ShapeData } from "./types";

// The shape's own outline as a clip region, so an inset shadow shows only inside
// the box. NOTE: a rounded rect clips as its bounding rect (corners ignored) —
// good enough for the inset rim; a fully-correct rounded clip would need a path.
export function shapeClip(sd: ShapeData): ResolvedClip | null {
  if (sd.type === "rect") {
    const r = sd as RectData;
    return { type: "rect", x: r.x, y: r.y, width: r.width, height: r.height };
  }
  if (sd.type === "circle") {
    const c = sd as CircleData;
    return { type: "circle", cx: c.cx, cy: c.cy, r: c.r };
  }
  if (sd.type === "ellipse") {
    const e = sd as EllipseData;
    return { type: "path", commands: ellipseCommands(e.cx, e.cy, e.rx, e.ry) };
  }
  return null;
}

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

// The shape's own outline, offset by (dx,dy) and inflated by `spread`, as path
// commands. Returns null for shapes we don't inflate (path/star/polygon/text/
// image) — those fall back to the CSS drop-shadow filter path (spread ignored).
export function outerShadowCommands(
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
  return null;
}

// A compound (evenodd) path for an inset shadow: a big cover rect with the box —
// deflated by `spread` and offset by (dx,dy) — punched out as a hole. Clipped to
// the shape by the caller, only the inner rim of shadow colour shows. Returns
// null for shapes we don't support inset on (same set as outerShadowCommands).
export function insetShadowCommands(
  sd: ShapeData,
  dx: number,
  dy: number,
  spread: number,
): PathCommand[] | null {
  const inner = outerShadowCommands(sd, dx, dy, -spread);
  if (!inner) return null;
  // Cover rect: the shape bounds blown out far enough to always exceed the clip
  // in every direction (blur + offset are small relative to this margin).
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
  return [...cover, ...inner];
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
  return null;
}
