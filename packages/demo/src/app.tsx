import { parse, serialize } from "@popcorn/parser";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  buildImportResult,
  bytes,
  gzipSizes,
  type ImportResult,
  type SizeDelta,
} from "@/lib/import-size";
import { convertLottie } from "../../../tools/lottie2popcorn";
import { convertSvg } from "../../../tools/svg2popcorn";
import AgentChat from "./components/agent-chat";
import { AppHeader } from "./components/app-header";
import { ImportModal } from "./components/import-modal";
import { PlayerPanel } from "./components/player-panel";
import { SourcePanel } from "./components/source-panel";
import { examples } from "./examples";

function App() {
  const [currentExample, setCurrentExample] = useState<string | null>("motion");
  const [source, setSource] = useState(examples[1].source);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [minified, setMinified] = useState(false);
  const [sizeDelta, setSizeDelta] = useState<SizeDelta | null>(null);

  useEffect(() => {
    const ex = examples.find((e) => e.key === currentExample);
    if (ex) {
      setSource(ex.source);
      setMinified(false);
      setSizeDelta(null);
    }
  }, [currentExample]);

  function toggleMinify() {
    try {
      const next = serialize(parse(source), { minify: !minified });
      setSizeDelta({ before: bytes(source), after: bytes(next) });
      setSource(next);
      setMinified(!minified);
      setError(null);
    } catch (e: any) {
      setError(`Could not format: ${e.message}`);
    }
  }

  function importLottie(text: string, label: string): boolean {
    setError(null);
    let lottie: any;
    try {
      lottie = JSON.parse(text);
    } catch (e: any) {
      setError(`Invalid JSON: ${e.message}`);
      return false;
    }
    try {
      const { css, warnings, blocked } = convertLottie(lottie);
      applyImport("Lottie", label, text, css, warnings, blocked);
      return true;
    } catch (e: any) {
      setError(`Lottie conversion failed: ${e.message}`);
      return false;
    }
  }

  function importSvg(text: string, label: string): boolean {
    setError(null);
    try {
      const { css, warnings, blocked } = convertSvg(text);
      applyImport("SVG", label, text, css, warnings, blocked);
      return true;
    } catch (e: any) {
      setError(`SVG conversion failed: ${e.message}`);
      return false;
    }
  }

  function applyImport(
    format: string,
    label: string,
    text: string,
    css: string,
    warnings: string[],
    blocked: string[],
  ) {
    setCurrentExample(null);
    setSource(css);
    setMinified(false);
    setSizeDelta(null);
    const result = buildImportResult(format, label, text, css);
    result.warnings = warnings;
    result.blocked = blocked;
    setImportResult(result);
    void gzipSizes(format, text, css).then((gz) =>
      setImportResult((prev) => (prev === result ? { ...prev, gz } : prev)),
    );
  }

  function handleImportFile(file: File) {
    const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const ok = isSvg
        ? importSvg(text, `"${file.name}"`)
        : importLottie(text, `"${file.name}"`);
      if (ok) setShowImport(false);
    };
    reader.onerror = () => setError(`Could not read file: ${file.name}`);
    reader.readAsText(file);
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col bg-background text-foreground">
        <AppHeader
          currentExample={currentExample}
          onSelectExample={(key) => {
            setCurrentExample(key);
            setImportResult(null);
            setError(null);
          }}
          importResult={importResult}
          onDismissImport={() => setImportResult(null)}
          onImport={() => setShowImport(true)}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
        />

        <div className="flex flex-1 overflow-hidden">
          <SourcePanel
            source={source}
            onSourceChange={(v) => {
              setSource(v);
              setSizeDelta(null);
            }}
            sizeDelta={sizeDelta}
            minified={minified}
            onToggleMinify={toggleMinify}
          />

          <PlayerPanel source={source} error={error} onError={setError} />

          {/* Agent chat sidebar — toggled from the header */}
          <AgentChat
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            source={source}
            onApplySource={(css) => {
              setCurrentExample(null);
              setSource(css);
              setMinified(false);
              setSizeDelta(null);
              setImportResult(null);
              setError(null);
            }}
          />
        </div>

        {showImport && (
          <ImportModal
            onFile={handleImportFile}
            onText={(text) => {
              const ok =
                /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(svg|!DOCTYPE svg)/i.test(
                  text,
                )
                  ? importSvg(text, "pasted SVG")
                  : importLottie(text, "pasted JSON");
              if (ok) setShowImport(false);
            }}
            onClose={() => setShowImport(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
