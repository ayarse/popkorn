import type {
  TimelineAnimation,
  TimelineAnimationProperty,
} from "@popkorn/player";
import { ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import { memo, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  animAnchor,
  easingLabel,
  isNonLinear,
  type Keyframe,
  LABEL_W,
  type TimelineCtx,
} from "./geometry";
import { fmtSeconds } from "./scale";

/** Property row: keyframe diamonds + easing glyphs + prev/next nav. */
export const PropertyRow = memo(function PropertyRow({
  anim,
  prop,
  ctx,
  laneW,
}: {
  anim: TimelineAnimation;
  prop: TimelineAnimationProperty;
  ctx: TimelineCtx;
  laneW: number;
}) {
  const { entry } = animAnchor(anim, ctx.machineStates);
  const base = entry + anim.delay;
  const kfMs = (offset: number) => base + offset * anim.duration;

  const seekAdjacent = (dir: -1 | 1) => {
    const cur = ctx.clock.get();
    const eps = 0.5;
    const times = prop.keyframes.map((k) => kfMs(k.offset));
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
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Diamond className="size-2.5 opacity-30" aria-hidden />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Inserting keyframes isn't supported yet
          </TooltipContent>
        </Tooltip>
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
        onPointerDown={ctx.onLaneDown}
        onPointerMove={ctx.onLaneMove}
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
        {prop.keyframes.map((k, ki) => (
          <KfDiamond
            // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
            key={ki}
            anim={anim}
            property={prop.property}
            kf={k}
            base={base}
            ctx={ctx}
          />
        ))}
      </div>
    </div>
  );
});

/** Keyframe diamond: drag to re-key, click to seek. */
const KfDiamond = memo(function KfDiamond({
  anim,
  property,
  kf,
  base,
  ctx,
}: {
  anim: TimelineAnimation;
  property: string;
  kf: Keyframe;
  base: number;
  ctx: TimelineCtx;
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
      title={`${property} = ${kf.value}  @ ${fmtSeconds(ms)}`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onLostPointerCapture={() => setDragOffset(null)}
      className="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border border-primary bg-primary/70 hover:bg-primary"
      style={{ left: ms * ctx.ppm, cursor: "ew-resize" }}
    />
  );
});
