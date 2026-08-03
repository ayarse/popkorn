import { expect, test } from "bun:test";
import { formatAnimatableValue, PopkornPlayer } from "./component.js";
import type { Renderer } from "./renderer/interface.js";
import { RenderLoop } from "./runtime/loop.js";
import { createDefaultTransform } from "./scene/types.js";

/** Minimal canvas/window doubles: just enough surface for InputTracker.attach/
 * detach to record listener churn, without a real DOM (this suite is DOM-free). */
function createListenerCounter() {
  let count = 0;
  return {
    count: () => count,
    addEventListener: () => {
      count++;
    },
    removeEventListener: () => {
      count--;
    },
  };
}

test("formatAnimatableValue: number trims to a short display string", () => {
  expect(formatAnimatableValue(45)).toBe("45");
  expect(formatAnimatableValue(0.5)).toBe("0.5");
  expect(formatAnimatableValue(1.23456)).toBe("1.235");
});

test("formatAnimatableValue: string passes through", () => {
  expect(formatAnimatableValue("#ff0000")).toBe("#ff0000");
});

test("formatAnimatableValue: Transform summarizes non-default channels", () => {
  const t = createDefaultTransform();
  t.translateX = 20;
  t.rotate = 45;
  expect(formatAnimatableValue(t)).toBe("x 20, rot 45°");
});

test("formatAnimatableValue: identity Transform reads as none", () => {
  expect(formatAnimatableValue(createDefaultTransform())).toBe("none");
});

test("formatAnimatableValue: uniform vs per-axis scale", () => {
  const uni = createDefaultTransform();
  uni.scaleX = uni.scaleY = 2;
  expect(formatAnimatableValue(uni)).toBe("scale 2");
  const ani = createDefaultTransform();
  ani.scaleX = 2;
  ani.scaleY = 0.5;
  expect(formatAnimatableValue(ani)).toBe("scale 2,0.5");
});

test("formatAnimatableValue: gradient / path / filter type tags", () => {
  expect(
    formatAnimatableValue({
      type: "linear-gradient",
      angle: 0,
      stops: [],
    } as never),
  ).toBe("gradient");
  expect(
    formatAnimatableValue([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 1, y: 1 },
    ] as never),
  ).toBe("path");
  expect(formatAnimatableValue([{ type: "blur", radius: 4 }] as never)).toBe(
    "filter",
  );
});

// PopkornPlayer's constructor needs a real DOM (attachShadow/document), which
// this headless suite doesn't have, so these build a bare instance via
// Object.create (skipping the constructor) and call the real, unmodified
// initializePlayer/disconnectedCallback methods directly — the two spots that
// must detach an outgoing RenderLoop's InputTracker before discarding it.

test("re-initializing the player detaches the outgoing RenderLoop's InputTracker", async () => {
  const canvas = createListenerCounter();
  const win = createListenerCounter();
  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  try {
    const oldLoop = new RenderLoop({} as unknown as Renderer);
    oldLoop.getInputTracker().attach(canvas as unknown as HTMLCanvasElement);
    expect(canvas.count()).toBe(3); // mousemove/mousedown/mouseup
    expect(win.count()).toBe(1); // scroll

    const fakePlayer = Object.create(PopkornPlayer.prototype) as PopkornPlayer;
    (fakePlayer as unknown as { renderLoop: RenderLoop }).renderLoop = oldLoop;
    // Falsy source -> initializePlayer returns right after stop()+detach(),
    // skipping the DOM-heavy rebuild below it.
    (fakePlayer as unknown as { _source: string })._source = "";

    await (
      fakePlayer as unknown as { initializePlayer(): Promise<void> }
    ).initializePlayer();

    expect(canvas.count()).toBe(0);
    expect(win.count()).toBe(0);
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});

test("disconnectedCallback detaches the RenderLoop's InputTracker", () => {
  const canvas = createListenerCounter();
  const win = createListenerCounter();
  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  try {
    const loop = new RenderLoop({} as unknown as Renderer);
    loop.getInputTracker().attach(canvas as unknown as HTMLCanvasElement);
    expect(canvas.count()).toBe(3);

    const fakePlayer = Object.create(PopkornPlayer.prototype) as PopkornPlayer;
    (fakePlayer as unknown as { renderLoop: RenderLoop }).renderLoop = loop;
    (fakePlayer as unknown as { resizeObserver: null }).resizeObserver = null;
    (fakePlayer as unknown as { _resizeRaf: null })._resizeRaf = null;

    fakePlayer.disconnectedCallback();

    expect(canvas.count()).toBe(0);
    expect(win.count()).toBe(0);
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});
