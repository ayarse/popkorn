import type { PopkornPlayer, TimelineTrack } from "@popkorn/player";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Pause,
  Play,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Fixed width (px) of the left label column, shared by ruler + all rows. */
const LABEL_W = 132;

/** Format milliseconds as seconds with two decimals (e.g. `1.24s`). */
function fmt(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

/**
 * After Effects–style timeline docked under the editor/player/copilot row.
 * A slim always-visible bar (collapse + transport + readout) over an expandable
 * body: a time ruler, one track row per animated scene node, and a playhead
 * spanning both. Layer rows expand to per-property sub-rows with keyframe
 * diamonds. Position/transport come from the player's `timeupdate` /
 * `statechange` events; the track snapshot refreshes on `ready`.
 *
 * NOTE: keyframe editing, zoom, drag-to-retime and selection are out of scope —
 * the diamonds are read-only (a click seeks to their time).
 */
export function TimelinePanel({ player }: { player: PopkornPlayer | null }) {
  const [expanded, setExpanded] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [tracks, setTracks] = useState<TimelineTrack[]>([]);
  // Indices of layer rows whose property sub-rows are shown.
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());
  const rulerRef = useRef<HTMLDivElement>(null);

  // Subscribe to the player's clock, transport state, and track snapshot.
  useEffect(() => {
    if (!player) {
      setDuration(0);
      setTime(0);
      setPaused(true);
      setTracks([]);
      return;
    }
    setDuration(player.duration);
    setPaused(player.paused);
    setTracks(player.getTimelineTracks());
    setOpenRows(new Set());

    const onTime = (e: Event) => {
      const d = (e as CustomEvent<{ time: number; duration: number }>).detail;
      setTime(d.time);
      setDuration(d.duration);
      setPaused(player.paused);
    };
    const onState = () => setPaused(player.paused);
    const onReady = () => {
      setTracks(player.getTimelineTracks());
      setDuration(player.duration);
      setOpenRows(new Set());
    };

    player.addEventListener("timeupdate", onTime);
    player.addEventListener("statechange", onState);
    player.addEventListener("ready", onReady);
    return () => {
      player.removeEventListener("timeupdate", onTime);
      player.removeEventListener("statechange", onState);
      player.removeEventListener("ready", onReady);
    };
  }, [player]);

  const disabled = !player || duration <= 0;

  // Map a client-x (anywhere over the lanes region) to a seek, using the ruler's
  // rect so ruler + every lane share one time scale and left offset.
  const seekToClientX = useCallback(
    (clientX: number) => {
      const ruler = rulerRef.current;
      if (!ruler || !player || duration <= 0) return;
      const rect = ruler.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const ms = frac * duration;
      player.pause();
      player.seek(ms);
      setTime(ms);
      setPaused(true);
    },
    [player, duration],
  );

  const onLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
  };
  const onLanePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekToClientX(e.clientX);
  };

  const togglePlay = () => {
    if (!player) return;
    if (player.paused) player.resume();
    else player.pause();
    setPaused(player.paused);
  };

  const toggleRow = (i: number) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const seekTo = (ms: number) => {
    player?.pause();
    player?.seek(ms);
    setTime(ms);
    setPaused(true);
  };

  const frac = duration > 0 ? Math.min(1, time / duration) : 0;
  const pct = (ms: number) =>
    duration > 0 ? (Math.min(duration, Math.max(0, ms)) / duration) * 100 : 0;

  // Playhead x within the lanes region (offset past the label column).
  const playheadLeft = `calc(${LABEL_W}px + ${frac} * (100% - ${LABEL_W}px))`;

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

      {/* Expanded body: ruler + track rows + spanning playhead. */}
      {expanded && (
        <div className="relative flex max-h-[240px] flex-col pb-2">
          {/* Ruler: label spacer + scrubbable track. */}
          <div className="flex items-stretch px-2">
            <div style={{ width: LABEL_W }} className="shrink-0" />
            {/* Scrubbable ruler; the transport buttons are the accessible control. */}
            <div
              ref={rulerRef}
              onPointerDown={onLanePointerDown}
              onPointerMove={onLanePointerMove}
              className={cn(
                "relative h-7 flex-1 rounded-md border border-border/60 bg-secondary/30",
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              )}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-l-md bg-primary/15"
                style={{ width: `${frac * 100}%` }}
              />
            </div>
          </div>

          {/* Track rows (scroll vertically when tall). */}
          <div className="mt-1 flex-1 overflow-y-auto px-2">
            {tracks.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground/50">
                No animated layers in this scene.
              </div>
            ) : (
              tracks.map((track, i) => (
                <LayerRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: scene order is stable within a snapshot
                  key={i}
                  track={track}
                  open={openRows.has(i)}
                  onToggle={() => toggleRow(i)}
                  duration={duration}
                  pct={pct}
                  onLanePointerDown={onLanePointerDown}
                  onLanePointerMove={onLanePointerMove}
                  onSeek={seekTo}
                />
              ))
            )}
          </div>

          {/* Playhead: one line across ruler + all rows. */}
          {duration > 0 && (
            <div
              className="pointer-events-none absolute top-0 bottom-2 w-px bg-primary"
              style={{ left: playheadLeft }}
            />
          )}
        </div>
      )}
    </div>
  );
}

