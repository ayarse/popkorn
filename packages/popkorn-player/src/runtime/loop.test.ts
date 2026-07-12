import { expect, test } from "bun:test";
import { parse } from "@popkorn/parser";
import type { Renderer } from "../renderer/interface";
import type {
  Color,
  GradientData,
  Matrix3x3,
  PathCommand,
  ResolvedClip,
  TrimDescriptor,
} from "../renderer/types";
import { IDENTITY_MATRIX } from "../renderer/types";
import { buildSceneGraph } from "../scene/builder";
import type {
  AnimationInstance,
  CircleData,
  FillRule,
  MaskMode,
  SceneNode,
  StrokeLineCap,
  TextAnchor,
} from "../scene/types";
import { createSceneNode, snapshotNode } from "../scene/types";
import { RenderLoop } from "./loop";
import { createVariableResolver } from "./variables";

// A dot whose opacity ramps 0 -> 1 over one 3s iteration, forever. sceneDuration
// is that single iteration (3000). The recording renderer captures the sampled
// opacity as the first (only) setOpacity call per frame.
function fadingDot(): SceneNode {
  const node = createSceneNode("dot", "circle");
  node.shapeData = { type: "circle", cx: 0, cy: 0, r: 10 };
  node.opacity = 0;
  node.base = snapshotNode(node);
  const fade: AnimationInstance = {
    name: "fade",
    duration: 3000,
    timingFunction: "linear",
    iterationCount: Infinity,
    direction: "normal",
    delay: 0,
    fillMode: "forwards",
    keyframes: [
      { offset: 0, properties: { opacity: 0 } },
      { offset: 1, properties: { opacity: 1 } },
    ],
  };
  node.animations = [fade];
  return node;
}

// Minimal no-op renderer that records setOpacity calls (in draw order) and
// counts frames (beginFrame calls) so tests can assert that a repaint happened.
function createRecordingRenderer(): Renderer & {
  opacities: number[];
  fills: (Color | null)[];
  texts: string[];
  frames: number;
} {
  return {
    opacities: [],
    fills: [],
    texts: [],
    frames: 0,
    clear() {},
    beginFrame() {
      this.frames++;
    },
    endFrame() {},
    drawRect() {},
    drawCircle() {},
    drawEllipse() {},
    drawPath(_c: PathCommand[]) {},
    drawText(text: string) {
      this.texts.push(text);
    },
    drawImage() {},
    clip(_c: ResolvedClip) {},
    compositeMask(_m: MaskMode, drawContent: () => void, drawMask: () => void) {
      drawContent();
      drawMask();
    },
    setFill(c: Color | null) {
      this.fills.push(c);
    },
    setFillGradient(_g: GradientData | null) {},
    setStroke(_c: Color | null, _w: number) {},
    setStrokeGradient(_g: GradientData | null) {},
    setStrokeLineCap(_c: StrokeLineCap) {},
    setStrokeLineJoin() {},
    setStrokeMiterLimit() {},
    setTrim(_t: TrimDescriptor | null) {},
    setDash() {},
    setFillRule(_r: FillRule) {},
    setPaintOrder() {},
    setOpacity(opacity: number) {
      this.opacities.push(opacity);
    },
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    setTransform(_m: Matrix3x3) {},
    getWidth() {
      return 100;
    },
    getHeight() {
      return 100;
    },
  };
}

test("render walk: group opacity cascades multiplicatively to children", () => {
  const parent = createSceneNode("parent", "group");
  parent.opacity = 0.5;
  parent.base = snapshotNode(parent);

  const child = createSceneNode("child", "circle");
  child.shapeData = { type: "circle", cx: 0, cy: 0, r: 10 };
  child.opacity = 0.6;
  child.base = snapshotNode(child);
  child.parent = parent;
  parent.children.push(child);

  const renderer = createRecordingRenderer();
  const loop = new RenderLoop(renderer);
  loop.setScene(parent);
  loop.seek(0); // resolves + draws one frame while stopped

  // Parent draws at its own opacity (0.5); child's effective opacity is the
  // product of the inherited parent alpha and its own opacity (0.5 * 0.6).
  expect(renderer.opacities[0]).toBeCloseTo(0.5, 6);
  expect(renderer.opacities[1]).toBeCloseTo(0.3, 6);
});

