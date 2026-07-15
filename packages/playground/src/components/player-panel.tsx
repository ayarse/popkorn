import {
  AlertCircle,
  ChevronDown,
  Film,
  Layers,
  Maximize,
  PanelBottom,
  PanelBottomDashed,
  Repeat,
  RepeatOff,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BgContextMenu,
  PLAYER_BACKGROUNDS,
} from "@/components/bg-context-menu";
import { MotionCanvas } from "@/components/motion-canvas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type FitMode = "contain" | "cover" | "fill" | "none";

const FIT_MODES: { value: FitMode; label: string }[] = [
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "fill", label: "Fill" },
  { value: "none", label: "None" },
];

type RendererKind = "canvas" | "svg";

const RENDERERS: { value: RendererKind; label: string }[] = [
  { value: "canvas", label: "Canvas" },
  { value: "svg", label: "SVG (WIP)" },
];

export function PlayerPanel({
  source,
  error,
  onError,
  onPlayerReady,
}: {
  source: string;
  error: string | null;
  onError: (message: string | null) => void;
  onPlayerReady?: (
    player: import("@popkorn/player").PopkornPlayer | null,
  ) => void;
}) {
  const [bgIndex, setBgIndex] = useState(3); // Graphite
  const [controlsVisible, setControlsVisible] = useState(true);
  const [loop, setLoop] = useState(true);
  const [fit, setFit] = useState<FitMode>("contain");
  const [renderer, setRenderer] = useState<RendererKind>("canvas");
  // null = idle; otherwise the in-flight export's format + 0..1 progress.
  const [exporting, setExporting] = useState<{
    format: "GIF" | "MP4";
    progress: number;
  } | null>(null);
  // Right-click context menu over the player area ({x,y} | null).
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  // The live player element (captured from onPlayerReady) and the latest player
  // DOM event, flashed as an ephemeral badge so the interactivity is demoable
  // without per-example JS. Newest replaces the previous; auto-dismisses.
  const [player, setPlayer] = useState<
    import("@popkorn/player").PopkornPlayer | null
  >(null);
  const [eventBadge, setEventBadge] = useState<string | null>(null);
  const badgeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!player) return;
    const flash = (text: string) => {
      setEventBadge(text);
      if (badgeTimer.current !== null) clearTimeout(badgeTimer.current);
      badgeTimer.current = window.setTimeout(() => setEventBadge(null), 1500);
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
      if (badgeTimer.current !== null) clearTimeout(badgeTimer.current);
    };
  }, [player]);

  const setProgress = (format: "GIF" | "MP4") => (progress: number) =>
    setExporting({ format, progress });

  async function handleExportGif() {
    if (exporting !== null) return;
    setExporting({ format: "GIF", progress: 0 });
    try {
      const { exportGifInWorker, downloadGif } = await import("@/lib/gif");
      downloadGif(
        await exportGifInWorker(source, { onProgress: setProgress("GIF") }),
      );
    } catch (e: any) {
      onError(`GIF export failed: ${e.message}`);
    } finally {
      setExporting(null);
    }
  }

  async function handleExportMp4() {
    if (exporting !== null) return;
    setExporting({ format: "MP4", progress: 0 });
    try {
      const { exportMp4InWorker, downloadMp4 } = await import("@/lib/mp4");
      downloadMp4(
        await exportMp4InWorker(source, { onProgress: setProgress("MP4") }),
      );
    } catch (e: any) {
      onError(`MP4 export failed: ${e.message}`);
    } finally {
      setExporting(null);
    }
  }

  // WebCodecs is required for MP4; hide that item where it's unavailable.
  const canExportMp4 = typeof VideoEncoder !== "undefined";

  const activeBg = PLAYER_BACKGROUNDS[bgIndex];

  return (
    <div className="flex flex-1 flex-col bg-background overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <div className="ml-auto flex items-center gap-1">
          {/* Fit mode */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5">
                    <Maximize className="size-3.5" />
                    {FIT_MODES.find((m) => m.value === fit)?.label}
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Fit mode</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuRadioGroup
                value={fit}
                onValueChange={(v) => setFit(v as FitMode)}
              >
                {FIT_MODES.map((m) => (
                  <DropdownMenuRadioItem key={m.value} value={m.value}>
                    {m.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Renderer backend (dev/testing affordance) */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5">
                    <Layers className="size-3.5" />
                    {RENDERERS.find((r) => r.value === renderer)?.label}
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Renderer backend</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuRadioGroup
                value={renderer}
                onValueChange={(v) => setRenderer(v as RendererKind)}
              >
                {RENDERERS.map((r) => (
                  <DropdownMenuRadioItem key={r.value} value={r.value}>
                    {r.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Loop toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLoop((v) => !v)}
              >
                {loop ? (
                  <Repeat className="size-4" />
                ) : (
                  <RepeatOff className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {loop ? "Loop playback" : "Loop playback (off)"}
            </TooltipContent>
          </Tooltip>

          {/* Toggle playback controls */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setControlsVisible((v) => !v)}
              >
                {controlsVisible ? (
                  <PanelBottom className="size-4" />
                ) : (
                  <PanelBottomDashed className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {controlsVisible
                ? "Hide playback controls"
                : "Show playback controls"}
            </TooltipContent>
          </Tooltip>

          {/* Export (GIF / MP4) */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    disabled={exporting !== null}
                  >
                    <Film className="size-3.5" />
                    {exporting !== null
                      ? `Exporting ${exporting.format}… ${Math.round(exporting.progress * 100)}%`
                      : "Export"}
                    {exporting === null && (
                      <ChevronDown className="size-3 opacity-60" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export animation</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem onSelect={handleExportGif}>
                <Film className="size-3.5" />
                GIF
              </DropdownMenuItem>
              {canExportMp4 && (
                <DropdownMenuItem onSelect={handleExportMp4}>
                  <Video className="size-3.5" />
                  MP4
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="mx-1 h-5 w-px bg-border" />

          {/* Background color picker */}
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <span
                      className="size-4 rounded-full border border-border/60"
                      style={
                        activeBg.value === "transparent"
                          ? {
                              backgroundImage:
                                "linear-gradient(135deg, transparent 47%, #888 47%, #888 53%, transparent 53%)",
                              backgroundColor: "var(--background)",
                            }
                          : { backgroundColor: activeBg.swatch }
                      }
                    />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Background color</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-48 p-1.5">
              <div className="grid grid-cols-2 gap-0.5">
                {PLAYER_BACKGROUNDS.map((bg, i) => (
                  <button
                    type="button"
                    key={bg.name}
                    onClick={() => setBgIndex(i)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-secondary/60",
                      bgIndex === i && "bg-secondary/60",
                    )}
                  >
                    <span
                      className="size-3.5 shrink-0 rounded-full border border-border/40"
                      style={
                        bg.value === "transparent"
                          ? {
                              backgroundImage:
                                "linear-gradient(135deg, transparent 47%, #888 47%, #888 53%, transparent 53%)",
                              backgroundColor: "var(--background)",
                            }
                          : { backgroundColor: bg.swatch }
                      }
                    />
                    <span className="truncate">{bg.name}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Player content */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click affordance only (background menu also reachable via the toolbar); no semantic element or keyboard equivalent applies */}
      <div
        className="relative flex flex-1 items-center justify-center p-6 overflow-hidden"
        onContextMenu={(e) => {
          e.preventDefault();
          setBgMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div
          className="flex w-full max-w-[960px] rounded-xl border border-border/60 shadow-2xl shadow-black/30 overflow-hidden"
          style={{
            height: "100%",
            backgroundColor:
              activeBg.value === "transparent" ? undefined : activeBg.value,
          }}
        >
          <MotionCanvas
            key={renderer}
            source={source}
            controls={controlsVisible}
            loop={loop}
            fit={fit}
            renderer={renderer}
            style={{ height: "100%", backgroundColor: activeBg.value }}
            onError={(err) => onError(err.message)}
            onSceneReady={() => onError(null)}
            onPlayerReady={(p) => {
              setPlayer(p);
              onPlayerReady?.(p);
            }}
          />
        </div>

        {/* Event badge — flashes the latest player DOM event (click / machine).
            Non-interactive so it never intercepts the pointer. */}
        {eventBadge && (
          <div className="pointer-events-none absolute top-4 right-4 z-30 rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5 font-mono text-xs text-foreground backdrop-blur-md">
            {eventBadge}
          </div>
        )}

        {/* Error toast */}
        {error && (
          <div className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground backdrop-blur-md">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <span className="max-w-[420px] truncate font-mono">{error}</span>
          </div>
        )}

        {/* Right-click background context menu */}
        {bgMenu && (
          <BgContextMenu
            position={bgMenu}
            onClose={() => setBgMenu(null)}
            bgIndex={bgIndex}
            onSelect={setBgIndex}
          />
        )}
      </div>
    </div>
  );
}
