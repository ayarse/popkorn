import type { PathCommand } from '../renderer/types';
import type { SceneNode, PolystarData } from './types';

/**
 * Synthesize a star or polygon into absolute-coordinate PathCommand[], matching
 * lottie-web's convertStarToPath / convertPolygonToPath.
 *
 * Vertices sit on a circle starting straight up (-90deg) plus `rotation`, walked
 * over `sides` (polygon) or `2·sides` alternating outer/inner (star) vertices.
 * When roundness is 0 the edges are straight lines; otherwise each vertex grows a
 * cubic-bezier handle of length `perimSegment · roundness` along the tangent
 * (perpendicular to the radius), giving Lottie's rounded corners.
 */
export function polystarToCommands(sd: PolystarData): PathCommand[] {
  const isStar = sd.type === 'star';
  const pts = Math.max(2, Math.floor(sd.sides));
  const numPts = isStar ? pts * 2 : pts;
  const angle = (Math.PI * 2) / numPts;
  const dir = 1; // Lottie's `d === 3` reverse winding isn't modelled here.

  const outerRad = sd.outerRadius;
  const innerRad = isStar ? sd.innerRadius : outerRad;
  const outerRound = (sd.outerRoundness || 0) / 100;
  const innerRound = (isStar ? sd.innerRoundness || 0 : sd.outerRoundness || 0) / 100;
  // Polygons divide by 4 (one segment per edge); stars by 2 (two per pair).
  const denom = isStar ? numPts * 2 : numPts * 4;
  const outerPerim = (2 * Math.PI * outerRad) / denom;
  const innerPerim = (2 * Math.PI * innerRad) / denom;

  let currentAng = -Math.PI / 2 + (sd.rotation * Math.PI) / 180;

  interface Vertex { x: number; y: number; ox: number; oy: number; ix: number; iy: number }
  const verts: Vertex[] = [];
  let rounded = false;

  for (let i = 0; i < numPts; i++) {
    const long = !isStar || i % 2 === 0;
    const rad = long ? outerRad : innerRad;
    const round = long ? outerRound : innerRound;
    const perim = long ? outerPerim : innerPerim;

    const rx = rad * Math.cos(currentAng);
    const ry = rad * Math.sin(currentAng);
    const mag = Math.sqrt(rx * rx + ry * ry);
    // Unit tangent (perpendicular to the radius), matching Lottie's (ox, oy).
    const nx = mag === 0 ? 0 : ry / mag;
    const ny = mag === 0 ? 0 : -rx / mag;
    const off = perim * round * dir;
    if (round !== 0) rounded = true;

    const x = rx + sd.cx;
    const y = ry + sd.cy;
    verts.push({
      x, y,
      ox: x - nx * off, oy: y - ny * off, // out tangent (leaving this vertex)
      ix: x + nx * off, iy: y + ny * off, // in tangent (arriving at this vertex)
    });
    currentAng += angle * dir;
  }

  const cmds: PathCommand[] = [{ type: 'M', x: verts[0].x, y: verts[0].y }];
  for (let i = 0; i < numPts; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % numPts];
    if (rounded) {
      cmds.push({ type: 'C', x1: a.ox, y1: a.oy, x2: b.ix, y2: b.iy, x: b.x, y: b.y });
    } else {
      cmds.push({ type: 'L', x: b.x, y: b.y });
    }
  }
  cmds.push({ type: 'Z' });
  return cmds;
}

/**
 * Cached polystar commands for a node (same lazy pattern as outlineLength):
 * recomputed only when polystarDirty is set by a geometry apply (registry).
 */
export function polystarCommands(node: SceneNode): PathCommand[] {
  if (!node.polystarDirty && node.cachedPolystarCommands !== null) {
    return node.cachedPolystarCommands;
  }
  const cmds = polystarToCommands(node.shapeData as PolystarData);
  node.cachedPolystarCommands = cmds;
  node.polystarDirty = false;
  return cmds;
}
