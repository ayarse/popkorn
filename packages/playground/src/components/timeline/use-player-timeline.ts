import type { PopkornPlayer, TimelineTrack } from "@popkorn/player";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animAnchor, animSpan, type MachineState, toggle } from "./geometry";

/** The live playhead time, read and subscribed to outside React state. */
export interface Clock {
  get(): number;
  subscribe(fn: () => void): () => void;
}

function createClock() {
  let time = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => time,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    set(t: number) {
      time = t;
      for (const fn of listeners) fn();
    },
  };
}

/**
 * Subscribes to the player's clock, transport, machine states and track
 * snapshot. Time lives in a `Clock` (per-frame, never React state) so only the
 * playhead re-paints each frame.
 */
export function usePlayerTimeline(player: PopkornPlayer | null) {
  const [clock] = useState(createClock);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [tracks, setTracks] = useState<TimelineTrack[]>([]);
  const [machineStates, setMachineStates] = useState<MachineState[]>([]);
  // Expansion keyed by `nodeName` / `nodeName/ruleSelector/name`: stable across
  // the snapshot refreshes every committed edit fires, unlike array indices.
  const [openLayers, setOpenLayers] = useState<Set<string>>(new Set());
  const [openAnims, setOpenAnims] = useState<Set<string>>(new Set());
  // nodeNames of the last snapshot, so a refresh default-opens only new rows.
  const seenNodeNames = useRef<Set<string>>(new Set());
  // Playback to restore on the next `ready` (an edit reinitializes the player).
  const held = useRef<{ time: number; paused: boolean } | null>(null);

  useEffect(() => {
    held.current = null;
    if (!player) {
      clock.set(0);
      setDuration(0);
      setPaused(true);
      setTracks([]);
      setMachineStates([]);
      setOpenLayers(new Set());
      setOpenAnims(new Set());
      seenNodeNames.current = new Set();
      return;
    }
    // `initial` resets expansion (all layers open); later refreshes keep it.
    const refresh = (initial: boolean) => {
      const t = player.getTimelineTracks();
      setTracks(t);
      setDuration(player.duration);
      setMachineStates(player.getMachineStates());
      const nodeNames = new Set(t.map((tr) => tr.nodeName));
      if (initial) {
        setOpenLayers(nodeNames);
        setOpenAnims(new Set());
      } else {
        const seen = seenNodeNames.current;
        setOpenLayers((prev) => {
          const next = new Set(prev);
          for (const name of nodeNames) if (!seen.has(name)) next.add(name);
          return next;
        });
      }
      seenNodeNames.current = nodeNames;
    };
    setPaused(player.paused);
    refresh(true);

    const onTime = (e: Event) => {
      const d = (e as CustomEvent<{ time: number; duration: number }>).detail;
      clock.set(d.time);
      setDuration(d.duration);
      setPaused(player.paused);
    };
    const onState = () => {
      setPaused(player.paused);
      setMachineStates(player.getMachineStates());
    };
    const onReady = () => {
      refresh(false);
      const h = held.current;
      if (!h) return;
      held.current = null;
      player.seek(h.time);
      if (h.paused) player.pause();
      clock.set(h.time);
      setPaused(player.paused);
    };

    player.addEventListener("popkorn:timeupdate", onTime);
    player.addEventListener("popkorn:statechange", onState);
    player.addEventListener("popkorn:ready", onReady);
    return () => {
      player.removeEventListener("popkorn:timeupdate", onTime);
      player.removeEventListener("popkorn:statechange", onState);
      player.removeEventListener("popkorn:ready", onReady);
    };
  }, [player, clock]);

  // Display extent: past the scene duration when delayed/looping/state anims
  // run longer. An unbounded scene reports Infinity — seed at 0 and let
  // animation ends (one cycle for infinite loops) establish the extent.
  const displayEnd = useMemo(() => {
    let d = Number.isFinite(duration) ? duration : 0;
    for (const t of tracks)
      for (const a of t.animations) {
        const { entry } = animAnchor(a, machineStates);
        const { start, end } = animSpan(a, entry, duration);
        // Infinite loops show at least one full cycle.
        d = Math.max(d, Number.isFinite(end) ? end : start + a.duration);
      }
    return d;
  }, [duration, tracks, machineStates]);

  const seek = useCallback(
    (ms: number) => {
      if (!player) return;
      const clamped = Math.max(0, Math.min(displayEnd, ms));
      player.pause();
      player.seek(clamped);
      clock.set(clamped);
      setPaused(true);
    },
    [player, displayEnd, clock],
  );

  const togglePlay = () => {
    if (!player) return;
    if (player.paused) player.resume();
    else player.pause();
    setPaused(player.paused);
  };

  /** Keep the current time + play state across the reinit an edit causes. */
  const holdPlayback = useCallback(() => {
    if (player) held.current = { time: clock.get(), paused: player.paused };
  }, [player, clock]);

  const toggleLayer = useCallback(
    (name: string) => setOpenLayers((prev) => toggle(prev, name)),
    [],
  );
  const toggleAnim = useCallback(
    (key: string) => setOpenAnims((prev) => toggle(prev, key)),
    [],
  );

  return {
    clock,
    paused,
    tracks,
    machineStates,
    displayEnd,
    openLayers,
    openAnims,
    toggleLayer,
    toggleAnim,
    seek,
    togglePlay,
    holdPlayback,
  };
}
