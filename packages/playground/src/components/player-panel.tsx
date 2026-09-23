import type { PopkornPlayer } from "@popkorn/player";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import {
  BgContextMenu,
  PLAYER_BACKGROUNDS,
} from "@/components/bg-context-menu";
import { ExportDialog } from "@/components/export-dialog";
import { MotionCanvas } from "@/components/motion-canvas";
import { OwnerActions } from "@/components/owner-actions";
import { Attribution } from "@/components/player/attribution";
import { ExportMenu } from "@/components/player/export-menu";
import { useEventBadge } from "@/components/player/use-event-badge";
import { useExport } from "@/components/player/use-export";
import {
  BgPicker,
  type FitMode,
  type RendererKind,
  ViewControls,
} from "@/components/player/view-controls";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { CommunityScene } from "@/hooks/use-scene";
import { parseSceneMeta } from "@/lib/scene-meta";

export function PlayerPanel({
  source,
  playerSource,
  community,
  error,
  onError,
  player,
  onPlayerReady,
}: {
  /** Latest editor text (save, export, attribution). */
  source: string;
  /** What the player renders — trails `source` while typing. */
  playerSource: string;
  /** Set only on `/s/$id`; its `mine` flag unlocks the owner controls. */
  community: CommunityScene | null;
  error: string | null;
  onError: (message: string | null) => void;
  player: PopkornPlayer | null;
  onPlayerReady: (player: PopkornPlayer | null) => void;
}) {
  const [bgIndex, setBgIndex] = useState(3); // Graphite
  const [controlsVisible, setControlsVisible] = useState(true);
  const [loop, setLoop] = useState(true);
  const [fit, setFit] = useState<FitMode>("contain");
  const [renderer, setRenderer] = useState<RendererKind>("canvas");
  // Right-click context menu over the player area ({x,y} | null).
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  const eventBadge = useEventBadge(player);
  const { exporting, prompt, closePrompt, runExport, cancelExport } =
    useExport(source);

  const activeBg = PLAYER_BACKGROUNDS[bgIndex];
  const meta = parseSceneMeta(source);
  const author = meta.Author;

  return (
    <div className="flex flex-1 flex-col bg-background overflow-hidden">
      {/* Toolbar */}
      {/* Scrolls sideways rather than clipping: on a phone the owner controls
          and the view controls together outrun the width. */}
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          <ViewControls
            fit={fit}
            onFit={setFit}
            renderer={renderer}
            onRenderer={setRenderer}
            loop={loop}
            onToggleLoop={() => setLoop((v) => !v)}
            controls={controlsVisible}
            onToggleControls={() => setControlsVisible((v) => !v)}
          />
          <ExportMenu
            exporting={exporting}
            onExport={runExport}
            onCancel={cancelExport}
          />
          <div className="mx-1 h-5 w-px bg-border" />
          <BgPicker bgIndex={bgIndex} onSelect={setBgIndex} />
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
            source={playerSource}
            controls={controlsVisible}
            loop={loop}
            fit={fit}
            renderer={renderer}
            style={{ height: "100%", backgroundColor: activeBg.value }}
            onError={(err) => onError(err.message)}
            onSceneReady={() => onError(null)}
            onPlayerReady={onPlayerReady}
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
          <Badge
            variant="glass"
            shape="tag"
            className="pointer-events-none absolute top-4 left-4 z-30 font-mono font-normal"
          >
            {eventBadge}
          </Badge>
        )}
        {/* Scene error overlay */}
        {error && (
          <Alert
            variant="destructive"
            className="absolute bottom-5 left-1/2 z-30 w-max max-w-[calc(100%-2.5rem)] -translate-x-1/2 items-center text-foreground backdrop-blur-md"
          >
            <AlertCircle />
            <span className="max-w-[420px] truncate font-mono" title={error}>
              {error}
            </span>
          </Alert>
        )}
        {bgMenu && (
          <BgContextMenu
            key={`${bgMenu.x},${bgMenu.y}`}
            position={bgMenu}
            onClose={() => setBgMenu(null)}
            bgIndex={bgIndex}
            onSelect={setBgIndex}
          />
        )}
        {prompt && (
          <ExportDialog
            format={prompt.format}
            stage={prompt.stage}
            scale={prompt.scale}
            lengthMs={prompt.lengthMs}
            onSubmit={closePrompt}
            onCancel={() => closePrompt(null)}
          />
        )}
      </div>
    </div>
  );
}
