import type { PopkornPlayer } from "@popkorn/player";
import { useEffect, useState } from "react";
import AgentChat from "@/components/agent/agent-chat";
import { AppHeader } from "@/components/app-header";
import { ImportModal } from "@/components/import-modal";
import { PlayerPanel } from "@/components/player-panel";
import { ResizeHandle, useSplit } from "@/components/resize-handle";
import { SourcePanel } from "@/components/source-panel";
import { TimelinePanel } from "@/components/timeline-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useScene } from "@/hooks/use-scene";
import { maybeStartTour } from "@/lib/tour";

function App() {
  const scene = useScene();
  const [showImport, setShowImport] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [player, setPlayer] = useState<PopkornPlayer | null>(null);
  // Desktop: editor left / player right (horizontal split). Mobile: player on
  // top / editor below (vertical stack), no timeline.
  const isMobile = useIsMobile();
  const split = useSplit(isMobile);
  const [sourceCollapsed, setSourceCollapsed] = useState(false);

  // First-run onboarding tour — fire once the layout has painted so every
  // `[data-tour]` target exists to be highlighted.
  useEffect(() => {
    const t = window.setTimeout(maybeStartTour, 600);
    return () => window.clearTimeout(t);
  }, []);

  const playerNode = (
    <PlayerPanel
      source={scene.source}
      error={scene.error}
      onError={scene.setError}
      onPlayerReady={setPlayer}
    />
  );
  const sourceNode = (
    <SourcePanel
      source={scene.source}
      onSourceChange={scene.editSource}
      sizeDelta={scene.sizeDelta}
      minified={scene.minified}
      onToggleMinify={scene.toggleMinify}
      onCrush={scene.crush}
      collapsed={sourceCollapsed}
      onToggleCollapse={() => setSourceCollapsed((v) => !v)}
    />
  );

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col bg-background text-foreground">
        <AppHeader
          currentExample={scene.currentExample}
          onSelectExample={scene.selectExample}
          importResult={scene.importResult}
          onDismissImport={scene.dismissImport}
          onImport={() => setShowImport(true)}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
        />

        {/* Desktop: [editor | handle | player]. Mobile: [player / handle /
            editor] stacked. The first slot holds whichever panel leads
            (editor on desktop, player on mobile) and the handle's frac sizes
            it. When the editor collapses, it shrinks to its rail (0 0 auto)
            and the other panel takes the rest — independent of orientation. */}
        <div
          className={
            isMobile
              ? "flex flex-1 flex-col overflow-hidden"
              : "flex flex-1 overflow-hidden"
          }
        >
          <div
            data-tour={isMobile ? "player" : "source"}
            className="flex min-h-0 min-w-0 overflow-hidden"
            style={{
              // First slot is the editor on desktop, the player on mobile.
              flex: sourceCollapsed
                ? isMobile
                  ? "1 1 0"
                  : "0 0 auto"
                : `${split.frac} 1 0`,
            }}
          >
            {isMobile ? playerNode : sourceNode}
          </div>

          {!sourceCollapsed && (
            <ResizeHandle
              frac={split.frac}
              min={split.min}
              max={split.max}
              vertical={isMobile}
              onPointerDown={split.onPointerDown}
              onKeyDown={split.onKeyDown}
            />
          )}

          <div
            data-tour={isMobile ? "source" : "player"}
            className="flex min-h-0 min-w-0 overflow-hidden"
            style={{
              // Second slot is the editor on mobile, the player on desktop.
              flex: sourceCollapsed
                ? isMobile
                  ? "0 0 auto"
                  : "1 1 0"
                : `${1 - split.frac} 1 0`,
            }}
          >
            {isMobile ? sourceNode : playerNode}
          </div>

          {/* Agent chat — sidebar on desktop, fullscreen drawer on mobile */}
          <AgentChat
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            source={scene.source}
            onApplySource={scene.applyGenerated}
            fullscreen={isMobile}
          />
        </div>

        {/* Timeline is desktop-only — skip it entirely on mobile. */}
        {!isMobile && (
          <TimelinePanel
            player={player}
            source={scene.source}
            onEditSource={scene.editSource}
          />
        )}

        {showImport && (
          <ImportModal
            onFile={(file) => {
              void scene.importFile(file).then((ok) => {
                if (ok) setShowImport(false);
              });
            }}
            onText={(text) => {
              if (scene.importText(text)) setShowImport(false);
            }}
            onClose={() => setShowImport(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
