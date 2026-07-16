import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import type { Renderer } from "./renderer/interface";
import { RenderLoop } from "./runtime/loop";
import { buildSceneGraph } from "./scene/builder";
import type { CircleData, SceneNode } from "./scene/types";

const stubRenderer = new Proxy(
  {},
  { get: () => () => 0 },
) as unknown as Renderer;

const find = (n: SceneNode, id: string): SceneNode => {
  if (n.id === id) return n;
  for (const c of n.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined as unknown as SceneNode;
};
const cx = (root: SceneNode, id: string) =>
  (find(root, id).shapeData as CircleData).cx;

// A machine drives `time-remap` on the #master group (a scalar animatable): the
// `seg` keyframes scrub the local timeline over the master range while `play` is
// active. The child #child sweeps cx 0->100 over that same range, so its cx is a
// direct readout of the remapped local time.
const scene = `
  :root { width: 100px; height: 100px; }
  @keyframes seg { from { time-remap: 0s; } to { time-remap: 1s; } }
  @keyframes sweep { 0% { cx: 0 } 100% { cx: 100 } }
  @machine m {
    initial: idle;
    state idle { to: play on event(go); }
    state play { to: idle on event(stop); }
  }
  #master {
    type: group;
    &:state(play) { animation: seg 1000ms linear infinite; }
    > #child {
      type: circle; r: 5;
      animation: sweep 1000ms linear;
      animation-fill-mode: both;
    }
  }
`;

function loopFor(src: string) {
  const root = buildSceneGraph(parse(src));
  const loop = new RenderLoop(stubRenderer);
  loop.setScene(root);
  loop.getVariableResolver().setVariables(parse(src).variables);
  return { root, loop };
}

// Enter `play` at machineTime 500 (as the live loop would).
function enterPlay(src: string) {
  const { root, loop } = loopFor(src);
  const runner = loop.getStateMachineRunner();
  runner.enqueueEvent("go");
  runner.evaluate(500, {
    variableResolver: loop.getVariableResolver(),
    pointerEvents: [],
  });
  expect(runner.currentState("m")).toBe("play");
  return { root, loop, runner };
}

test("time-remap is animatable: a machine state scrubs the descendant window", () => {
  const { root, loop } = enterPlay(scene);
  // seg is entry-anchored at 500. At entry the remap is 0s -> child local 0.
  loop.seek(500);
  expect(cx(root, "child")).toBeCloseTo(0);
  loop.seek(1000); // 500ms into seg -> remap 500ms -> child halfway
  expect(cx(root, "child")).toBeCloseTo(50);
  loop.seek(1400); // 900ms in -> remap 900ms -> child near end
  expect(cx(root, "child")).toBeCloseTo(90);
  loop.seek(1500); // 1000ms in -> infinite seg wraps -> back to window start
  expect(cx(root, "child")).toBeCloseTo(0);
});

test("time-remap determinism: seek(t) twice (with a move-away) gives identical frames", () => {
  // This is the reorder trap: reading local-time before the :state() merge picks
  // up the previous frame's stale scalar, so the two seek(1000)s diverge.
  const { root, loop } = enterPlay(scene);
  loop.seek(1000);
  const first = cx(root, "child");
  loop.seek(0); // move away
  loop.seek(1000); // and back — machine state unchanged
  const second = cx(root, "child");
  expect(second).toBeCloseTo(first);
  expect(second).toBeCloseTo(50);
});

test("leaving the state clears the scalar (no stuck remap)", () => {
  const { root, loop, runner } = enterPlay(scene);
  loop.seek(1000);
  expect(find(root, "master").timeRemapValue).toBeCloseTo(500);

  // Back to idle: no state sets time-remap, so the scalar resets to base (null)
  // and the child samples on its own inherited time again (t=300 -> cx 30).
  runner.enqueueEvent("stop");
  runner.evaluate(1500, {
    variableResolver: loop.getVariableResolver(),
    pointerEvents: [],
  });
  expect(runner.currentState("m")).toBe("idle");
  loop.seek(300);
  expect(find(root, "master").timeRemapValue).toBeNull();
  expect(cx(root, "child")).toBeCloseTo(30);
});

test("a static bare <time> pins the local timeline (constant remap scalar)", () => {
  const { root, loop } = loopFor(`
    :root { width: 100px; height: 100px; }
    @keyframes sweep { 0% { cx: 0 } 100% { cx: 100 } }
    #pinned {
      type: group; time-remap: 0.75s;
      > #c { type: circle; r: 5; animation: sweep 1000ms linear; animation-fill-mode: both; }
    }
  `);
  // Whatever the clock, local time is pinned to 750ms -> cx 75.
  loop.seek(200);
  expect(cx(root, "c")).toBeCloseTo(75);
  loop.seek(9000);
  expect(cx(root, "c")).toBeCloseTo(75);
});
