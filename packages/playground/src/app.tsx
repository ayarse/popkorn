import { useState } from "react";
import AgentChat from "@/components/agent/agent-chat";
import { AppHeader } from "@/components/app-header";
import { ImportModal } from "@/components/import-modal";
import { PlayerPanel } from "@/components/player-panel";
import { ResizeHandle, useHorizontalSplit } from "@/components/resize-handle";
import { SourcePanel } from "@/components/source-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useScene } from "@/hooks/use-scene";

function App() {
  const scene = useScene();
  const [showImport, setShowImport] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const split = useHorizontalSplit();

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
            className="flex min-w-0 overflow-hidden"
            style={{ flex: `${split.frac} 1 0` }}
          >
            <SourcePanel
              source={scene.source}
              onSourceChange={scene.editSource}
              sizeDelta={scene.sizeDelta}
              minified={scene.minified}
              onToggleMinify={scene.toggleMinify}
              onCrush={scene.crush}
            />
          </div>

          <ResizeHandle
            frac={split.frac}
            min={split.min}
            max={split.max}
            onPointerDown={split.onPointerDown}
            onKeyDown={split.onKeyDown}
          />

          {/* flex-grow of (1-frac) mirrors the source's frac, so both panels
              shrink together when the chat sidebar opens. */}
          <div
            className="flex min-w-0 overflow-hidden"
            style={{ flex: `${1 - split.frac} 1 0` }}
          >
            <PlayerPanel
              source={scene.source}
              error={scene.error}
              onError={scene.setError}
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
