import { memo, type Ref } from "react";
import { LABEL_W, type LaneHandler, type MachineState } from "./geometry";
import { PlayheadGrabber } from "./playhead";
import { tickStep, ticks } from "./scale";
import type { Clock } from "./use-player-timeline";

/** Sticky header: numbered ruler (scrub lane + grabber) over the machine strip. */
export const Ruler = memo(function Ruler({
  laneRef,
  laneW,
  durationPx,
  displayEnd,
  ppm,
  clock,
  machineStates,
  onLaneDown,
  onLaneMove,
}: {
  laneRef: Ref<HTMLDivElement>;
  laneW: number;
  durationPx: number;
  displayEnd: number;
  ppm: number;
  clock: Clock;
  machineStates: MachineState[];
  onLaneDown: LaneHandler;
  onLaneMove: LaneHandler;
}) {
  return (
    <div className="sticky top-0 z-30 bg-background">
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
          {ticks(displayEnd, tickStep(ppm)).map((t) => (
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
          <PlayheadGrabber clock={clock} ppm={ppm} />
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
  );
});
