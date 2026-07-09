import { expect, test } from "bun:test";
import { parse } from "@popcorn/parser";
import { AnimationScheduler } from "./animation/scheduler";
import { buildSceneGraph } from "./scene/builder";
import type { SceneNode } from "./scene/types";
import { resetNodeToBase } from "./scene/types";

// A comma-separated `animation` shorthand must build one AnimationInstance per
// group, each with its own keyframes/timing. This is the converter's per-channel
// emission target: transform channels with differing keyframe times/easing land
// as independent animations that layer without clobbering.

function findNode(root: SceneNode, id: string): SceneNode {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return undefined as unknown as SceneNode;
}

const SRC = `
:root { width: 100px; height: 100px; }

/* translate holds at its start value until 100% (step-end) */
@keyframes slide {
  0% { transform: translate(0px, 0px); animation-timing-function: step-end; }
  100% { transform: translate(100px, 0px); }
}
/* rotate eases linearly across the whole span */
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(90deg); }
}

#n {
  type: circle;
  r: 5px;
  animation: slide 1s linear 1, spin 1s linear 1;
}
`;

test("comma-list animation builds one instance per group", () => {
  const node = findNode(buildSceneGraph(parse(SRC)), "n");
  expect(node.animations).toHaveLength(2);
  expect(node.animations.map((a) => a.name)).toEqual(["slide", "spin"]);
});

test("per-channel easing is independent (step-end translate vs linear rotate)", () => {
  const node = findNode(buildSceneGraph(parse(SRC)), "n");
  const scheduler = new AnimationScheduler();

  resetNodeToBase(node);
  scheduler.sampleNode(node, 500); // halfway through both 1s animations

  // slide uses step-end: translateX still held at its 0% value.
  expect(node.transform.translateX).toBe(0);
  // spin is linear and untouched by slide: rotate is halfway.
  expect(node.transform.rotate).toBe(45);
});

test("the two animations touch distinct components (no clobber at the end)", () => {
  const node = findNode(buildSceneGraph(parse(SRC)), "n");
  const scheduler = new AnimationScheduler();

  resetNodeToBase(node);
  scheduler.sampleNode(node, 1000);

  expect(node.transform.translateX).toBe(100);
  expect(node.transform.rotate).toBe(90);
});

// --- animation-* longhands (WP7) --------------------------------------------
// The longhands compose with the shorthand per CSS: later declarations win
// per sub-property; the shorthand resets the whole list.

const build1 = (decls: string) =>
  findNode(
    buildSceneGraph(
      parse(
        `@keyframes blink { 0% { opacity: 1; } 100% { opacity: 0; } }\n#n { type: circle; r: 5px; ${decls} }`,
      ),
    ),
    "n",
  );

test("longhands alone (name + duration) build an animation", () => {
  const node = build1("animation-name: blink; animation-duration: 2s;");
  expect(node.animations).toHaveLength(1);
  expect(node.animations[0].name).toBe("blink");
  expect(node.animations[0].duration).toBe(2000);
});

test("a longhand overrides an earlier shorthand (later wins)", () => {
  const node = build1("animation: blink 1s; animation-duration: 2s;");
  expect(node.animations).toHaveLength(1);
  expect(node.animations[0].duration).toBe(2000);
});

test("a shorthand resets an earlier longhand", () => {
  // animation-duration:2s is wiped by the later shorthand, which sets 1s.
  const node = build1("animation-duration: 2s; animation: blink 1s;");
  expect(node.animations).toHaveLength(1);
  expect(node.animations[0].duration).toBe(1000);
});

test("longhands cycle positionally across a two-animation list", () => {
  const node = build1(
    "animation-name: blink, blink; animation-duration: 1s, 2s; animation-iteration-count: infinite;",
  );
  expect(node.animations).toHaveLength(2);
  expect(node.animations[0].duration).toBe(1000);
  expect(node.animations[1].duration).toBe(2000);
  // A single iteration-count cycles onto both animations.
  expect(node.animations[0].iterationCount).toBe(Infinity);
  expect(node.animations[1].iterationCount).toBe(Infinity);
});
