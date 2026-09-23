import type { PopkornPlayer } from "@popkorn/player";
import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AgentChat from "@/components/agent/agent-chat";
import { AppHeader } from "@/components/app-header";
import { ImportModal } from "@/components/import-modal";
import { PlayerPanel } from "@/components/player-panel";
import { ShareModal } from "@/components/share-modal";
import { SourcePanel } from "@/components/source-panel";
import { TimelinePanel } from "@/components/timeline-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useScene } from "@/hooks/use-scene";
import { maybeStartTour } from "@/lib/tour";
import { cn } from "@/lib/utils";

function App() {
  const scene = useScene();
  const [showImport, setShowImport] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [player, setPlayer] = useState<PopkornPlayer | null>(null);
  // Desktop: editor left / player right. Mobile: player on top / editor
  // below, no timeline.
  const isMobile = useIsMobile();
  // Arriving on a community scene (`/s/$id`) is a viewing intent, so the editor
  // starts collapsed — the source is a click away, not in the way.
  const [sourceCollapsed, setSourceCollapsed] = useState(
    Boolean(useParams({ strict: false }).id),
  );

  // First-run onboarding tour — fire once the layout has painted so every
  // `[data-tour]` target exists to be highlighted.
  useEffect(() => {
    const t = window.setTimeout(maybeStartTour, 600);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col bg-background text-foreground">
        <AppHeader
          currentExample={scene.currentExample}
          onSelectExample={scene.selectExample}
          community={scene.community}
          importResult={scene.importResult}
          onDismissImport={scene.dismissImport}
          onImport={() => setShowImport(true)}
          onShare={() => setShowShare(true)}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
        />

        {/* DOM order is fixed [editor | divider | player] so neither panel
            remounts on a breakpoint change; mobile stacks the player on top
            via `order`. A collapsed editor shrinks to its rail. */}
        <div
          className={
            isMobile
              ? "flex flex-1 flex-col overflow-hidden"
              : "flex flex-1 overflow-hidden"
          }
        >
          <div
            data-tour="source"
            className={cn(
              "flex min-h-0 min-w-0 overflow-hidden",
              sourceCollapsed ? "flex-none" : "flex-1",
            )}
          >
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
          </div>

          {!sourceCollapsed && (
            <div
              className={
                isMobile
                  ? "-order-1 h-px shrink-0 bg-border"
                  : "w-px shrink-0 bg-border"
              }
            />
          )}

          <div
            data-tour="player"
            className={cn(
              "flex min-h-0 min-w-0 flex-1 overflow-hidden",
              isMobile && "-order-2",
            )}
          >
            <PlayerPanel
              source={scene.source}
              playerSource={scene.playerSource}
              community={scene.community}
              error={scene.error}
              onError={scene.setError}
              player={player}
              onPlayerReady={setPlayer}
            />
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
            onEditSource={scene.replaceSource}
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
              void scene.importText(text).then((ok) => {
                if (ok) setShowImport(false);
              });
            }}
            onClose={() => setShowImport(false)}
          />
        )}

        {showShare && (
          <ShareModal
            source={scene.source}
            onClose={() => setShowShare(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
