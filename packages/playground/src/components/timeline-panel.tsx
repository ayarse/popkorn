import type { PopkornPlayer } from "@popkorn/player";
import { ChevronDown, ChevronUp, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Format milliseconds as seconds with two decimals (e.g. `1.24s`). */
function fmt(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

/**
 * Full-width collapsible timeline docked under the editor/player/copilot row.
 * Reads position from the player's `timeupdate` event and seeks on scrub.
 *
 * NOTE: per-node/per-animation track rows would slot in below the ruler here
 * (a scrollable column keyed by scene node); intentionally out of scope for now.
 */
export function TimelinePanel({ player }: { player: PopkornPlayer | null }) {
  const [expanded, setExpanded] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const trackRef = useRef<HTMLDivElement>(null);

  // Subscribe to the player's clock + transport state.
  useEffect(() => {
    if (!player) {
      setDuration(0);
      setTime(0);
      setPaused(true);
      return;
    }
    setDuration(player.duration);
    setPaused(player.paused);

    const onTime = (e: Event) => {
      const d = (e as CustomEvent<{ time: number; duration: number }>).detail;
      setTime(d.time);
      setDuration(d.duration);
      setPaused(player.paused);
    };
    const onState = () => setPaused(player.paused);

    player.addEventListener("timeupdate", onTime);
    player.addEventListener("statechange", onState);
    return () => {
      player.removeEventListener("timeupdate", onTime);
      player.removeEventListener("statechange", onState);
    };
  }, [player]);

  const disabled = !player || duration <= 0;

  const seekToClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || !player || duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const ms = frac * duration;
      player.pause();
      player.seek(ms);
      setTime(ms);
      setPaused(true);
    },
    [player, duration],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekToClientX(e.clientX);
  };

  const togglePlay = () => {
    if (!player) return;
    if (player.paused) player.resume();
    else player.pause();
    setPaused(player.paused);
  };

  const frac = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div className="shrink-0 border-t border-border bg-background">
      {/* Always-visible bar: collapse toggle + transport + readout. */}
      <div className="flex h-9 items-center gap-2 px-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse timeline" : "Expand timeline"}
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronUp className="size-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={togglePlay}
          disabled={disabled}
          aria-label={paused ? "Play" : "Pause"}
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </Button>

        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {fmt(time)} / {fmt(duration)}
        </span>

        <span className="ml-auto text-xs text-muted-foreground/60">
          Timeline
        </span>
      </div>

      {/* Expanded body: the scrubbable ruler. */}
      {expanded && (
        <div className="flex h-[112px] flex-col justify-center px-4 pb-3">
          {/* Scrubber: pointer-driven; the transport buttons above are the
              accessible controls. */}
          <div
            ref={trackRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            className={cn(
              "relative h-8 w-full rounded-md border border-border/60 bg-secondary/30",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            )}
          >
            {/* Elapsed fill */}
            <div
              className="absolute inset-y-0 left-0 rounded-l-md bg-primary/25"
              style={{ width: `${frac * 100}%` }}
            />
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-primary"
              style={{ left: `${frac * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
