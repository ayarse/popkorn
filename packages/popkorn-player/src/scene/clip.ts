import type { ResolvedClip } from "../renderer/types.js";
import { getShapeBounds } from "./shape-bounds.js";
import type { SceneNode } from "./types.js";

// Local-space clip geometry (inset against the bbox), shared by renderer and hit-testing.
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
