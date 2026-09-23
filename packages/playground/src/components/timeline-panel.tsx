import type { PopkornPlayer } from "@popkorn/player";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  LABEL_W,
  LANE_PAD,
  type LaneHandler,
  type TimelineCtx,
} from "@/components/timeline/geometry";
import { LayerBlock } from "@/components/timeline/layer-block";
import { PlayheadLine } from "@/components/timeline/playhead";
import { Ruler } from "@/components/timeline/ruler";
import { TransportBar } from "@/components/timeline/transport-bar";
import { usePlayerTimeline } from "@/components/timeline/use-player-timeline";
import { useTimelineZoom } from "@/components/timeline/use-timeline-zoom";
import {
  moveKeyframe,
  retimeAnimation,
  type TimelineEditResult,
} from "@/lib/timeline-edits";

/**
 * Figma-Motion/After-Effects–style editor timeline docked under the
 * editor|player|copilot row. A slim always-visible bar over an expandable body:
 * a shared horizontal time scale (`ppm`) drives a numbered ruler, a draggable
 * playhead, per-layer/animation/property rows, keyframe diamonds, and a
 * read-only machine strip. Pills drag to retime and diamonds drag to re-key —
 * both splice the SOURCE via lib/timeline-edits, validated before commit.
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
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const tl = usePlayerTimeline(player);
  const { zoom, setZoom, ppm, viewportW, scrollRef } = useTimelineZoom();
  const laneRef = useRef<HTMLDivElement>(null); // x-origin of the lanes
  // Latest source, read inside edit commits (which may fire after a re-render).
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const { seek, holdPlayback, displayEnd } = tl;
  const disabled = !player || displayEnd <= 0;
  const durationPx = displayEnd * ppm;
  const laneW = Math.max(durationPx + LANE_PAD, viewportW - LABEL_W);

  const scrub = useCallback(
    (clientX: number) => {
      const lane = laneRef.current;
      if (!lane) return;
      seek(Math.max(0, (clientX - lane.getBoundingClientRect().left) / ppm));
    },
    [seek, ppm],
  );
  const onLaneDown: LaneHandler = useCallback(
    (e) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      scrub(e.clientX);
    },
    [disabled, scrub],
  );
  const onLaneMove: LaneHandler = useCallback(
    (e) => {
      if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
      scrub(e.clientX);
    },
    [disabled, scrub],
  );

  const commit = useCallback(
    (r: TimelineEditResult, label: string) => {
      if (!r.ok) {
        const msg = `${label} failed: ${r.error}`;
        setEditErr(msg);
        window.setTimeout(
          () => setEditErr((cur) => (cur === msg ? null : cur)),
          4000,
        );
        return;
      }
      if (r.source === sourceRef.current) return;
      holdPlayback();
      onEditSource(r.source);
    },
    [holdPlayback, onEditSource],
  );

  const ctx: TimelineCtx = useMemo(
    () => ({
      ppm,
      displayEnd,
      machineStates: tl.machineStates,
      clock: tl.clock,
      seek,
      commitRetime: (selector, name, changes) =>
        commit(
          retimeAnimation(sourceRef.current, selector, name, changes),
          "Retime",
        ),
      commitKeyframe: (name, oldOffset, newOffset) =>
        commit(
          moveKeyframe(sourceRef.current, name, oldOffset, newOffset),
          "Keyframe move",
        ),
      onLaneDown,
      onLaneMove,
    }),
    [
      ppm,
      displayEnd,
      tl.machineStates,
      tl.clock,
      seek,
      commit,
      onLaneDown,
      onLaneMove,
    ],
  );

  return (
    <div
      data-tour="timeline"
      className="shrink-0 border-t border-border bg-background"
    >
      <TransportBar
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
        paused={tl.paused}
        disabled={disabled}
        onTogglePlay={tl.togglePlay}
        clock={tl.clock}
        displayEnd={displayEnd}
        onSeek={seek}
        editErr={editErr}
        zoom={zoom}
        onZoom={setZoom}
      />

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
            <div className="relative" style={{ width: LABEL_W + laneW }}>
              <Ruler
                laneRef={laneRef}
                laneW={laneW}
                durationPx={durationPx}
                displayEnd={displayEnd}
                ppm={ppm}
                clock={tl.clock}
                machineStates={tl.machineStates}
                onLaneDown={onLaneDown}
                onLaneMove={onLaneMove}
              />
              <div className="relative">
                <PlayheadLine clock={tl.clock} ppm={ppm} />
                {tl.tracks.map((track, i) => (
                  <LayerBlock
                    // biome-ignore lint/suspicious/noArrayIndexKey: scene order stable within a snapshot
                    key={i}
                    index={i}
                    track={track}
                    ctx={ctx}
                    laneW={laneW}
                    layerOpen={tl.openLayers.has(track.nodeName)}
                    openAnims={tl.openAnims}
                    selected={selected === i}
                    onSelect={setSelected}
                    onToggleLayer={tl.toggleLayer}
                    onToggleAnim={tl.toggleAnim}
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
