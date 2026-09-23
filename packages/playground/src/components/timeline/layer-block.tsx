import type { TimelineTrack } from "@popkorn/player";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { LABEL_W, type TimelineCtx } from "./geometry";
import { Pill } from "./pill";
import { PropertyRow } from "./property-row";
import { layerHue } from "./scale";

/** Layer row → animation rows → property rows. */
export const LayerBlock = memo(function LayerBlock({
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
}: {
  index: number;
  track: TimelineTrack;
  ctx: TimelineCtx;
  laneW: number;
  layerOpen: boolean;
  openAnims: Set<string>;
  selected: boolean;
  onSelect: (index: number) => void;
  onToggleLayer: (nodeName: string) => void;
  onToggleAnim: (key: string) => void;
}) {
  const hue = layerHue(index);

  return (
    <div className={cn("group/layer", selected && "bg-primary/[0.04]")}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => {
            onSelect(index);
            onToggleLayer(track.nodeName);
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
            style={{ background: `hsl(${hue} 70% 60%)` }}
          />
          <span className="truncate font-mono">{track.nodeName}</span>
        </button>
        <div
          onPointerDown={ctx.onLaneDown}
          onPointerMove={ctx.onLaneMove}
          className="h-7 cursor-pointer border-b border-border/20 bg-secondary/[0.04]"
          style={{ width: laneW }}
        />
      </div>

      {layerOpen &&
        track.animations.map((a, ai) => {
          const animKey = `${track.nodeName}/${a.ruleSelector}/${a.name}`;
          const animOpen = openAnims.has(animKey);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
            <div key={ai}>
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => onToggleAnim(animKey)}
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
                  onPointerDown={ctx.onLaneDown}
                  onPointerMove={ctx.onLaneMove}
                  className="relative h-7 cursor-pointer border-b border-border/20"
                  style={{ width: laneW }}
                >
                  <Pill anim={a} ctx={ctx} hue={hue} />
                </div>
              </div>

              {animOpen &&
                a.properties.map((p, pi) => (
                  <PropertyRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable within a snapshot
                    key={pi}
                    anim={a}
                    prop={p}
                    ctx={ctx}
                    laneW={laneW}
                  />
                ))}
            </div>
          );
        })}
    </div>
  );
});
