import type { ResolvedClip } from "../renderer/types";
import { getShapeBounds } from "./transform";
import type { SceneNode } from "./types";

/**
 * Resolve a node's authored clip-path to concrete local-space geometry.
 * `inset` is applied against the node's bounding box; `circle`/`path` are
 * already in local coordinates. Returns null when the node has no clip.
 *
 * Shared by the renderer (to clip) and hit-testing (to reject points), so both
 * agree on the exact region.
 */
export function resolveClip(node: SceneNode): ResolvedClip | null {
  const clip = node.clipPath;
  if (!clip) return null;

  switch (clip.type) {
    case "circle":
      return { type: "circle", cx: clip.x, cy: clip.y, r: clip.r };
    case "inset": {
      const b = getShapeBounds(node);
      return {
        type: "rect",
        x: b.x + clip.left,
        y: b.y + clip.top,
        width: b.width - clip.left - clip.right,
        height: b.height - clip.top - clip.bottom,
      };
    }
    case "path":
      return { type: "path", commands: clip.commands };
  }
}
