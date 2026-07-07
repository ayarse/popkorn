import { useState, useEffect, useRef } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-css";
import "prismjs/themes/prism-tomorrow.css";
import { MotionCanvas } from "./components/MotionCanvas";
import { convertLottie } from "../../../tools/lottie2popcorn";
import { parse, serialize } from "@popcorn/parser";
import { examples } from "./examples";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  ChevronDown,
  Upload,
  AlertCircle,
  AlertTriangle,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).length;

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function pct(lottie: number, popcorn: number): number {
  if (lottie === 0) return 0;
  return ((popcorn - lottie) / lottie) * 100;
}

function fmtPct(d: number): string {
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
}

type SizePair = { lottie: number; popcorn: number };

type ImportResult = {
  label: string;
  warnings: string[];
  blocked: string[];
  raw: SizePair;
  min?: SizePair;
};

function buildImportResult(label: string, rawLottie: string, css: string): ImportResult {
  const raw: SizePair = { lottie: bytes(rawLottie), popcorn: bytes(css) };
  let min: SizePair | undefined;
  try {
    min = {
      lottie: bytes(JSON.stringify(JSON.parse(rawLottie))),
      popcorn: bytes(serialize(parse(css), { minify: true })),
    };
  } catch {
    // Degrade to unminified sizes only rather than breaking the import.
  }
  return { label, warnings: [], blocked: [], raw, min };
}

const PLAYER_BACKGROUNDS = [
  { name: "Transparent", value: "transparent", swatch: "transparent" },
  { name: "White", value: "#ffffff", swatch: "#ffffff" },
  { name: "Paper", value: "#f4f4f5", swatch: "#f4f4f5" },
  { name: "Graphite", value: "#1f1f2e", swatch: "#1f1f2e" },
  { name: "Ink", value: "#0a0a12", swatch: "#0a0a12" },
  { name: "Crimson", value: "#5e1020", swatch: "#5e1020" },
  { name: "Forest", value: "#11241a", swatch: "#11241a" },
  { name: "Cobalt", value: "#1a1f4d", swatch: "#1a1f4d" },
];

