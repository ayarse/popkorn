import { test, expect } from 'bun:test';
import { parse, buildSceneGraph, RenderLoop, computeViewport } from '@popcorn/player';
import { touchToScene, createHostApi, makeMachineEventCallback } from '../src/interop';

// A RenderLoop needs a renderer, but none of the interop paths (variable
// resolver, machine runner, event enqueue) paint — so a stub renderer is enough
// to exercise the host API headlessly under bun (no native Skia).
const makeLoop = (src: string) => {
  const rl = new RenderLoop({} as any);
  rl.setScene(buildSceneGraph(parse(src)));
  const ast = parse(src);
  rl.getVariableResolver().setVariables(ast.variables);
  return rl;
};

// touchToScene reuses the player's viewport inverse: a view-local touch maps back
// through the fit/DPR transform to scene coords.
test('touchToScene maps a touch through the contain viewport', () => {
  // 100x100 scene into a 200x200 view, dpr 1 => scale 2, no letterbox.
  const vp = computeViewport(100, 100, 200, 200, 1, 'contain');
  const p = touchToScene(vp, 50, 50);
  expect(p.x).toBeCloseTo(25, 6);
  expect(p.y).toBeCloseTo(25, 6);

  // Non-square scene letterboxes on Y: scale 1, offsetY 25.
  const vp2 = computeViewport(100, 50, 100, 100, 1, 'contain');
  const q = touchToScene(vp2, 10, 35);
  expect(q.x).toBeCloseTo(10, 6);
  expect(q.y).toBeCloseTo(10, 6);
});

// dpr bridges view px -> device px before the inverse.
test('touchToScene honours dpr', () => {
  const vp = computeViewport(100, 100, 100, 100, 2, 'contain'); // scale 2 (dpr folded in)
  const p = touchToScene(vp, 50, 50, 2); // 50 view px * dpr 2 = 100 device px / scale 2 = 50
  expect(p.x).toBeCloseTo(50, 6);
});

const MACHINE_SRC = `
  :root { width: 100px; height: 100px; --energy: 0; --tap: trigger }
  @machine m {
    initial: a;
    state a { to: b on event(go); }
    state b { }
  }
  #r { type: rect; width: 10px; height: 10px; fill: #000 }
`;

// fire() routing must match the web component exactly: a declared variable fires
// as a trigger; any other name enqueues a machine `on event(name)`.
test('createHostApi.fire routes a declared trigger var to the resolver', () => {
  const rl = makeLoop(MACHINE_SRC);
  let woke = 0;
  const api = createHostApi(() => rl, () => { woke++; });

  expect(rl.getVariableResolver().getVariable('--tap')).toBe(false);
  api.fire('--tap');
  // Routed to resolver.fire: the trigger reads true for this frame (not enqueued).
  expect(rl.getVariableResolver().getVariable('--tap')).toBe(true);
  expect(woke).toBe(1);
});

test('createHostApi.fire routes an unknown name to a machine event', () => {
  const rl = makeLoop(MACHINE_SRC);
  const api = createHostApi(() => rl, () => {});

  api.fire('go'); // not a declared var => enqueueMachineEvent('go')
  // A live evaluation consumes the queued event and transitions a -> b.
  const outputs = rl.getStateMachineRunner().evaluate(0, {
    variableResolver: rl.getVariableResolver(),
    pointerEvents: [],
  });
  expect(outputs).toContainEqual({ type: 'statechange', machine: 'm', from: 'a', to: 'b' });
});

test('createHostApi setVariable/getVariable round-trips and wakes', () => {
  const rl = makeLoop(MACHINE_SRC);
  let woke = 0;
  const api = createHostApi(() => rl, () => { woke++; });

  api.setVariable('--energy', 80);
  expect(api.getVariable('--energy')).toBe(80);
  expect(woke).toBe(1);
  expect(api.getVariable('--nope')).toBeUndefined();
});

test('createHostApi no-ops safely before the loop exists', () => {
  const api = createHostApi(() => null, () => {});
  expect(() => api.setVariable('--x', 1)).not.toThrow();
  expect(api.getVariable('--x')).toBeUndefined();
  expect(() => api.fire('x')).not.toThrow();
});

// makeMachineEventCallback maps runner outputs to the host prop shapes, mirroring
// the web component's statechange / machine-event detail payloads.
test('makeMachineEventCallback fans outputs to the right handlers', () => {
  const events: unknown[] = [];
  const cb = makeMachineEventCallback(() => ({
    onStateChange: (e) => events.push(['statechange', e]),
    onMachineEvent: (e) => events.push(['machine-event', e]),
  }));

  cb({ type: 'statechange', machine: 'm', from: 'a', to: 'b' });
  cb({ type: 'emit', machine: 'm', name: 'overheat' });

  expect(events).toEqual([
    ['statechange', { machine: 'm', from: 'a', to: 'b' }],
    ['machine-event', { machine: 'm', name: 'overheat' }],
  ]);
});

// The handler getter is re-read per output, so a prop swap is picked up without
// rebuilding the callback (mirrors PopcornView's ref-backed handlers).
test('makeMachineEventCallback re-reads handlers per output', () => {
  let handler: ((e: { machine: string; from: string; to: string }) => void) | undefined;
  const cb = makeMachineEventCallback(() => ({ onStateChange: handler }));

  cb({ type: 'statechange', machine: 'm', from: 'a', to: 'b' }); // no handler yet: no throw
  const seen: unknown[] = [];
  handler = (e) => seen.push(e);
  cb({ type: 'statechange', machine: 'm', from: 'b', to: 'a' });
  expect(seen).toEqual([{ machine: 'm', from: 'b', to: 'a' }]);
});