// Regression: seek(t) must repaint synchronously even while paused-and-running.
// A paused loop keeps its rAF alive for interaction, but a backgrounded tab
// throttles rAF to nothing, so seek can't defer the repaint to the next frame —
// the displayed frame would stay stale (invariant 4: seek is a pure function of
// time, and that includes what's on the canvas).
test("seek repaints synchronously while paused (does not wait for the next rAF)", () => {
  // Stub rAF so start() can flip the loop to "running" without ever delivering a
  // real frame afterwards — modelling a throttled/backgrounded tab.
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
  };
  const prevRaf = g.requestAnimationFrame;
  g.requestAnimationFrame = () => 0; // schedule, but never call back

  try {
    const node = createSceneNode("dot", "circle");
    node.shapeData = { type: "circle", cx: 0, cy: 0, r: 10 };
    node.base = snapshotNode(node);

    const renderer = createRecordingRenderer();
    const loop = new RenderLoop(renderer);
    loop.setScene(node);
    loop.start(); // one synchronous frame, then a rAF that never fires
    loop.pause(); // frozen, but still "running"
    expect(loop.paused).toBe(true);
    expect(loop.running).toBe(true);

    const before = renderer.frames;
    loop.seek(500);
    // Exactly one repaint happened right now, without any rAF tick.
    expect(renderer.frames).toBe(before + 1);
    expect(loop.currentTime).toBe(500);
  } finally {
    g.requestAnimationFrame = prevRaf;
  }
});

// Loop OFF: past the scene duration the timeline holds at the end of one full
// pass ("play once and stop") — an infinite animation must NOT keep cycling.
// (Paused first, mirroring the demo's scrub flow, so currentTime is exact rather
// than free-running by wall clock.)
test("loop off: time past duration clamps to sceneDuration", () => {
  const renderer = createRecordingRenderer();
  const loop = new RenderLoop(renderer);
  loop.setScene(fadingDot()); // sceneDuration = 3000, loop defaults off
  loop.pause();

  loop.seek(3000);
  const opacityAtEnd = renderer.opacities.at(-1)!;
  expect(loop.currentTime).toBe(3000);

  // Seek well past the end: currentTime and the sampled frame both hold at 3000
  // (not a later point on the still-cycling infinite ramp).
  loop.seek(9000);
  expect(loop.currentTime).toBe(3000);
  expect(renderer.opacities.at(-1)!).toBe(opacityAtEnd);

  // Idempotent (invariant 4): seeking further past the end gives the same frame.
  loop.seek(12000);
  expect(loop.currentTime).toBe(3000);
  expect(renderer.opacities.at(-1)!).toBe(opacityAtEnd);
});

// `complete` fires exactly once when a play-once timeline first passes its end,
// stays latched across held-at-end frames, and re-arms after a seek back inside.
test("complete fires once at end, re-fires after seek-back", () => {
  const loop = new RenderLoop(createRecordingRenderer());
  loop.setScene(fadingDot()); // sceneDuration = 3000, loop off
  loop.pause();

  let completes = 0;
  loop.setCompleteCallback(() => completes++);

  loop.seek(1000); // inside the clip — no completion
  expect(completes).toBe(0);

  loop.seek(9000); // past the end — fires once
  expect(completes).toBe(1);

  loop.seek(12000); // still past — latched, no re-fire
  expect(completes).toBe(1);

  loop.seek(500); // back inside — re-arms
  loop.seek(9000); // past again — fires once more
  expect(completes).toBe(2);
});

// A looping scene never "completes" — the timeline wraps instead of ending.
test("complete never fires while looping", () => {
  const loop = new RenderLoop(createRecordingRenderer());
  loop.setScene(fadingDot());
  loop.setLoop(true);

  let completes = 0;
  loop.setCompleteCallback(() => completes++);

  loop.seek(4000);
  loop.seek(7000);
  expect(completes).toBe(0);
});

// Loop ON: past the duration the timeline wraps back into [0, duration) so the
// animation keeps cycling. (Not paused — the wrap only runs on a live timeline.)
test("loop on: time past duration wraps", () => {
  const renderer = createRecordingRenderer();
  const loop = new RenderLoop(renderer);
  loop.setScene(fadingDot());
  loop.setLoop(true);

  loop.seek(4000); // 4000 % 3000 = 1000 -> one third through the ramp
  expect(loop.currentTime).toBeCloseTo(1000, 0);
  expect(renderer.opacities.at(-1)!).toBeCloseTo(1000 / 3000, 3);

  // Turning loop back off then seeking past the end freezes at the duration.
  loop.setLoop(false);
  loop.pause();
  loop.seek(8000);
  expect(loop.currentTime).toBe(3000);
});

// --- state-machine scenes are unbounded --------------------------------------

