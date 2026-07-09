import { useState } from "react";
import AgentChat from "@/components/agent/agent-chat";
import { AppHeader } from "@/components/app-header";
import { ImportModal } from "@/components/import-modal";
import { PlayerPanel } from "@/components/player-panel";
import { SourcePanel } from "@/components/source-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useScene } from "@/hooks/use-scene";

function App() {
  const scene = useScene();
  const [showImport, setShowImport] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

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
          <SourcePanel
            source={scene.source}
            onSourceChange={scene.editSource}
            sizeDelta={scene.sizeDelta}
            minified={scene.minified}
            onToggleMinify={scene.toggleMinify}
          />

          <PlayerPanel
            source={scene.source}
            error={scene.error}
            onError={scene.setError}
          />

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
