// Passes over the finished tree: masks, pointer targets, id uniqueness.

import type { MachineRule } from "@popkorn/parser";
import { createSceneNode, snapshotNode } from "./node.js";
import { idMatches } from "./rule-expand.js";
import type { MaskMode, SceneNode } from "./types.js";

// An authored `mask:` ref, resolved once the whole tree exists.
export type PendingMask = { node: SceneNode; sourceId: string; mode: MaskMode };

// Flag `on <pointer>(#id)` targets interactive; matches namespaced tails.
export function markPointerTargets(
  root: SceneNode,
  machines: MachineRule[],
): void {
  const ids = new Set<string>();
  for (const m of machines) {
    for (const s of m.states) {
      for (const tr of s.transitions) {
        if (
          tr.trigger &&
          tr.trigger.kind === "pointer" &&
          tr.trigger.target.type === "id"
        ) {
          ids.add(tr.trigger.target.name);
        }
      }
    }
  }
  if (ids.size === 0) return;
  const visit = (n: SceneNode): void => {
    if ([...ids].some((id) => idMatches(n.id, id))) n.interactive = true;
    n.children.forEach(visit);
  };
  visit(root);
}

// Resolve `mask:` refs by id; the source then paints only as a mask.
export function resolveMasks(
  root: SceneNode,
  pendingMasks: PendingMask[],
): void {
  if (pendingMasks.length === 0) return;
  const byId = new Map<string, SceneNode>();
  const index = (n: SceneNode) => {
    byId.set(n.id, n);
    n.children.forEach(index);
  };
  index(root);

  for (const { node, sourceId, mode } of pendingMasks) {
    const source = byId.get(sourceId);
    if (!source) {
      throw new Error(
        `mask on '${node.id}' references unknown node '#${sourceId}'`,
      );
    }
    node.mask = { source, mode };
    source.isMaskSource = true;
  }
}

// Content nested in its own mask source never paints; split S out a `-matte`.
export function unTrapMaskedContent(root: SceneNode): void {
  const sources: SceneNode[] = [];
  const collect = (n: SceneNode) => {
    // A source S traps content when a direct child of S is masked by S.
    if (n.isMaskSource && n.children.some((c) => c.mask?.source === n))
      sources.push(n);
    n.children.forEach(collect);
  };
  collect(root);

  for (const s of sources) {
    const content = s.children.filter((c) => c.mask?.source === s);
    const own = s.children.filter((c) => c.mask?.source !== s); // S's own matte shapes

    const matte = createSceneNode(`${s.id}-matte`, "group");
    matte.parent = s;
    matte.base = snapshotNode(matte);
    for (const c of own) c.parent = matte;
    matte.children = own;
    matte.isMaskSource = true;

    s.isMaskSource = false;
    s.children = [matte, ...content];
    // Repoint every node masked by S (trapped or not) at the matte holder.
    repointMaskSource(root, s, matte);
  }
}

function repointMaskSource(
  node: SceneNode,
  from: SceneNode,
  to: SceneNode,
): void {
  if (node.mask?.source === from) node.mask.source = to;
  node.children.forEach((c) => {
    repointMaskSource(c, from, to);
  });
}

// Repeat-derived ids must not collide with any other node id.
export function assertUniqueIds(root: SceneNode): void {
  const seen = new Set<string>();
  const visit = (n: SceneNode): void => {
    if (n.id) {
      if (seen.has(n.id)) {
        throw new Error(
          `duplicate node id '#${n.id}' — a repeat-derived id collides with another node`,
        );
      }
      seen.add(n.id);
    }
    n.children.forEach(visit);
  };
  root.children.forEach(visit);
}