type PointerHandler = (e: React.PointerEvent<HTMLDivElement>) => void;

function LayerRow({
  track,
  open,
  onToggle,
  duration,
  pct,
  onLanePointerDown,
  onLanePointerMove,
  onSeek,
}: {
  track: TimelineTrack;
  open: boolean;
  onToggle: () => void;
  duration: number;
  pct: (ms: number) => number;
  onLanePointerDown: PointerHandler;
  onLanePointerMove: PointerHandler;
  onSeek: (ms: number) => void;
}) {
  return (
    <div>
      {/* Layer row: label (chevron + name) + summary lane of span bars. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          style={{ width: LABEL_W }}
          className="flex h-7 shrink-0 items-center gap-1 rounded px-1 text-xs text-foreground hover:bg-secondary/50"
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          ) : (
            <ChevronRight className="size-3 shrink-0 opacity-60" />
          )}
          <span className="truncate font-mono">{track.nodeName}</span>
        </button>
        <div
          onPointerDown={onLanePointerDown}
          onPointerMove={onLanePointerMove}
          className="relative h-7 flex-1 cursor-pointer overflow-hidden rounded bg-secondary/10"
        >
          {track.animations.map((a, ai) => {
            const s = span(a, duration, pct);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
                key={ai}
                className={cn(
                  "absolute h-2 rounded-full bg-primary/60",
                  s.faded &&
                    "[mask-image:linear-gradient(to_right,black_70%,transparent)]",
                )}
                style={{
                  left: `${s.left}%`,
                  width: `${Math.max(s.width, 0.5)}%`,
                  top: `${6 + ai * 8}px`,
                }}
                title={a.name}
              />
            );
          })}
        </div>
      </div>

      {/* Expanded: one sub-row per animated property, with keyframe diamonds. */}
      {open &&
        track.animations.map((a, ai) =>
          a.properties.map((p, pi) => {
            const s = span(a, duration, pct);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
                key={`${ai}-${pi}`}
                className="flex items-center gap-1"
              >
                <div
                  style={{ width: LABEL_W }}
                  className="flex h-6 shrink-0 items-center pl-6 pr-1 text-[11px] text-muted-foreground"
                >
                  <span className="truncate font-mono">{p.property}</span>
                </div>
                <div
                  onPointerDown={onLanePointerDown}
                  onPointerMove={onLanePointerMove}
                  className="relative h-6 flex-1 cursor-pointer rounded bg-secondary/5"
                >
                  {/* Faded span backing the diamonds. */}
                  <div
                    className="absolute top-1/2 h-px -translate-y-1/2 bg-border"
                    style={{
                      left: `${s.left}%`,
                      width: `${Math.max(s.width, 0.5)}%`,
                    }}
                  />
                  {/* Keyframe diamonds. NOTE: only the first iteration's
                      keyframes are drawn; iterationCount > 1 repeats them across
                      the span (not re-plotted per repeat). */}
                  {p.keyframes.map((offset, ki) => {
                    const ms = Math.max(0, a.delay) + offset * a.duration;
                    return (
                      <button
                        type="button"
                        // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
                        key={ki}
                        onClick={() => onSeek(ms)}
                        title={`${p.property} @ ${fmt(ms)}`}
                        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border border-primary bg-primary/70 hover:bg-primary"
                        style={{ left: `${pct(ms)}%` }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          }),
        )}
    </div>
  );
}

/** Resolve an animation's on-timeline span (as ruler %), capping infinite/overrun. */
function span(
  a: TimelineTrack["animations"][number],
  duration: number,
  pct: (ms: number) => number,
) {
  const start = Math.max(0, a.delay);
  const finite = Number.isFinite(a.iterationCount);
  const rawEnd = finite ? a.delay + a.duration * a.iterationCount : duration;
  const end = Math.min(duration, Math.max(start, rawEnd));
  return {
    left: pct(start),
    width: pct(end) - pct(start),
    // Faded right edge when the span is clipped by the scene duration.
    faded: !finite || rawEnd > duration,
  };
}
