import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import type { Renderer } from "./renderer/interface";
import { RenderLoop } from "./runtime/loop";
import type {
  MachineEvalContext,
  PointerTriggerEvent,
} from "./runtime/state-machine";
import { StateMachineRunner } from "./runtime/state-machine";
import { createVariableResolver } from "./runtime/variables";
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

// A runner bound to a freshly built scene, plus a helper to evaluate a frame.
function runnerFor(src: string) {
  const root = buildSceneGraph(parse(src));
  const resolver = createVariableResolver();
  resolver.setVariables(parse(src).variables);
  const runner = new StateMachineRunner();
  runner.setScene(root, 0);
  const evalFrame = (
    machineTime: number,
    opts: { pointerEvents?: PointerTriggerEvent[]; events?: string[] } = {},
  ) => {
    for (const e of opts.events ?? []) runner.enqueueEvent(e);
    const ctx: MachineEvalContext = {
      variableResolver: resolver,
      pointerEvents: opts.pointerEvents ?? [],
    };
    return runner.evaluate(machineTime, ctx);
  };
  return { root, runner, resolver, evalFrame };
}

// --- Builder compilation -----------------------------------------------------

test("builder compiles @machine onto the root and :state() sets onto nodes", () => {
  const src = `
    :root { width: 100px; height: 100px; --energy: 0; }
    @machine cat {
      initial: idle;
      state idle { to: excited on click(#hitbox); }
      state excited { to: idle on complete; }
    }
    #hitbox { type: rect; width: 20; height: 20; }
    #cat {
      type: circle; r: 5;
      &:state(idle) { animation: breathe 1s linear infinite; fill: #0f0; }
      &:state(cat.excited) { animation: jump 600ms linear; }
    }
    @keyframes breathe { 0% { opacity: 1 } 100% { opacity: 0.5 } }
    @keyframes jump { 0% { cx: 0 } 100% { cx: 100 } }
  `;
  const root = buildSceneGraph(parse(src));
  expect(root.machines.length).toBe(1);
  expect(root.machines[0].name).toBe("cat");

  const cat = find(root, "cat");
  expect(cat.stateStyles.length).toBe(2);
  const idle = cat.stateStyles.find((s) => s.name === "idle")!;
  expect(idle.machine).toBeNull(); // un-namespaced :state(idle)
  expect(idle.styles.fill).toBe("#0f0"); // static decl captured
  expect(idle.animations.length).toBe(1); // :state() carries its own animation
  const excited = cat.stateStyles.find((s) => s.name === "excited")!;
  expect(excited.machine).toBe("cat"); // namespaced :state(cat.excited)

  // Pointer-trigger target is flagged interactive so the hit-tester credits it.
  expect(find(root, "hitbox").interactive).toBe(true);
});

// --- Transition priority / declaration order ---------------------------------

test("declaration order is priority: the first passing transition wins", () => {
  const { runner, resolver, evalFrame } = runnerFor(`
    :root { width: 10px; height: 10px; --go: 0; }
    @machine m {
      initial: a;
      state a {
        to: first when style(--go > 0);
        to: second when style(--go > 0);
      }
      state first {}
      state second {}
    }
    #n { type: circle; r: 1; }
  `);
  resolver.setVariable("--go", 1); // both transitions now pass
  const out = evalFrame(0);
  expect(out).toEqual([
    { type: "statechange", machine: "m", from: "a", to: "first" },
  ]);
  expect(runner.currentState("m")).toBe("first");
});

// --- Guards: numeric var, equality, state-time -------------------------------

test("guards: numeric comparison against a --variable", () => {
  const { runner, resolver, evalFrame } = runnerFor(`
    :root { width: 10px; height: 10px; --energy: 0; }
    @machine m { initial: calm; state calm { to: hyper when style(--energy > 80); } state hyper {} }
    #n { type: circle; r: 1; }
  `);
  evalFrame(0);
  expect(runner.currentState("m")).toBe("calm"); // 0 is not > 80
  resolver.setVariable("--energy", 90);
  evalFrame(16);
  expect(runner.currentState("m")).toBe("hyper");
});