function App() {
  const [currentExample, setCurrentExample] = useState<string | null>("motion");
  const [source, setSource] = useState(examples[1].source);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [bgIndex, setBgIndex] = useState(4); // Ink

  useEffect(() => {
    const ex = examples.find((e) => e.key === currentExample);
    if (ex) setSource(ex.source);
  }, [currentExample]);

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
      setCurrentExample(null);
      setSource(css);
      const result = buildImportResult(label, text, css);
      result.warnings = warnings;
      result.blocked = blocked;
      setImportResult(result);
      return true;
    } catch (e: any) {
      setError(`Lottie conversion failed: ${e.message}`);
      return false;
    }
  }

  function handleLottieFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (importLottie(reader.result as string, `"${file.name}"`)) setShowImport(false);
    };
    reader.onerror = () => setError(`Could not read file: ${file.name}`);
    reader.readAsText(file);
  }

  const activeBg = PLAYER_BACKGROUNDS[bgIndex];

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header — compact, Linear-style */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex items-center gap-2 pr-2">
          <div className="size-5 rounded-md bg-gradient-to-br from-primary to-accent" />
          <h1 className="text-[15px] font-semibold tracking-tight">Popcorn</h1>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              Examples
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Example scenes</span>
              <span className="text-[10px] font-normal tracking-widest text-muted-foreground">
                {examples.length}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {examples.map((ex) => (
              <DropdownMenuCheckboxItem
                key={ex.key}
                checked={currentExample === ex.key}
                onCheckedChange={() => {
                  setCurrentExample(ex.key);
                  setImportResult(null);
                  setError(null);
                }}
              >
                {ex.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-2">
          {importResult && (
            <ImportStatusChip result={importResult} onDismiss={() => setImportResult(null)} />
          )}
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowImport(true)}
          >
            <Upload className="size-3.5" />
            Import Lottie
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Source panel */}
        <div className="flex-1 overflow-auto border-r border-border bg-card/30">
          <Editor
            value={source}
            onValueChange={setSource}
            highlight={(code) => Prism.highlight(code, Prism.languages.css, "css")}
            padding={16}
            style={{
              minHeight: "100%",
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              lineHeight: "1.6",
              backgroundColor: "transparent",
            }}
          />
        </div>

        {/* Animation panel */}
        <div className="relative flex flex-1 items-center justify-center bg-background p-6 overflow-hidden">
          <div
            className="flex w-full max-w-[960px] rounded-xl border border-border/60 shadow-2xl shadow-black/30 overflow-hidden"
            style={{ height: "100%", backgroundColor: activeBg.value === "transparent" ? undefined : activeBg.value }}
          >
            <MotionCanvas
              source={source}
              style={{ height: "100%", backgroundColor: activeBg.value }}
              onError={(err) => setError(err.message)}
              onSceneReady={() => setError(null)}
            />
          </div>

          {/* Error toast */}
          {error && (
            <div className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground backdrop-blur-md">
              <AlertCircle className="size-4 shrink-0 text-destructive" />
              <span className="max-w-[420px] truncate font-mono">{error}</span>
            </div>
          )}

          {/* Background color picker — circle swatches */}
          <div className="absolute right-5 top-5 z-20 flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 p-1.5 backdrop-blur-md">
            {PLAYER_BACKGROUNDS.map((bg, i) => (
              <button
                key={bg.name}
                title={bg.name}
                onClick={() => setBgIndex(i)}
                className={cn(
                  "size-5 rounded-full border transition-all hover:scale-110",
                  bgIndex === i
                    ? "border-primary ring-2 ring-ring ring-offset-2 ring-offset-background"
                    : "border-border/40"
                )}
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
            ))}
          </div>
        </div>
      </div>

      {showImport && (
        <ImportModal
          onFile={handleLottieFile}
          onText={(text) => {
            if (importLottie(text, "pasted JSON")) setShowImport(false);
          }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

function ImportStatusChip({
  result,
  onDismiss,
}: {
  result: ImportResult;
  onDismiss: () => void;
}) {
  const { label, warnings, blocked, raw, min } = result;
  const hasIssues = warnings.length > 0 || blocked.length > 0;
  const deltaPct = pct(raw.lottie, raw.popcorn);
  const minDeltaPct = min ? pct(min.lottie, min.popcorn) : 0;

  return (
    <div className="flex items-center overflow-hidden rounded-md border border-border">
      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="flex h-8 items-center px-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>

      {/* Status — opens popover */}
      <Popover>
        <PopoverTrigger asChild>
          <button className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors hover:bg-muted/40">
            {hasIssues ? (
              <AlertTriangle className="size-3.5 text-amber-500" />
            ) : (
              <Check className="size-3.5 text-emerald-500" />
            )}
            <span className="max-w-[160px] truncate">{label}</span>
            {warnings.length > 0 && (
              <span className="rounded-sm bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-500">
                {warnings.length}w
              </span>
            )}
            {blocked.length > 0 && (
              <span className="rounded-sm bg-destructive/15 px-1 text-[10px] font-semibold text-destructive">
                {blocked.length}b
              </span>
            )}
            <span className="ml-0.5 font-mono text-[11px] text-muted-foreground">
              {fmtPct(deltaPct)}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <div className="border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {hasIssues ? (
                <AlertTriangle className="size-3.5 text-amber-500" />
              ) : (
                <Check className="size-3.5 text-emerald-500" />
              )}
              Imported {label}
            </div>
          </div>

          {/* Size delta */}
          <div className="px-3 py-2.5 text-xs">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
              <span className="w-2/5" />
              <span className="flex-1 whitespace-nowrap text-center">Lottie</span>
              <span className="flex-1 whitespace-nowrap text-center">Popcorn</span>
              <span className="w-12 whitespace-nowrap text-center">Δ</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-mono">
                <span className="w-2/5 text-muted-foreground">Raw</span>
                <span className="flex-1 whitespace-nowrap text-center">{humanBytes(raw.lottie)}</span>
                <span className="flex-1 whitespace-nowrap text-center">{humanBytes(raw.popcorn)}</span>
                <span className={`w-12 whitespace-nowrap text-center ${deltaPct <= 0 ? "text-emerald-500" : "text-amber-500"}`}>
                  {fmtPct(deltaPct)}
                </span>
              </div>
              {min && (
                <div className="flex items-center gap-2 font-mono">
                  <span className="w-2/5 text-muted-foreground">Minified</span>
                  <span className="flex-1 whitespace-nowrap text-center">{humanBytes(min.lottie)}</span>
                  <span className="flex-1 whitespace-nowrap text-center">{humanBytes(min.popcorn)}</span>
                  <span className={`w-12 whitespace-nowrap text-center ${minDeltaPct <= 0 ? "text-emerald-500" : "text-amber-500"}`}>
                    {fmtPct(minDeltaPct)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="border-t border-border px-3 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                <AlertTriangle className="size-3.5" />
                {warnings.length} warning{warnings.length === 1 ? "" : "s"}
              </div>
              <ul className="max-h-40 space-y-1.5 overflow-auto pr-1 text-[11px] leading-relaxed text-muted-foreground">
                {warnings.map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-amber-500/70" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Blocked */}
          {blocked.length > 0 && (
            <div className="border-t border-border px-3 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertCircle className="size-3.5" />
                Blocked (not converted)
              </div>
              <ul className="max-h-40 space-y-1.5 overflow-auto pr-1 text-[11px] leading-relaxed text-muted-foreground">
                {blocked.map((b, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="mt-1 size-1 shrink-0 rounded-full bg-destructive/70" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ImportModal({ onFile, onText, onClose }: {
  onFile: (file: File) => void;
  onText: (text: string) => void;
  onClose: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Lottie</DialogTitle>
          <DialogDescription>
            Drop a bodymovin <code className="font-mono">.json</code> file or paste its contents. It will be converted to Popcorn DSL.
          </DialogDescription>
        </DialogHeader>

        {/* Dropzone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          className={cn(
            "cursor-pointer rounded-lg border-2 border-dashed p-8 text-center text-sm transition-colors",
            dragOver
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
          )}
        >
          Drop a <code className="font-mono">.json</code> file here, or click to browse
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or paste JSON
          <div className="h-px flex-1 bg-border" />
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "v": "5.7.0", "layers": [ ... ] }'
          spellCheck={false}
          className="h-36 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex justify-end">
          <Button onClick={() => onText(text)}>Import JSON</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default App;