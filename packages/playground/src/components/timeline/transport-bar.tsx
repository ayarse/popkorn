import { AlertCircle, ChevronDown, ChevronUp, Pause, Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { TimeInput, TimeReadout } from "./playhead";
import { ZOOM_MAX, ZOOM_MIN } from "./scale";
import type { Clock } from "./use-player-timeline";

/** Always-visible bar: collapse, transport, current time, edit error, zoom. */
export function TransportBar({
  expanded,
  onToggleExpanded,
  paused,
  disabled,
  onTogglePlay,
  clock,
  displayEnd,
  onSeek,
  editErr,
  zoom,
  onZoom,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
  paused: boolean;
  disabled: boolean;
  onTogglePlay: () => void;
  clock: Clock;
  displayEnd: number;
  onSeek: (ms: number) => void;
  editErr: string | null;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-2 px-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleExpanded}
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
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={paused ? "Play" : "Pause"}
      >
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </Button>

      <div className="flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
        <TimeInput clock={clock} disabled={disabled} onSeek={onSeek} />
        <span>ms</span>
        <TimeReadout clock={clock} displayEnd={displayEnd} />
      </div>

      {editErr && (
        <Alert
          variant="destructive"
          className="ml-2 min-w-0 items-center py-0.5 text-[11px]"
          title={editErr}
        >
          <AlertCircle />
          <span className="truncate">{editErr}</span>
        </Alert>
      )}

      {/* Zoom slider — hidden while collapsed so it can't read as artboard zoom. */}
      <div
        className={cn(
          "ml-auto flex items-center gap-2 text-muted-foreground",
          !expanded && "hidden",
        )}
      >
        <span className="text-[11px]">Zoom</span>
        <Slider
          aria-label="Timeline zoom"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.05}
          value={[zoom]}
          disabled={disabled}
          onValueChange={([z]) => onZoom(z)}
          className="w-24"
        />
      </div>
    </div>
  );
}
