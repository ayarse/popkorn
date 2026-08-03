import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import { buildSceneGraph } from "../scene/builder.js";
import type { SceneNode } from "../scene/types.js";
import { subtreeToken } from "./content-hash.js";

// The content token is what the raster cache keys on: equal tokens must mean
// equal draw calls for the subtree. These pin the propagation direction — a
// change anywhere below a node moves that node's token.

function scene(source: string): SceneNode {
  return buildSceneGraph(parse(source));
}

const SOURCE = `
:root { width: 200px; height: 200px; }
#group {
  type: group;
  > #a { type: circle; cx: 20px; cy: 20px; r: 10px; fill: #ff0000; }
  > #b { type: rect; x: 0px; y: 0px; width: 10px; height: 10px; fill: #00ff00; }
}
`;

test("the same resolved state hashes to the same token", () => {
  const root = scene(SOURCE);
  expect(subtreeToken(root)).toBe(subtreeToken(root));
  expect(subtreeToken(root)).toBe(subtreeToken(scene(SOURCE)));
});

test("a leaf's change moves its ancestors' token (dirty propagation)", () => {
  const root = scene(SOURCE);
  const group = root.children[0];
  const leaf = group.children[0];
  const before = subtreeToken(root);

  leaf.opacity = 0.5;
  expect(subtreeToken(group)).not.toBe(subtreeToken(scene(SOURCE).children[0]));
  expect(subtreeToken(root)).not.toBe(before);
});

test("shape geometry, paint and transform each move the token", () => {
  const root = scene(SOURCE);
  const leaf = root.children[0].children[0];
  const base = subtreeToken(root);

  const mutate = (f: () => void, undo: () => void) => {
    f();
    expect(subtreeToken(root)).not.toBe(base);
    undo();
    expect(subtreeToken(root)).toBe(base);
  };

  // biome-ignore lint/suspicious/noExplicitAny: circle shape data
  const circle = leaf.shapeData as any;
  mutate(
    () => {
      circle.r = 11;
    },
    () => {
      circle.r = 10;
    },
  );
  mutate(
    () => {
      leaf.fill = "#0000ff";
    },
    () => {
      leaf.fill = "#ff0000";
    },
  );
  mutate(
    () => {
      leaf.transform.rotate = 5;
    },
    () => {
      leaf.transform.rotate = 0;
    },
  );
  mutate(
    () => {
      leaf.filter = [{ type: "blur", radius: 3 }];
    },
    () => {
      leaf.filter = null;
    },
  );
});

test("a hidden subtree's churn leaves the token alone (it paints nothing)", () => {
  const root = scene(SOURCE);
  const group = root.children[0];
  group.hidden = true;
  const hidden = subtreeToken(root);

  group.children[0].opacity = 0.25;
  expect(subtreeToken(root)).toBe(hidden);
  group.hidden = false;
  expect(subtreeToken(root)).not.toBe(hidden);
});

test("sibling paint order is part of the token", () => {
  const root = scene(SOURCE);
  const group = root.children[0];
  const before = subtreeToken(root);
  group.children[1].zIndex = -1;
  group.sortedChildren = null;
  expect(subtreeToken(root)).not.toBe(before);
});
