import type { PopkornPlayer } from "@popkorn/player";
import { useEffect, useState } from "react";
import AgentChat from "@/components/agent/agent-chat";
import { AppHeader } from "@/components/app-header";
import { ImportModal } from "@/components/import-modal";
import { PlayerPanel } from "@/components/player-panel";
import { ResizeHandle, useHorizontalSplit } from "@/components/resize-handle";
import { SourcePanel } from "@/components/source-panel";
import { TimelinePanel } from "@/components/timeline-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useScene } from "@/hooks/use-scene";
import { maybeStartTour } from "@/lib/tour";

function App() {
  const scene = useScene();
  const [showImport, setShowImport] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [player, setPlayer] = useState<PopkornPlayer | null>(null);
  const split = useHorizontalSplit();
  const [sourceCollapsed, setSourceCollapsed] = useState(false);

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
          importResult={scene.importResult}
          onDismissImport={scene.dismissImport}
          onImport={() => setShowImport(true)}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
        />

        <div className="flex flex-1 overflow-hidden">
          <div
            data-tour="source"
            className="flex min-w-0 overflow-hidden"
            style={
              sourceCollapsed
                ? { flex: "0 0 auto" }
                : { flex: `${split.frac} 1 0` }
            }
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
            <ResizeHandle
              frac={split.frac}
              min={split.min}
              max={split.max}
              onPointerDown={split.onPointerDown}
              onKeyDown={split.onKeyDown}
            />
          )}

          {/* flex-grow of (1-frac) mirrors the source's frac, so both panels
              shrink together when the chat sidebar opens; collapsed source
              hands its width fully to the player. */}
          <div
            data-tour="player"
            className="flex min-w-0 overflow-hidden"
            style={{ flex: `${sourceCollapsed ? 1 : 1 - split.frac} 1 0` }}
          >
            <PlayerPanel
              source={scene.source}
              error={scene.error}
              onError={scene.setError}
              onPlayerReady={setPlayer}
            />
          </div>

          {/* Agent chat sidebar — toggled from the header */}
          <AgentChat
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            source={scene.source}
            onApplySource={scene.applyGenerated}
          />
        </div>

        <TimelinePanel
          player={player}
          source={scene.source}
          onEditSource={scene.editSource}
        />

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
