import {
  AlertCircle,
  ChevronDown,
  FileJson,
  Film,
  Info,
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
import { type ExportChoice, ExportDialog } from "@/components/export-dialog";
import { MotionCanvas } from "@/components/motion-canvas";
import { OwnerActions } from "@/components/owner-actions";
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
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { CommunityScene } from "@/hooks/use-scene";
import { parseSceneMeta } from "@/lib/scene-meta";
import { cn } from "@/lib/utils";

/** Icon-sized credit pill that expands to the author name on hover/focus.
 * On mobile (no hover) the first tap expands it; only the second follows the
 * link, so a stray tap doesn't yank the user off the page. */
function Attribution({
  author,
  url,
  className,
}: {
  author: string;
  url?: string;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const Tag: any = url ? "a" : "div";
  return (
    <Tag
      {...(url ? { href: url, target: "_blank", rel: "noreferrer" } : {})}
      title={author}
      onClick={(e: React.MouseEvent) => {
        if (isMobile && !expanded) {
          e.preventDefault();
          setExpanded(true);
        }
      }}
      onBlur={() => setExpanded(false)}
      className={cn(
        "group flex items-center rounded-full border border-border/40 bg-background/50 px-1.5 py-1 text-[10px] text-muted-foreground backdrop-blur-md transition-colors hover:bg-background/85 hover:text-foreground",
        expanded && "bg-background/85 text-foreground",
        className,
      )}
    >
      <Info className="size-3 shrink-0" />
      <span
        className={cn(
          "max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-[220px] group-hover:pl-1.5",
          expanded && "max-w-[220px] pl-1.5",
        )}
      >
        {author}
      </span>
    </Tag>
  );
}

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
  community,
  error,
  onError,
  onPlayerReady,
}: {
  source: string;
  /** Set only on `/s/$id`; its `mine` flag unlocks the owner controls. */
  community: CommunityScene | null;
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

  // Pending export dialog; resolve(null) = cancelled.
  const [exportPrompt, setExportPrompt] = useState<{
    format: string;
    stage: { width: number; height: number };
    scale?: { default: number; max: number };
    lengthMs?: number;
    resolve: (choice: ExportChoice | null) => void;
  } | null>(null);

  /** Asks for export settings: raster formats always (scale), any format needing a length. */
  async function askExportSettings(
    format: "GIF" | "MP4" | "Lottie",
  ): Promise<ExportChoice | null> {
    const [{ parse }, { buildSceneGraph, sceneExportLength }, { maxMp4Scale }] =
      await Promise.all([
        import("@popkorn/parser"),
        import("@popkorn/player"),
        import("@/lib/mp4-plan"),
      ]);
    const ast = parse(source);
    const length = sceneExportLength(buildSceneGraph(ast), ast.variables);
    const lengthMs = length && !length.fixed ? length.suggestedMs : undefined;
    const stage = {
      width: ast.canvas?.width ?? 400,
      height: ast.canvas?.height ?? 300,
    };
    const mp4Max = maxMp4Scale(stage.width, stage.height);
    const scale = {
      GIF: { default: 1, max: 3 },
      MP4: { default: Math.min(2, mp4Max), max: mp4Max },
      Lottie: undefined,
    }[format];
    if (!scale && lengthMs === undefined) return {};
    return new Promise((resolve) =>
      setExportPrompt({ format, stage, scale, lengthMs, resolve }),
    );
  }

  function closeExportPrompt(choice: ExportChoice | null) {
    exportPrompt?.resolve(choice);
    setExportPrompt(null);
  }

  async function handleExportGif() {
    if (exporting !== null) return;
    try {
      const choice = await askExportSettings("GIF");
      if (!choice) return;
      setExporting({ format: "GIF", progress: 0 });
      const { exportGifInWorker, downloadGif } = await import("@/lib/gif");
      downloadGif(
        await exportGifInWorker(source, {
          onProgress: setProgress("GIF"),
          ...choice,
        }),
      );
    } catch (e: any) {
      onError(`GIF export failed: ${e.message}`);
    } finally {
      setExporting(null);
    }
  }

  async function handleExportMp4() {
    if (exporting !== null) return;
    try {
      const choice = await askExportSettings("MP4");
      if (!choice) return;
      setExporting({ format: "MP4", progress: 0 });
      const { exportMp4InWorker, downloadMp4 } = await import("@/lib/mp4");
      downloadMp4(
        await exportMp4InWorker(source, {
          onProgress: setProgress("MP4"),
          ...choice,
        }),
      );
    } catch (e: any) {
      onError(`MP4 export failed: ${e.message}`);
    } finally {
      setExporting(null);
    }
  }

  async function handleExportLottie() {
    try {
      const choice = await askExportSettings("Lottie");
      if (!choice) return;
      const { convertPopkorn } = await import("@popkorn/converters");
      const { lottie, warnings } = convertPopkorn(source, {
        durationMs: choice.durationMs,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(lottie)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "scene.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (warnings.length)
        onError(
          `Lottie exported with ${warnings.length} warning${warnings.length > 1 ? "s" : ""}: ${warnings.join("; ")}`,
        );
    } catch (e: any) {
      onError(`Lottie export failed: ${e.message}`);
    }
  }

  // WebCodecs is required for MP4; hide that item where it's unavailable.
  const canExportMp4 = typeof VideoEncoder !== "undefined";

  const activeBg = PLAYER_BACKGROUNDS[bgIndex];
  const meta = parseSceneMeta(source);
  const author = meta.Author;

  return (
    <div className="flex flex-1 flex-col bg-background overflow-hidden">
      {/* Toolbar */}
      {/* Scrolls sideways rather than clipping: on a phone the owner controls
          and the view controls together outrun the width. */}
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2">
        {community?.mine && (
          <div className="flex shrink-0 items-center gap-1">
            <OwnerActions
              key={community.id}
              community={community}
              source={source}
            />
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
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

          {/* Export (GIF / MP4 / Lottie) */}
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
              <DropdownMenuItem onSelect={handleExportLottie}>
                <FileJson className="size-3.5" />
                Lottie
              </DropdownMenuItem>
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
        {/* Attribution badge — icon-only until hovered, so it stays out of the
            way of the scene. Fed by the example file's `Author:` header. */}
        {author && (
          <Attribution
            className="absolute top-9 right-9 z-20"
            author={author}
            url={meta["Author URL"]}
          />
        )}
        {/* Event badge — flashes the latest player DOM event (click / machine).
            Non-interactive so it never intercepts the pointer. */}
        {eventBadge && (
          <div className="pointer-events-none absolute top-4 left-4 z-30 rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5 font-mono text-xs text-foreground backdrop-blur-md">
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
        {exportPrompt && (
          <ExportDialog
            format={exportPrompt.format}
            stage={exportPrompt.stage}
            scale={exportPrompt.scale}
            lengthMs={exportPrompt.lengthMs}
            onSubmit={closeExportPrompt}
            onCancel={() => closeExportPrompt(null)}
          />
        )}
      </div>
    </div>
  );
}