// A machine scene has a base animation (#bg) giving sceneDuration = 1000, plus a
// one-shot state animation on #dot that ends at 1000 and holds (default `both`).
// The machine's initial state is active from setScene, so #dot's slide is live.
function machineScene(dotFill = ""): SceneNode {
  return buildSceneGraph(
    parse(`
    :root { width: 100px; height: 100px; }
    @machine m { initial: a; state a {} }
    #bg  { type: circle; r: 5; animation: pulse 1000ms linear; }
    #dot { type: circle; r: 5; &:state(a) { animation: slide 1000ms linear${dotFill}; } }
    @keyframes pulse { 0% { cx: 0 } 100% { cx: 10 } }
    @keyframes slide { 0% { cx: 0 } 100% { cx: 100 } }
  `),
  );
}
const nodeCx = (root: SceneNode, id: string): number => {
  const find = (n: SceneNode): SceneNode | undefined =>
    n.id === id ? n : n.children.map(find).find(Boolean);
  return (find(root)!.shapeData as CircleData).cx;
};

// The loop attribute is inert for a machine scene: the clock is monotonic (no
// wrap), so the state animation's entry anchor never folds negative and replays.
// Without the fix, seeking to 2000 would wrap to 0 and re-run the slide.
test("machine scene: loop enabled does not wrap past sceneDuration", () => {
  const root = machineScene();
  const loop = new RenderLoop(createRecordingRenderer());
  loop.setScene(root);
  loop.setLoop(true);

  loop.seek(2000); // past sceneDuration (1000)
  expect(loop.currentTime).toBeCloseTo(2000, 0); // monotonic — NOT folded to 1000/0
  expect(nodeCx(root, "dot")).toBeCloseTo(100); // slide held at end, not replayed
});

// isStatic (the "finished/settled" signal) is never true for a machine scene —
// it can always still transition — even well past the base duration.
test("machine scene: isStatic never becomes true (never finishes)", () => {
  const loop = new RenderLoop(createRecordingRenderer());
  loop.setScene(machineScene());
  loop.seek(5000);
  expect(loop.isStatic()).toBe(false);
});

// Contrast (regression guard for task 1's fence): a plain scene with no machine
// still wraps exactly as before — proven by the existing 'loop on: time past
// duration wraps' test above; this one just pins the non-loop clamp still holds.
test("non-machine scene still clamps past duration (unchanged)", () => {
  const loop = new RenderLoop(createRecordingRenderer());
  loop.setScene(fadingDot()); // no machine, sceneDuration 3000
  loop.pause();
  loop.seek(9000);
  expect(loop.currentTime).toBe(3000); // still clamped, not free-running
});

// A one-shot state animation with the default (unwritten) fill holds its final
// keyframe after completion for as long as the state stays active — loop OFF, so
// the hold comes from `both`, not from wrapping.
test("state animation with default fill holds its final frame after completion", () => {
  const root = machineScene();
  const loop = new RenderLoop(createRecordingRenderer());
  loop.setScene(root); // loop off
  loop.seek(3000); // slide ended at 1000; state still `a`
  expect(nodeCx(root, "dot")).toBeCloseTo(100);
});

// An explicit `animation-fill-mode: none` in a state block is respected: the
// state animation snaps back to base (cx 0) on completion.
test("state animation with explicit fill:none snaps back to base on completion", () => {
  const root = machineScene("; animation-fill-mode: none");
  const loop = new RenderLoop(createRecordingRenderer());
  loop.setScene(root);
  loop.seek(3000); // past the 1000ms end
  expect(nodeCx(root, "dot")).toBeCloseTo(0);
});

// Chained track matte: a masked content whose matte SOURCE is itself masked.
// The source must composite against its own matte (a nested compositeMask), not
// paint whole — otherwise the source's full shape leaks into the alpha channel
// and the content spills far past its intended region (the Mail Box regression:
// a matte source's shape flooded the canvas). Two composites must run: the outer
// content->source, and the nested source->source2.
test("chained matte: a matte source with its own mask composites nested, not solid", () => {
  const sheet = parse(`
    :root { width: 100px; height: 100px; }
    #wrap {
      type: group;
      > #content { type: rect; x: 0; y: 0; width: 50px; height: 50px; fill: #ff0000; mask: #src alpha; }
      > #src { type: rect; x: 0; y: 0; width: 50px; height: 50px; fill: #00ff00; mask: #src2 alpha; }
      > #src2 { type: rect; x: 0; y: 0; width: 30px; height: 30px; fill: #0000ff; }
    }
  `);
  const root = buildSceneGraph(sheet);
  let composites = 0;
  const renderer = createRecordingRenderer();
  renderer.compositeMask = (
    _m: MaskMode,
    drawContent: () => void,
    drawMask: () => void,
  ) => {
    composites++;
    drawContent();
    drawMask();
  };
  const loop = new RenderLoop(renderer);
  loop.setScene(root);
  loop.seek(0);
  expect(composites).toBe(2); // outer content->src, nested src->src2 (was 1 before the fix)
});

