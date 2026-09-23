// RN-free glue between a RenderLoop and PopkornView, so it runs under bun test.

import type { RenderLoop, VariableResolver, Viewport } from "@popkorn/player";
import { deviceToScene } from "@popkorn/player";

/** Imperative handle exposed via `ref` — mirrors the web component's host API. */
export interface PopkornViewRef {
  /** Set an author-declared `--variable` (number or boolean). */
  setVariable(name: string, value: number | boolean): void;
  /** Read a `--variable`'s current value (undefined if unknown). */
  getVariable(name: string): number | boolean | string | undefined;
  /** Fire an event: a declared `trigger` var fires as one, else enqueues machine `on event(name)`. */
  fire(name: string): void;
}

/** View-local touch px -> scene coords via the player's `deviceToScene` (`dpr` bridges view -> device px). */
export function touchToScene(
  vp: Viewport,
  x: number,
  y: number,
  dpr = 1,
): { x: number; y: number } {
  return deviceToScene(vp, x * dpr, y * dpr);
}

/** Host API over a lazily-read loop; `wake` breaks dormancy. Routing matches `<popkorn-player>`. */
export function createHostApi(
  getLoop: () => RenderLoop | null,
  wake: () => void,
): PopkornViewRef {
  const resolverOf = (): VariableResolver | null =>
    getLoop()?.getVariableResolver() ?? null;
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

// Redeclared: the runner's output union isn't exported from the barrel.
type MachineOutput =
  | { type: "statechange"; machine: string; from: string; to: string }
  | { type: "emit"; machine: string; name: string };

export interface MachineEventHandlers {
  onStateChange?: (e: { machine: string; from: string; to: string }) => void;
  onMachineEvent?: (e: { machine: string; name: string }) => void;
}

/** Fan machine output to `onMachineEvent` / `onStateChange` with the web component's detail shapes. */
export function makeMachineEventCallback(
  handlers: () => MachineEventHandlers,
): (o: MachineOutput) => void {
  return (o) => {
    if (o.type === "statechange") {
      handlers().onStateChange?.({
        machine: o.machine,
        from: o.from,
        to: o.to,
      });
    } else {
      handlers().onMachineEvent?.({ machine: o.machine, name: o.name });
    }
  };
}
