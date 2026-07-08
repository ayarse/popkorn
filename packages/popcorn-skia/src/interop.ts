// RN-free glue between a RenderLoop and the PopcornView host surface. Kept in
// its own module (no react/react-native imports) so the pure pieces — touch
// mapping, the imperative host API, the machine-event fan-out — run under
// `bun test` where the native modules can't load.

import { deviceToScene } from '@popcorn/player';
import type { RenderLoop, Viewport, VariableResolver } from '@popcorn/player';

/** Imperative handle exposed via `ref` — mirrors the web component's host API. */
export interface PopcornViewRef {
  /** Set an author-declared `--variable` (number or boolean). */
  setVariable(name: string, value: number | boolean): void;
  /** Read a `--variable`'s current value (undefined if unknown). */
  getVariable(name: string): number | boolean | string | undefined;
  /**
   * Fire an event into the scene. A declared `trigger` var fires as one (reads
   * `true` for a frame); any other name enqueues a machine `on event(name)`.
   */
  fire(name: string): void;
}

/**
 * Map a touch point (view-local px, as RN reports `locationX`/`locationY`) into
 * scene coordinates through the viewport inverse. `dpr` bridges view px → device
 * px before the inverse; the PoC renders at dpr 1 so it defaults to 1. Reuses the
 * player's `deviceToScene` — no transform math is reimplemented here.
 */
export function touchToScene(
  vp: Viewport,
  x: number,
  y: number,
  dpr = 1
): { x: number; y: number } {
  return deviceToScene(vp, x * dpr, y * dpr);
}

/**
 * Build the imperative host API over a live RenderLoop. `getLoop` is read lazily
 * (the loop is created in an effect, after the ref handle is installed) and
 * `wake` breaks the view's dormancy so a set/fire is painted even while the scene
 * is frozen. Routing matches `<popcorn-player>` exactly: a declared variable is
 * `fire`d as a trigger, anything else is enqueued as a machine event.
 */
export function createHostApi(
  getLoop: () => RenderLoop | null,
  wake: () => void
): PopcornViewRef {
  const resolverOf = (): VariableResolver | null => getLoop()?.getVariableResolver() ?? null;
  return {
    setVariable(name, value) {
      const resolver = resolverOf();
      if (!resolver) return;
      resolver.setVariable(name, value);
      wake();
    },
    getVariable(name) {
      return resolverOf()?.getVariable(name);
    },
    fire(name) {
      const rl = getLoop();
      if (!rl) return;
      const resolver = rl.getVariableResolver();
      if (resolver.getVariable(name) !== undefined) resolver.fire(name);
      else rl.enqueueMachineEvent(name);
      wake();
    },
  };
}

// The runner's output union isn't re-exported from the barrel; redeclare the
// shape we consume (statechange + emit) so this stays import-light.
type MachineOutput =
  | { type: 'statechange'; machine: string; from: string; to: string }
  | { type: 'emit'; machine: string; name: string };

export interface MachineEventHandlers {
  onStateChange?: (e: { machine: string; from: string; to: string }) => void;
  onMachineEvent?: (e: { machine: string; name: string }) => void;
}

/**
 * Fan a RenderLoop machine output out to the host props, mapping `emit` →
 * `onMachineEvent` and `statechange` → `onStateChange` with the same `{machine,
 * from, to}` / `{machine, name}` detail shapes the web component dispatches.
 * `handlers` is a getter so prop changes are picked up without rebuilding the loop.
 */
export function makeMachineEventCallback(
  handlers: () => MachineEventHandlers
): (o: MachineOutput) => void {
  return (o) => {
    if (o.type === 'statechange') {
      handlers().onStateChange?.({ machine: o.machine, from: o.from, to: o.to });
    } else {
      handlers().onMachineEvent?.({ machine: o.machine, name: o.name });
    }
  };
}