test("guards: input(media.*) resolves through VariableResolver (wired for free)", () => {
  // media.* used to be unwired in the machine's own input reader (always 0);
  // routing guard input() through VariableResolver.resolveInput picks up the
  // media resolver. Stub matchMedia so prefers-reduced-motion reads 1.
  const prev = (globalThis as { matchMedia?: unknown }).matchMedia;
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({
    matches: true,
  });
  try {
    const { runner, evalFrame } = runnerFor(`
      :root { width: 10px; height: 10px; }
      @machine m {
        initial: motion;
        state motion { to: still when style(input(media.prefers-reduced-motion): 1); }
        state still {}
      }
      #n { type: circle; r: 1; }
    `);
    evalFrame(0);
    expect(runner.currentState("m")).toBe("still"); // guard saw the media value
  } finally {
    (globalThis as { matchMedia?: unknown }).matchMedia = prev;
  }
});

test("guards: state-time drives a timeout", () => {
  const { runner, evalFrame } = runnerFor(`
    :root { width: 10px; height: 10px; }
    @machine m { initial: wait; state wait { to: done when style(state-time > 2s); } state done {} }
    #n { type: circle; r: 1; }
  `);
  evalFrame(1000);
  expect(runner.currentState("m")).toBe("wait"); // 1000ms in state, not > 2000
  evalFrame(2500); // 2500ms since entry (entry was 0)
  expect(runner.currentState("m")).toBe("done");
});

// --- Any-state -----------------------------------------------------------------

test("any-state (*) transitions are checked before the current state", () => {
  const { runner, evalFrame } = runnerFor(`
    :root { width: 10px; height: 10px; }
    @machine m {
      initial: a;
      state a { to: b on event(next); }
      state b { to: a on event(next); }
      state * { to: reset on event(panic); }
    }
    #n { type: circle; r: 1; }
  `);
  evalFrame(0, { events: ["next"] });
  expect(runner.currentState("m")).toBe("b");
  evalFrame(16, { events: ["panic"] }); // any-state wins from any state
  expect(runner.currentState("m")).toBe("reset");
});

// --- Trigger consumption / momentariness --------------------------------------

test("external events are momentary: consumed after one evaluate", () => {
  const { runner, evalFrame } = runnerFor(`
    :root { width: 10px; height: 10px; }
    @machine m { initial: a; state a { to: b on event(go); } state b { to: a on event(go); } }
    #n { type: circle; r: 1; }
  `);
  evalFrame(0, { events: ["go"] });
  expect(runner.currentState("m")).toBe("b");
  evalFrame(16); // no event re-queued
  expect(runner.currentState("m")).toBe("b"); // stayed put — event was consumed
});

// --- Pointer triggers: click + target bubbling --------------------------------

