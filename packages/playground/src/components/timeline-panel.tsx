import type {
  PopkornPlayer,
  TimelineAnimation,
  TimelineAnimationProperty,
  TimelineTrack,
  TimingFunction,
} from "@popkorn/player";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Diamond,
  Pause,
  Play,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { moveKeyframe, retimeAnimation } from "@/lib/timeline-edits";
import { cn } from "@/lib/utils";
import {
  fmtSeconds,
  layerHue,
  pxPerMs,
  snapMs,
  tickStep,
  ticks,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./timeline/scale";

/** Fixed width (px) of the sticky-left label column, shared by ruler + rows. */
const LABEL_W = 168;
/** Trailing slack (px) so the last pill/tick isn't flush against the edge. */
const LANE_PAD = 48;

type Keyframe = TimelineAnimationProperty["keyframes"][number];
type MachineState = { machine: string; state: string; entryTime: number };

// ---------------------------------------------------------------------------
// Pure geometry / label helpers (no React)
// ---------------------------------------------------------------------------

/** Where an animation is anchored on the global timeline given the live machine
 * states. Un-stated animations (and active state animations) anchor at their
 * machine entry; an INACTIVE state animation anchors at 0 and renders dimmed. */
function animAnchor(
  a: TimelineAnimation,
  machineStates: MachineState[],
): { active: boolean; entry: number } {
  if (!a.state) return { active: true, entry: 0 };
  const st = a.state;
  const m = machineStates.find(
    (s) =>
      s.state === st.state && (st.machine === null || s.machine === st.machine),
  );
  // Sampling of an active state is machineTime − entryTime, so its keys play
  // from `entryTime + delay`; inactive states never run, so anchor them at 0.
  return m ? { active: true, entry: m.entryTime } : { active: false, entry: 0 };
}

/** Timeline span (ms) of an animation, capping ∞ iterations at the display end. */
function animSpan(a: TimelineAnimation, entry: number, displayEnd: number) {
  const start = entry + a.delay;
  const finite = Number.isFinite(a.iterationCount);
  const rawEnd = finite ? start + a.duration * a.iterationCount : displayEnd;
  return {
    start,
    end: Math.max(start, rawEnd),
    // Faded right edge when clipped by the scene/display end (∞ or overrun).
    faded: !finite || rawEnd > displayEnd,
  };
}

/** Human label for a timing function (keyword or cubic-bezier/steps/linear()). */
function easingLabel(tf: TimingFunction): string {
  if (typeof tf === "string") return tf;
  if (tf.type === "cubic-bezier")
    return `cubic-bezier(${tf.x1}, ${tf.y1}, ${tf.x2}, ${tf.y2})`;
  if (tf.type === "steps") return `steps(${tf.count}, ${tf.position})`;
  return "linear()";
}

/** Anything but the identity `linear` keyword gets an easing glyph. */
function isNonLinear(tf: TimingFunction): boolean {
  return typeof tf === "string" ? tf !== "linear" : true;
}

/** Badge text for a state animation: `machine·state` (or just `state`). */
function stateBadge(a: TimelineAnimation): string {
  if (!a.state) return "";
  return a.state.machine
    ? `${a.state.machine}·${a.state.state}`
    : a.state.state;
}

// ---------------------------------------------------------------------------
// Shared view context threaded to the row subcomponents
// ---------------------------------------------------------------------------

interface Ctx {
  ppm: number; // pixels per ms
  time: number; // ms; live playhead (for prev/next keyframe nav)
  displayEnd: number; // ms; ruler/seek extent (≥ duration)
  machineStates: MachineState[];
  seek: (ms: number) => void;
  commitRetime: (
    selector: string,
    name: string,
    changes: { delay?: number; duration?: number },
  ) => void;
  commitKeyframe: (name: string, oldOffset: number, newOffset: number) => void;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Figma-Motion/After-Effects–style editor timeline docked under the
 * editor|player|copilot row. A slim always-visible bar (collapse, transport,
 * current-time input, readout, zoom) over an expandable body: a shared
 * horizontal time scale (`ppm`) drives a numbered ruler, a draggable playhead,
 * per-layer/animation/property rows, keyframe diamonds, and a read-only machine
 * strip. Pills drag to retime and diamonds drag to re-key — both re-parse and
 * splice the SOURCE via lib/timeline-edits, validated before commit.
 */
export function TimelinePanel({
  player,
  source,
  onEditSource,
}: {
  player: PopkornPlayer | null;
  source: string;
  onEditSource: (next: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [tracks, setTracks] = useState<TimelineTrack[]>([]);
  const [machineStates, setMachineStates] = useState<MachineState[]>([]);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  // Layers expanded to show their animation rows (default: all).
  const [openLayers, setOpenLayers] = useState<Set<number>>(new Set());
  // Animation rows (`layer:anim`) expanded to show property rows.
  const [openAnims, setOpenAnims] = useState<Set<string>>(new Set());
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null); // marks x-origin of the lanes
  const [viewportW, setViewportW] = useState(0);
  const pendingScroll = useRef<number | null>(null);
  // Latest source, read inside edit commits (which may fire after a re-render).
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Subscribe to the player's clock, transport, machine states, and snapshot.
  useEffect(() => {
    if (!player) {
      setDuration(0);
      setTime(0);
      setPaused(true);
      setTracks([]);
      setMachineStates([]);
      return;
    }
    const refresh = () => {
      const t = player.getTimelineTracks();
      setTracks(t);
      setDuration(player.duration);
      setMachineStates(player.getMachineStates());
      setOpenLayers(new Set(t.map((_, i) => i)));
      setOpenAnims(new Set());
    };
    setPaused(player.paused);
    refresh();

    const onTime = (e: Event) => {
      const d = (e as CustomEvent<{ time: number; duration: number }>).detail;
      setTime(d.time);
      setDuration(d.duration);
      setPaused(player.paused);
    };
    const onState = () => {
      setPaused(player.paused);
      setMachineStates(player.getMachineStates());
    };
    const onReady = () => refresh();

    player.addEventListener("timeupdate", onTime);
    player.addEventListener("statechange", onState);
    player.addEventListener("ready", onReady);
    return () => {
      player.removeEventListener("timeupdate", onTime);
      player.removeEventListener("statechange", onState);
      player.removeEventListener("ready", onReady);
    };
  }, [player]);

  // Track the lanes viewport width so we can gray-fill past the content end.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const ppm = pxPerMs(zoom);

  // Display extent: past the scene duration when delayed/looping/state anims run
  // longer — and the sole extent for pure state-machine scenes (duration 0).
  const displayEnd = useMemo(() => {
    let d = duration;
    for (const t of tracks)
      for (const a of t.animations) {
        const { entry } = animAnchor(a, machineStates);
        const { end } = animSpan(a, entry, duration);
        if (Number.isFinite(end)) d = Math.max(d, end);
      }
    return d;
  }, [duration, tracks, machineStates]);

  const disabled = !player || displayEnd <= 0;

  const durationPx = displayEnd * ppm;
  const laneW = Math.max(durationPx + LANE_PAD, viewportW - LABEL_W);
  const contentW = LABEL_W + laneW;

  // Apply a zoom-around-cursor scroll target after the width re-renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `zoom` is the intended trigger — the content width it drives must be laid out before we set scrollLeft.
  useLayoutEffect(() => {
    if (pendingScroll.current !== null && scrollRef.current) {
      scrollRef.current.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [zoom]);

  // ctrl/cmd + wheel zooms, keeping the point under the cursor fixed. Native
  // listener (non-passive) so we can preventDefault the page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const laneX = e.clientX - rect.left + el.scrollLeft - LABEL_W;
      setZoom((z) => {
        const next = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)),
        );
        const ms = laneX / pxPerMs(z);
        pendingScroll.current =
          ms * pxPerMs(next) + LABEL_W - (e.clientX - rect.left);
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep zoom fresh inside the stable clientToMs closure.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Convert a client-x anywhere over the lanes to a timeline ms.
  const clientToMs = useCallback((clientX: number) => {
    const lane = laneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / pxPerMs(zoomRef.current));
  }, []);

  const seek = useCallback(
    (ms: number) => {
      if (!player) return;
      const clamped = Math.max(0, Math.min(displayEnd, ms));
      player.pause();
      player.seek(clamped);
      setTime(clamped);
      setPaused(true);
    },
    [player, displayEnd],
  );

  const scrub = (clientX: number) => seek(clientToMs(clientX));
  const onLaneDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub(e.clientX);
  };
  const onLaneMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    scrub(e.clientX);
  };

  const togglePlay = () => {
    if (!player) return;
    if (player.paused) player.resume();
    else player.pause();
    setPaused(player.paused);
  };

  const flashErr = useCallback((msg: string) => {
    setEditErr(msg);
    window.setTimeout(
      () => setEditErr((cur) => (cur === msg ? null : cur)),
      4000,
    );
  }, []);

  const commitRetime = useCallback(
    (
      selector: string,
      name: string,
      changes: { delay?: number; duration?: number },
    ) => {
      const r = retimeAnimation(sourceRef.current, selector, name, changes);
      if (r.ok) onEditSource(r.source);
      else flashErr(`Retime failed: ${r.error}`);
    },
    [onEditSource, flashErr],
  );
  const commitKeyframe = useCallback(
    (name: string, oldOffset: number, newOffset: number) => {
      const r = moveKeyframe(sourceRef.current, name, oldOffset, newOffset);
      if (r.ok) onEditSource(r.source);
      else flashErr(`Keyframe move failed: ${r.error}`);
    },
    [onEditSource, flashErr],
  );

  const ctx: Ctx = useMemo(
    () => ({
      ppm,
      time,
      displayEnd,
      machineStates,
      seek,
      commitRetime,
      commitKeyframe,
    }),
    [ppm, time, displayEnd, machineStates, seek, commitRetime, commitKeyframe],
  );

  const toggleLayer = (i: number) => setOpenLayers((prev) => toggle(prev, i));
  const toggleAnim = (key: string) => setOpenAnims((prev) => toggle(prev, key));

  const commitTimeInput = () => {
    const ms = Number.parseFloat(timeDraft);
    if (Number.isFinite(ms)) seek(ms);
    setEditingTime(false);
  };

  const step = tickStep(ppm);
  const playheadX = LABEL_W + time * ppm;

  return (
    <div className="shrink-0 border-t border-border bg-background">
      {/* Always-visible bar. */}
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

        {/* Editable current time (ms) + readout. */}
        <div className="flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
          <input
            aria-label="Current time (ms)"
            value={editingTime ? timeDraft : String(Math.round(time))}
            disabled={disabled}
            onFocus={() => {
              setEditingTime(true);
              setTimeDraft(String(Math.round(time)));
            }}
            onChange={(e) => setTimeDraft(e.target.value)}
            onBlur={commitTimeInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditingTime(false);
            }}
            className="w-14 rounded border border-border/60 bg-secondary/30 px-1 py-0.5 text-right focus:border-primary focus:outline-none"
          />
          <span>ms</span>
          <span className="ml-1 text-muted-foreground/60">
            {fmtSeconds(time)} / {fmtSeconds(displayEnd)}
          </span>
        </div>

        {editErr && (
          <span className="ml-2 truncate rounded bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive">
            {editErr}
          </span>
        )}

        {/* Zoom slider. */}
        <div className="ml-auto flex items-center gap-1.5 text-muted-foreground/60">
          <span className="text-[11px]">Zoom</span>
          <input
            type="range"
            aria-label="Timeline zoom"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.05}
            value={zoom}
            disabled={disabled}
            onChange={(e) => setZoom(Number.parseFloat(e.target.value))}
            className="h-1 w-24 cursor-pointer accent-primary"
          />
        </div>
      </div>

      {/* Expanded body: one horizontally + vertically scrolling grid. */}
      {expanded && (
        <div
          ref={scrollRef}
          className="max-h-[280px] overflow-auto pb-2"
          style={{ overscrollBehaviorX: "contain" }}
        >
          {disabled ? (
            <div className="py-4 text-center text-xs text-muted-foreground/50">
              No animated layers in this scene.
            </div>
          ) : (
            <div className="relative" style={{ width: contentW }}>
              {/* Sticky header: ruler + machine strip. */}
              <div className="sticky top-0 z-30 bg-background">
                {/* Ruler row. */}
                <div className="flex">
                  <div
                    style={{ width: LABEL_W }}
                    className="sticky left-0 z-10 shrink-0 border-r border-border/40 bg-background"
                  />
                  <div
                    ref={laneRef}
                    onPointerDown={onLaneDown}
                    onPointerMove={onLaneMove}
                    className="relative h-7 cursor-pointer select-none border-b border-border/40"
                    style={{ width: laneW }}
                  >
                    {/* Gray region past the content end. */}
                    {laneW > durationPx && (
                      <div
                        className="absolute inset-y-0 bg-muted/20"
                        style={{ left: durationPx, right: 0 }}
                      />
                    )}
                    {ticks(displayEnd, step).map((t) => (
                      <div
                        key={t}
                        className="absolute inset-y-0"
                        style={{ left: t * ppm }}
                      >
                        <div className="absolute bottom-0 h-2 w-px bg-border" />
                        <div className="absolute bottom-2 left-1 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/70">
                          {t}
                        </div>
                      </div>
                    ))}
                    {/* Playhead grabber. */}
                    <div
                      className="absolute top-0 z-10 -translate-x-1/2"
                      style={{ left: time * ppm }}
                      onPointerDown={onLaneDown}
                      onPointerMove={onLaneMove}
                    >
                      <div className="size-0 border-x-4 border-t-[6px] border-x-transparent border-t-primary" />
                    </div>
                  </div>
                </div>

                {/* Machine strip: read-only current state per machine.
                    NOTE: no imperative setState exists — this is display only. */}
                {machineStates.length > 0 && (
                  <div className="flex">
                    <div
                      style={{ width: LABEL_W }}
                      className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border/40 bg-background px-2 text-[10px] uppercase tracking-wide text-muted-foreground/50"
                    >
                      Machines
                    </div>
                    <div
                      className="flex h-6 items-center gap-2 px-2"
                      style={{ width: laneW }}
                    >
                      {machineStates.map((m) => (
                        <span
                          key={m.machine}
                          className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                        >
                          {m.machine}:{m.state}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Rows + spanning playhead line. */}
              <div className="relative">
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-primary"
                  style={{ left: playheadX }}
                />
                {tracks.map((track, i) => (
                  <LayerBlock
                    // biome-ignore lint/suspicious/noArrayIndexKey: scene order stable within a snapshot
                    key={i}
                    index={i}
                    track={track}
                    ctx={ctx}
                    laneW={laneW}
                    layerOpen={openLayers.has(i)}
                    openAnims={openAnims}
                    selected={selected === i}
                    onSelect={() => setSelected(i)}
                    onToggleLayer={() => toggleLayer(i)}
                    onToggleAnim={toggleAnim}
                    onLaneDown={onLaneDown}
                    onLaneMove={onLaneMove}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toggle<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

type LaneHandler = (e: React.PointerEvent<HTMLDivElement>) => void;

// ---------------------------------------------------------------------------
// Layer block: layer row → animation rows → property rows
// ---------------------------------------------------------------------------

function LayerBlock({
  index,
  track,
  ctx,
  laneW,
  layerOpen,
  openAnims,
  selected,
  onSelect,
  onToggleLayer,
  onToggleAnim,
  onLaneDown,
  onLaneMove,
}: {
  index: number;
  track: TimelineTrack;
  ctx: Ctx;
  laneW: number;
  layerOpen: boolean;
  openAnims: Set<string>;
  selected: boolean;
  onSelect: () => void;
  onToggleLayer: () => void;
  onToggleAnim: (key: string) => void;
  onLaneDown: LaneHandler;
  onLaneMove: LaneHandler;
}) {
  const hue = layerHue(index);
  const accent = `hsl(${hue} 70% 60%)`;

  return (
    <div className={cn("group/layer", selected && "bg-primary/[0.04]")}>
      {/* Layer row. */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => {
            onSelect();
            onToggleLayer();
          }}
          style={{ width: LABEL_W }}
          className="sticky left-0 z-10 flex h-7 shrink-0 items-center gap-1 border-r border-border/40 bg-background px-1 text-xs text-foreground hover:bg-secondary/40 group-hover/layer:bg-secondary/20"
        >
          {layerOpen ? (
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          ) : (
            <ChevronRight className="size-3 shrink-0 opacity-60" />
          )}
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: accent }}
          />
          <span className="truncate font-mono">{track.nodeName}</span>
        </button>
        <div
          onPointerDown={onLaneDown}
          onPointerMove={onLaneMove}
          className="h-7 cursor-pointer border-b border-border/20 bg-secondary/[0.04]"
          style={{ width: laneW }}
        />
      </div>

      {/* Animation rows. */}
      {layerOpen &&
        track.animations.map((a, ai) => {
          const key = `${index}:${ai}`;
          const animOpen = openAnims.has(key);
          return (
            <div key={key}>
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => onToggleAnim(key)}
                  style={{ width: LABEL_W }}
                  className="sticky left-0 z-10 flex h-7 shrink-0 items-center gap-1 border-r border-border/40 bg-background pl-5 pr-1 text-[11px] text-muted-foreground hover:bg-secondary/40 group-hover/layer:bg-secondary/20"
                >
                  {animOpen ? (
                    <ChevronDown className="size-3 shrink-0 opacity-50" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0 opacity-50" />
                  )}
                  <span className="truncate font-mono">{a.name}</span>
                </button>
                <div
                  onPointerDown={onLaneDown}
                  onPointerMove={onLaneMove}
                  className="relative h-7 cursor-pointer border-b border-border/20"
                  style={{ width: laneW }}
                >
                  <Pill anim={a} ctx={ctx} hue={hue} />
                </div>
              </div>

              {/* Property rows. */}
              {animOpen &&
                a.properties.map((p, pi) => (
                  <PropertyRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
                    key={pi}
                    anim={a}
                    prop={p}
                    ctx={ctx}
                    laneW={laneW}
                    onLaneDown={onLaneDown}
                    onLaneMove={onLaneMove}
                  />
                ))}
            </div>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Animation pill: drag body = move delay, drag caps = trim delay/duration
// ---------------------------------------------------------------------------

type PillDrag = {
  mode: "move" | "left" | "right";
  startX: number;
  delay: number;
  duration: number;
};

function Pill({
  anim,
  ctx,
  hue,
}: {
  anim: TimelineAnimation;
  ctx: Ctx;
  hue: number;
}) {
  const [drag, setDrag] = useState<PillDrag | null>(null);
  const { active, entry } = animAnchor(anim, ctx.machineStates);

  const delay = drag ? drag.delay : anim.delay;
  const duration = drag ? drag.duration : anim.duration;
  const iters = Number.isFinite(anim.iterationCount) ? anim.iterationCount : 1;
  const startMs = entry + delay;
  const rawEndMs = startMs + duration * iters;
  const faded =
    !Number.isFinite(anim.iterationCount) || rawEndMs > ctx.displayEnd;
  const endMs = Math.min(
    Number.isFinite(anim.iterationCount) ? rawEndMs : ctx.displayEnd,
    ctx.displayEnd,
  );

  const clampedStart = Math.max(0, startMs);
  const left = clampedStart * ctx.ppm;
  const width = Math.max(6, (endMs - clampedStart) * ctx.ppm);
  const clampedNeg = startMs < 0;

  const badge = stateBadge(anim);

  const begin = (mode: PillDrag["mode"]) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      mode,
      startX: e.clientX,
      delay: anim.delay,
      duration: anim.duration,
    });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const dMs = (e.clientX - drag.startX) / ctx.ppm;
    if (drag.mode === "move") {
      setDrag({ ...drag, delay: snapMs(anim.delay + dMs) });
    } else if (drag.mode === "right") {
      setDrag({ ...drag, duration: Math.max(10, snapMs(anim.duration + dMs)) });
    } else {
      // Left cap: move the in-point, keeping the end fixed (trim from start).
      const newDelay = snapMs(anim.delay + dMs);
      const newDur = Math.max(10, snapMs(anim.duration - dMs));
      setDrag({ ...drag, delay: newDelay, duration: newDur });
    }
  };
  const end = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const changes: { delay?: number; duration?: number } = {};
    if (drag.delay !== anim.delay) changes.delay = drag.delay;
    if (drag.duration !== anim.duration) changes.duration = drag.duration;
    setDrag(null);
    if (changes.delay !== undefined || changes.duration !== undefined)
      ctx.commitRetime(anim.ruleSelector, anim.name, changes);
  };

  const title = clampedNeg
    ? `${anim.name} — starts ${fmtSeconds(-startMs)} before 0 (clamped)`
    : anim.name;

  return (
    <div
      className={cn(
        "absolute top-1/2 flex h-4 -translate-y-1/2 items-center overflow-hidden rounded-md text-[10px]",
        !active && "opacity-40 saturate-50",
        faded && "[mask-image:linear-gradient(to_right,black_72%,transparent)]",
      )}
      style={{
        left,
        width,
        background: `hsl(${hue} 60% ${active ? 42 : 34}% / 0.85)`,
        border: `1px solid hsl(${hue} 70% 62% / 0.9)`,
      }}
      title={title}
      onPointerDown={begin("move")}
      onPointerMove={move}
      onPointerUp={end}
      onLostPointerCapture={() => setDrag(null)}
    >
      {clampedNeg && (
        <span className="absolute inset-y-0 left-0 w-2 [background:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,0.35)_2px,rgba(255,255,255,0.35)_4px)]" />
      )}
      {/* Left trim cap. */}
      <span
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/30"
        onPointerDown={begin("left")}
        onPointerMove={move}
        onPointerUp={end}
      />
      <span className="pointer-events-none flex min-w-0 items-center gap-1 px-2 text-white/95">
        <span className="truncate">{anim.name}</span>
        {badge && (
          <span className="shrink-0 rounded-sm bg-black/25 px-1 text-[9px]">
            {badge}
          </span>
        )}
      </span>
      {/* Right trim cap. */}
      <span
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/30"
        onPointerDown={begin("right")}
        onPointerMove={move}
        onPointerUp={end}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property row: keyframe diamonds + easing glyphs + prev/next nav
// ---------------------------------------------------------------------------

function PropertyRow({
  anim,
  prop,
  ctx,
  laneW,
  onLaneDown,
  onLaneMove,
}: {
  anim: TimelineAnimation;
  prop: TimelineAnimationProperty;
  ctx: Ctx;
  laneW: number;
  onLaneDown: LaneHandler;
  onLaneMove: LaneHandler;
}) {
  const { entry } = animAnchor(anim, ctx.machineStates);
  const base = entry + anim.delay;
  const kfMs = (offset: number) => base + offset * anim.duration;
  const times = prop.keyframes.map((k) => kfMs(k.offset)).sort((a, b) => a - b);

  const seekAdjacent = (dir: -1 | 1) => {
    const cur = ctx.time;
    const eps = 0.5;
    const cands =
      dir < 0
        ? times.filter((t) => t < cur - eps)
        : times.filter((t) => t > cur + eps);
    if (!cands.length) return;
    ctx.seek(dir < 0 ? Math.max(...cands) : Math.min(...cands));
  };

  return (
    <div className="flex items-stretch">
      <div
        style={{ width: LABEL_W }}
        className="sticky left-0 z-10 flex h-6 shrink-0 items-center gap-0.5 border-r border-border/40 bg-background pl-8 pr-1 text-[11px] text-muted-foreground/80"
      >
        <button
          type="button"
          aria-label="Previous keyframe"
          onClick={() => seekAdjacent(-1)}
          className="rounded p-0.5 hover:bg-secondary/60 hover:text-foreground"
        >
          <ChevronLeft className="size-3" />
        </button>
        {/* Middle glyph is display-only — inserting keyframes is out of scope. */}
        <span title="Inserting keyframes isn't supported yet">
          <Diamond className="size-2.5 opacity-30" aria-hidden />
        </span>
        <button
          type="button"
          aria-label="Next keyframe"
          onClick={() => seekAdjacent(1)}
          className="rounded p-0.5 hover:bg-secondary/60 hover:text-foreground"
        >
          <ChevronRight className="size-3" />
        </button>
        <span className="ml-0.5 truncate font-mono">{prop.property}</span>
      </div>
      <div
        onPointerDown={onLaneDown}
        onPointerMove={onLaneMove}
        className="relative h-6 cursor-pointer overflow-hidden border-b border-border/10 bg-secondary/[0.02]"
        style={{ width: laneW }}
      >
        {/* Connecting segments + per-segment easing glyphs. */}
        {prop.keyframes.map((k, ki) => {
          const nxt = prop.keyframes[ki + 1];
          if (!nxt) return null;
          const x0 = kfMs(k.offset) * ctx.ppm;
          const x1 = kfMs(nxt.offset) * ctx.ppm;
          const tf = k.easing ?? anim.timingFunction;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
            <span key={`seg-${ki}`}>
              <span
                className="absolute top-1/2 h-px -translate-y-1/2 bg-border"
                style={{ left: x0, width: Math.max(0, x1 - x0) }}
              />
              {isNonLinear(tf) && x1 - x0 > 12 && (
                <span
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[10px] leading-none text-primary/80"
                  style={{ left: (x0 + x1) / 2 }}
                  title={easingLabel(tf)}
                >
                  ⌒
                </span>
              )}
            </span>
          );
        })}
        {/* Keyframe diamonds. */}
        {prop.keyframes.map((k, ki) => (
          <KfDiamond
            // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
            key={ki}
            anim={anim}
            prop={prop}
            kf={k}
            base={base}
            ctx={ctx}
          />
        ))}
      </div>
    </div>
  );
}

function KfDiamond({
  anim,
  prop,
  kf,
  base,
  ctx,
}: {
  anim: TimelineAnimation;
  prop: TimelineAnimationProperty;
  kf: Keyframe;
  base: number;
  ctx: Ctx;
}) {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const startX = useRef(0);
  const offset = dragOffset ?? kf.offset;
  const ms = base + offset * anim.duration;

  const begin = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    setDragOffset(kf.offset);
  };
  const move = (e: React.PointerEvent) => {
    if (dragOffset === null || anim.duration <= 0) return;
    e.stopPropagation();
    const dOff = (e.clientX - startX.current) / ctx.ppm / anim.duration;
    setDragOffset(Math.max(0, Math.min(1, kf.offset + dOff)));
  };
  const end = (e: React.PointerEvent) => {
    if (dragOffset === null) return;
    e.stopPropagation();
    const moved = Math.abs(dragOffset - kf.offset) > 0.0005;
    const next = dragOffset;
    setDragOffset(null);
    if (moved) ctx.commitKeyframe(anim.name, kf.offset, next);
    else ctx.seek(ms); // click = seek
  };

  return (
    <button
      type="button"
      title={`${prop.property} = ${kf.value}  @ ${fmtSeconds(ms)}`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onLostPointerCapture={() => setDragOffset(null)}
      className="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border border-primary bg-primary/70 hover:bg-primary"
      style={{ left: ms * ctx.ppm, cursor: "ew-resize" }}
    />
  );
}