// Regression: a quick tap whose press AND release both land between two live
// frames must still fire a machine click(). The loop samples cursor.isDown once
// per live frame; without the `pressed` edge latch (set by the input layer on
// press, consumed here) the rising edge is lost — isDown reads false at sample
// time — so pointerdown/click never fire. This is the Expo/RN "tapping a shape
// does nothing" bug: onResponderGrant+Release beat the next rAF tick.
test("tap between frames fires machine click (pressed edge latch)", () => {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const prevRaf = g.requestAnimationFrame;
  const prevCancel = g.cancelAnimationFrame;
  const q: ((t: number) => void)[] = [];
  g.requestAnimationFrame = (cb) => q.push(cb);
  g.cancelAnimationFrame = () => {};
  try {
    const root = buildSceneGraph(
      parse(`
        :root { width: 100px; height: 100px; }
        @machine m { initial: off; state off { to: on on click(#bulb); } state on {} }
        #bulb { type: circle; cx: 50; cy: 50; r: 50; }
      `),
    );
    const loop = new RenderLoop(createRecordingRenderer());
    loop.setScene(root);
    loop.start(); // live frame 0, schedules frame 1

    // Emulate the input layer for a tap that lands entirely between frames:
    // grant sets position + isDown + the pressed latch, release clears isDown.
    const cursor = loop.getInputTracker().getState().cursor;
    cursor.x = 50;
    cursor.y = 50;
    cursor.isDown = true;
    cursor.pressed = true; // set by InputTracker.handleMouseDown / RN onTouch
    cursor.isDown = false; // release before the next frame samples

    q.shift()?.(16); // live frame 1 — detects the latched tap

    expect(loop.getStateMachineRunner().currentState("m")).toBe("on");
    expect(cursor.pressed).toBe(false); // latch consumed exactly once
    loop.stop();
  } finally {
    g.requestAnimationFrame = prevRaf;
    g.cancelAnimationFrame = prevCancel;
  }
});

// --- typed var() bindings (colors + strings) ---------------------------------

// Build a scene, wire :root vars into a fresh resolver, and drive one frame.
function loadWithResolver(src: string) {
  const ast = parse(src);
  const resolver = createVariableResolver();
  resolver.setVariables(ast.variables);
  const renderer = createRecordingRenderer();
  const loop = new RenderLoop(renderer, undefined, undefined, resolver);
  loop.setScene(buildSceneGraph(ast));
  return { loop, renderer, resolver };
}

test("var() carries a color into fill; host setVariable re-resolves it", () => {
  const { loop, renderer, resolver } = loadWithResolver(
    `:root { --accent: #ff5533; }
     #box { type: rect; width: 10; height: 10; fill: var(--accent); }`,
  );
  loop.seek(0);
  // The last solid fill this frame is the resolved accent color.
  expect(renderer.fills.at(-1)).toBe("#ff5533");

  // A host color override (string) re-resolves through the binding step.
  renderer.fills.length = 0;
  resolver.setVariable("accent", "#00aa88");
  loop.seek(0);
  expect(renderer.fills.at(-1)).toBe("#00aa88");
});

test("named-color var() normalizes to hex in a paint slot", () => {
  const { loop, renderer } = loadWithResolver(
    `:root { --c: tomato; }
     #box { type: rect; width: 10; height: 10; fill: var(--c); }`,
  );
  loop.seek(0);
  expect(renderer.fills.at(-1)).toBe("#ff6347");
});

test("var() carries a string into text content; host update re-resolves", () => {
  const { loop, renderer, resolver } = loadWithResolver(
    `:root { --label: "Hi"; }
     #t { type: text; content: var(--label); }`,
  );
  loop.seek(0);
  expect(renderer.texts.at(-1)).toBe("Hi");

  renderer.texts.length = 0;
  resolver.setVariable("label", "Bye");
  loop.seek(0);
  expect(renderer.texts.at(-1)).toBe("Bye");
});

test("a string var in a numeric slot degrades to 0 (graceful)", () => {
  const { loop, renderer } = loadWithResolver(
    `:root { --oops: "not a number"; }
     #box { type: rect; width: 10; height: 10; fill: #000; opacity: var(--oops); }`,
  );
  loop.seek(0);
  expect(renderer.opacities.at(-1)).toBe(0);
});
