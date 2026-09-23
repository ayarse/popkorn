import type { TimelineAnimation } from "@popkorn/player";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  animAnchor,
  animSpan,
  MIN_DURATION,
  stateBadge,
  type TimelineCtx,
  trimStart,
} from "./geometry";
import { fmtSeconds, snapMs } from "./scale";

type PillDrag = {
  mode: "move" | "left" | "right";
  startX: number;
  delay: number;
  duration: number;
};

/** Animation pill: drag body = move delay, drag caps = trim delay/duration. */
export const Pill = memo(function Pill({
  anim,
  ctx,
  hue,
}: {
  anim: TimelineAnimation;
  ctx: TimelineCtx;
  hue: number;
}) {
  const [drag, setDrag] = useState<PillDrag | null>(null);
  const { active, entry } = animAnchor(anim, ctx.machineStates);
  const span = animSpan(
    {
      delay: drag ? drag.delay : anim.delay,
      duration: drag ? drag.duration : anim.duration,
      iterationCount: anim.iterationCount,
    },
    entry,
    ctx.displayEnd,
  );
  const endMs = Math.min(span.end, ctx.displayEnd);
  const clampedStart = Math.max(0, span.start);
  const left = clampedStart * ctx.ppm;
  const width = Math.max(6, (endMs - clampedStart) * ctx.ppm);
  const clampedNeg = span.start < 0;
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
      setDrag({
        ...drag,
        duration: Math.max(MIN_DURATION, snapMs(anim.duration + dMs)),
      });
    } else {
      setDrag({ ...drag, ...trimStart(anim.delay, anim.duration, dMs) });
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
    ? `${anim.name} — starts ${fmtSeconds(-span.start)} before 0 (clamped)`
    : anim.name;

  return (
    <div
      className={cn(
        "absolute top-1/2 flex h-4 -translate-y-1/2 items-center overflow-hidden rounded-md text-[10px]",
        !active && "opacity-40 saturate-50",
        span.faded &&
          "[mask-image:linear-gradient(to_right,black_72%,transparent)]",
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
});
