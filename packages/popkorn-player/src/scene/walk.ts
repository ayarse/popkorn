import type { SceneNode } from "./types.js";

/** Preorder over `children` (every node, hidden or not); stops at the first match. */
export function someNode(
  node: SceneNode,
  pred: (n: SceneNode) => boolean,
): boolean {
  if (pred(node)) return true;
  for (const child of node.children) if (someNode(child, pred)) return true;
  return false;
}

/** Preorder over `children` (every node, hidden or not). */
export function forEachNode(node: SceneNode, fn: (n: SceneNode) => void): void {
  fn(node);
  for (const child of node.children) forEachNode(child, fn);
}
