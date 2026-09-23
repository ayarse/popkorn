import type { PopkornPlayer } from "@popkorn/player";
import { useEffect, useState } from "react";

/** The latest player DOM event as an ephemeral badge; newest replaces, auto-dismisses. */
export function useEventBadge(player: PopkornPlayer | null): string | null {
  const [badge, setBadge] = useState<string | null>(null);

  useEffect(() => {
    if (!player) return;
    let timer: number | undefined;
    const flash = (text: string) => {
      setBadge(text);
      clearTimeout(timer);
      timer = window.setTimeout(() => setBadge(null), 1500);
    };
    const onClick = (e: Event) =>
      flash(`Event fired: popkorn:click → #${(e as CustomEvent).detail.id}`);
    const onMachine = (e: Event) =>
      flash(
        `Event fired: popkorn:machine-event → ${(e as CustomEvent).detail.name}`,
      );
    const onState = (e: Event) => {
      const d = (e as CustomEvent).detail;
      flash(
        `Event fired: popkorn:statechange → ${d.machine}: ${d.from}→${d.to}`,
      );
    };
    player.addEventListener("popkorn:click", onClick);
    player.addEventListener("popkorn:machine-event", onMachine);
    player.addEventListener("popkorn:statechange", onState);
    return () => {
      player.removeEventListener("popkorn:click", onClick);
      player.removeEventListener("popkorn:machine-event", onMachine);
      player.removeEventListener("popkorn:statechange", onState);
      clearTimeout(timer);
    };
  }, [player]);

  return badge;
}