test("pointer click matches its target, including bubbling to an ancestor target", () => {
  const { root, runner, evalFrame } = runnerFor(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: off; state off { to: on on click(#box); } state on {} }
    #box { type: group; > #inner { type: rect; width: 10; height: 10; } }
  `);
  const inner = find(root, "inner");
  // A click credited to a descendant of #box still fires click(#box) (bubbling).
  evalFrame(0, { pointerEvents: [{ event: "click", node: inner }] });
  expect(runner.currentState("m")).toBe("on");
});

// --- `on complete` -------------------------------------------------------------

test("on complete fires when the state's animations have finished", () => {
  const { runner, evalFrame } = runnerFor(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: intro; state intro { to: idle on complete; } state idle {} }
    #hero {
      type: circle; r: 5;
      &:state(intro) { animation: slide 600ms linear; }
    }
    @keyframes slide { 0% { cx: 0 } 100% { cx: 100 } }
  `);
  evalFrame(300);
  expect(runner.currentState("m")).toBe("intro"); // 300ms < 600ms end
  evalFrame(700);
  expect(runner.currentState("m")).toBe("idle"); // past the 600ms completion
});

test("on complete never fires for a state with no animations", () => {
  const { runner, evalFrame } = runnerFor(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: idle; state idle { to: other on complete; } state other {} }
    #n { type: circle; r: 1; }
  `);
  evalFrame(100000);
  expect(runner.currentState("m")).toBe("idle"); // empty state has no completion moment
});

// --- Loop integration: entry-anchored state animations + seek purity ----------

const loopScene = `
  :root { width: 100px; height: 100px; }
  @machine m { initial: a; state a { to: b on event(go); } state b {} }
  #dot {
    type: circle; r: 5;
    &:state(b) { animation: slide 1000ms linear; }
  }
  @keyframes slide { 0% { cx: 0 } 100% { cx: 100 } }
`;

function loopFor(src: string) {
  const root = buildSceneGraph(parse(src));
  const loop = new RenderLoop(stubRenderer);
  loop.setScene(root);
  loop.getVariableResolver().setVariables(parse(src).variables);
  return { root, loop };
}

test("state animations restart at the state entry time, not timeline zero", () => {
  const { root, loop } = loopFor(loopScene);
  const runner = loop.getStateMachineRunner();

  // Before entering b, no state animation applies (cx stays at base 0).
  loop.seek(1000);
  expect(cx(root, "dot")).toBeCloseTo(0);

  // Enter b at machineTime 500 (as the live loop would).
  runner.enqueueEvent("go");
  runner.evaluate(500, {
    variableResolver: loop.getVariableResolver(),
    pointerEvents: [],
  });
  expect(runner.currentState("m")).toBe("b");

  // The slide is anchored at entry (500): machineTime 500 -> progress 0.
  loop.seek(500);
  expect(cx(root, "dot")).toBeCloseTo(0);
  loop.seek(1000); // 500ms since entry -> halfway
  expect(cx(root, "dot")).toBeCloseTo(50);
  loop.seek(1500); // 1000ms since entry -> end
  expect(cx(root, "dot")).toBeCloseTo(100);
});

test("seek purity: same time + same machine state gives identical frames", () => {
  const { root, loop } = loopFor(loopScene);
  const runner = loop.getStateMachineRunner();
  runner.enqueueEvent("go");
  runner.evaluate(500, {
    variableResolver: loop.getVariableResolver(),
    pointerEvents: [],
  });

  loop.seek(1000);
  const first = cx(root, "dot");
  loop.seek(0); // move away
  loop.seek(1000); // and back — machine state unchanged
  const second = cx(root, "dot");
  expect(second).toBeCloseTo(first);
  expect(second).toBeCloseTo(50);
});

// --- animation-timeline scrubbing via a variable ------------------------------

test("animation-timeline scrubs a node's animation to a var()-supplied 0..1", () => {
  const { root, loop } = loopFor(`
    :root { width: 100px; height: 100px; --p: 0; }
    #bar {
      type: circle; r: 5;
      animation: fill 1000ms linear;
      animation-timeline: var(--p);
    }
    @keyframes fill { 0% { cx: 0 } 100% { cx: 100 } }
  `);
  const resolver = loop.getVariableResolver();

  resolver.setVariable("--p", 0.25);
  loop.seek(9999); // clock ignored; progress comes from --p
  expect(cx(root, "bar")).toBeCloseTo(25);

  resolver.setVariable("--p", 0.8);
  loop.seek(0);
  expect(cx(root, "bar")).toBeCloseTo(80);
});

// --- mix cross-fades ----------------------------------------------------------

// A machine whose `a -> b` transition carries `mix <clause>`; `b` drives the
// dot's cx to 100 (base 0), so the blended cx directly reads the mix weight.
const mixScene = (transition: string) => `
  :root { width: 100px; height: 100px; }
  @machine m { initial: a; state a { to: b on event(go)${transition}; } state b {} }
  #dot { type: circle; r: 5; cx: 0; &:state(b) { cx: 100; } }
`;

// Enter state b at machineTime 500 (as the live loop would), returning the loop.
function enterB(src: string) {
  const { root, loop } = loopFor(src);
  const runner = loop.getStateMachineRunner();
  runner.enqueueEvent("go");
  runner.evaluate(500, {
    variableResolver: loop.getVariableResolver(),
    pointerEvents: [],
  });
  expect(runner.currentState("m")).toBe("b");
  return { root, loop };
}

test("mix: linear cross-fade blends the incoming state over the window", () => {
  const { root, loop } = enterB(mixScene(" mix 1000ms"));
  loop.seek(500); // entry: progress 0 -> outgoing (base cx 0)
  expect(cx(root, "dot")).toBeCloseTo(0);
  loop.seek(1000); // 500ms in -> halfway
  expect(cx(root, "dot")).toBeCloseTo(50);
  loop.seek(1500); // window end -> fully incoming
  expect(cx(root, "dot")).toBeCloseTo(100);
  loop.seek(3000); // well past the window -> steady incoming
  expect(cx(root, "dot")).toBeCloseTo(100);
});

test("mix: no mix clause is a hard cut (no blend)", () => {
  const { root, loop } = enterB(mixScene(""));
  loop.seek(500); // the instant of entry already shows the full incoming value
  expect(cx(root, "dot")).toBeCloseTo(100);
  loop.seek(750);
  expect(cx(root, "dot")).toBeCloseTo(100);
});

test("mix: easing shapes the blend (ease-in trails linear at mid-window)", () => {
  const linear = enterB(mixScene(" mix 1000ms linear"));
  linear.loop.seek(1000);
  const linearMid = cx(linear.root, "dot");

  const eased = enterB(mixScene(" mix 1000ms ease-in"));
  eased.loop.seek(1000); // same raw progress 0.5, but ease-in is slow early
  const easedMid = cx(eased.root, "dot");

  expect(linearMid).toBeCloseTo(50);
  expect(easedMid).toBeLessThan(linearMid - 5);
  expect(easedMid).toBeGreaterThan(0);
});

test("mix: determinism — seek(t) twice yields identical blended frames", () => {
  const { root, loop } = enterB(mixScene(" mix 1000ms ease-in-out"));
  loop.seek(1000);
  const first = cx(root, "dot");
  loop.seek(0); // move away
  loop.seek(1000); // and back — machine state unchanged
  expect(cx(root, "dot")).toBeCloseTo(first);
});

test("mix: an interrupting transition drops the old outgoing contribution", () => {
  // a -> b (mix), then b -> a (mix) mid-window. The second mix must blend from
  // the current b contribution, not resurrect the original `a` outgoing.
  const src = `
    :root { width: 100px; height: 100px; }
    @machine m {
      initial: a;
      state a { to: b on event(go) mix 1000ms; }
      state b { to: a on event(back) mix 1000ms; }
    }
    #dot { type: circle; r: 5; cx: 0; &:state(b) { cx: 100; } }
  `;
  const { root, loop } = loopFor(src);
  const runner = loop.getStateMachineRunner();
  const resolver = loop.getVariableResolver();
  runner.enqueueEvent("go");
  runner.evaluate(500, { variableResolver: resolver, pointerEvents: [] });
  loop.seek(1000); // halfway into a->b: cx ~50
  expect(cx(root, "dot")).toBeCloseTo(50);
  // Interrupt back to a at machineTime 1000; new mix fades from b (cx ~100)
  // toward a (cx 0). At its own entry (progress 0) it shows the b value.
  runner.enqueueEvent("back");
  runner.evaluate(1000, { variableResolver: resolver, pointerEvents: [] });
  loop.seek(1000);
  expect(cx(root, "dot")).toBeCloseTo(100);
  loop.seek(1500); // halfway back
  expect(cx(root, "dot")).toBeCloseTo(50);
  loop.seek(2000); // fully back to a
  expect(cx(root, "dot")).toBeCloseTo(0);
});
