import { useState, useEffect, useRef } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-css";
import "prismjs/themes/prism-tomorrow.css";
import { MotionCanvas } from "./components/MotionCanvas";
import AgentChat from "./components/AgentChat";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, BookText } from "lucide-react";
import { convertLottie } from "../../../tools/lottie2popcorn";
import { parse, serialize } from "@popcorn/parser";
import { examples } from "./examples";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  Upload,
  AlertCircle,
  AlertTriangle,
  Check,
  X,
  PanelBottom,
  PanelBottomDashed,
  Repeat,
  RepeatOff,
  Maximize,
  FoldVertical,
  UnfoldVertical,
  Film,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { exportGifInWorker, downloadGif } from "@/lib/gif";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).length;

async function gzipBytes(s: string): Promise<number> {
  const stream = new Blob([s])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

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
type SizeDelta = { before: number; after: number };

type ImportResult = {
  label: string;
  warnings: string[];
  blocked: string[];
  raw: SizePair;
  min?: SizePair;
  gz?: SizePair;
};

function buildImportResult(
  label: string,
  rawLottie: string,
  css: string,
): ImportResult {
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

// Gzipped transfer size of the minified forms (what actually ships over the
// wire). Async because CompressionStream is; the row fills in once resolved.
async function gzipSizes(
  rawLottie: string,
  css: string,
): Promise<SizePair | undefined> {
  try {
    const [lottie, popcorn] = await Promise.all([
      gzipBytes(JSON.stringify(JSON.parse(rawLottie))),
      gzipBytes(serialize(parse(css), { minify: true })),
    ]);
    return { lottie, popcorn };
  } catch {
    return undefined;
  }
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

type FitMode = "contain" | "cover" | "fill" | "none";

const FIT_MODES: { value: FitMode; label: string }[] = [
  { value: "contain", label: "Contain" },
  { value: "cover", label: "Cover" },
  { value: "fill", label: "Fill" },
  { value: "none", label: "None" },
];

function App() {
  const navigate = useNavigate();
  const [currentExample, setCurrentExample] = useState<string | null>("motion");
  const [source, setSource] = useState(examples[1].source);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [bgIndex, setBgIndex] = useState(3); // Graphite
  const [controlsVisible, setControlsVisible] = useState(true);
  const [loop, setLoop] = useState(true);
  const [fit, setFit] = useState<FitMode>("contain");
  const [chatOpen, setChatOpen] = useState(false);
  const [minified, setMinified] = useState(false);
  const [sizeDelta, setSizeDelta] = useState<SizeDelta | null>(null);
  // null = idle; 0..1 = export progress fraction.
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  async function handleExportGif() {
    if (exportProgress !== null) return;
    setExportProgress(0);
    try {
      const bytes = await exportGifInWorker(source, {
        onProgress: setExportProgress,
      });
      downloadGif(bytes);
    } catch (e: any) {
      setError(`GIF export failed: ${e.message}`);
    } finally {
      setExportProgress(null);
    }
  }

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
      setCurrentExample(null);
      setSource(css);
      setMinified(false);
      setSizeDelta(null);
      const result = buildImportResult(label, text, css);
      result.warnings = warnings;
      result.blocked = blocked;
      setImportResult(result);
      void gzipSizes(text, css).then((gz) =>
        setImportResult((prev) => (prev === result ? { ...prev, gz } : prev)),
      );
      return true;
    } catch (e: any) {
      setError(`Lottie conversion failed: ${e.message}`);
      return false;
    }
  }

  function handleLottieFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (importLottie(reader.result as string, `"${file.name}"`))
        setShowImport(false);
    };
    reader.onerror = () => setError(`Could not read file: ${file.name}`);
    reader.readAsText(file);
  }

  const activeBg = PLAYER_BACKGROUNDS[bgIndex];

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Header — compact, Linear-style */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <div className="flex items-center gap-2 pr-2">
            <div className="size-5 rounded-md bg-gradient-to-br from-primary to-accent" />
            <h1 className="text-[15px] font-semibold tracking-tight">
              Popcorn
            </h1>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate({ to: "/docs" })}
          >
            <BookText className="size-3.5" />
            Docs
          </Button>

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
              <ImportStatusChip
                result={importResult}
                onDismiss={() => setImportResult(null)}
              />
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
            <Button
              variant={chatOpen ? "default" : "secondary"}
              size="sm"
              className="gap-1.5"
              onClick={() => setChatOpen((v) => !v)}
            >
              <Sparkles className="size-3.5" />
              Copilot
            </Button>
            <a
              href="https://github.com/ayarse/popcorn"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub repository"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="size-4"
                aria-hidden="true"
              >
                <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.38.97.1-.75.4-1.26.73-1.55-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.71 5.41-5.29 5.69.42.36.79 1.08.79 2.18 0 1.58-.01 2.85-.01 3.23 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
              </svg>
            </a>
          </div>
        </header>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Source panel */}
          <div className="flex flex-1 flex-col overflow-hidden border-r border-border bg-card/30">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
              <div className="ml-auto flex items-center gap-2">
                {sizeDelta && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {humanBytes(sizeDelta.before)} →{" "}
                    {humanBytes(sizeDelta.after)} (
                    {fmtPct(pct(sizeDelta.before, sizeDelta.after))})
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={toggleMinify}>
                      {minified ? (
                        <UnfoldVertical className="size-4" />
                      ) : (
                        <FoldVertical className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {minified ? "Format source" : "Minify source"}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <Editor
                value={source}
                onValueChange={(v) => {
                  setSource(v);
                  setSizeDelta(null);
                }}
                highlight={(code) =>
                  Prism.highlight(code, Prism.languages.css, "css")
                }
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
          </div>

          {/* Animation panel */}
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

                {/* Export GIF */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleExportGif}
                      disabled={exportProgress !== null}
                    >
                      <Film className="size-3.5" />
                      {exportProgress !== null
                        ? `Exporting… ${Math.round(exportProgress * 100)}%`
                        : "Export GIF"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export animation as GIF</TooltipContent>
                </Tooltip>

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
            <div className="relative flex flex-1 items-center justify-center p-6 overflow-hidden">
              <div
                className="flex w-full max-w-[960px] rounded-xl border border-border/60 shadow-2xl shadow-black/30 overflow-hidden"
                style={{
                  height: "100%",
                  backgroundColor:
                    activeBg.value === "transparent"
                      ? undefined
                      : activeBg.value,
                }}
              >
                <MotionCanvas
                  source={source}
                  controls={controlsVisible}
                  loop={loop}
                  fit={fit}
                  style={{ height: "100%", backgroundColor: activeBg.value }}
                  onError={(err) => setError(err.message)}
                  onSceneReady={() => setError(null)}
                />
              </div>

              {/* Error toast */}
              {error && (
                <div className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground backdrop-blur-md">
                  <AlertCircle className="size-4 shrink-0 text-destructive" />
                  <span className="max-w-[420px] truncate font-mono">
                    {error}
                  </span>
                </div>
              )}
            </div>
          </div>

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
            onFile={handleLottieFile}
            onText={(text) => {
              if (importLottie(text, "pasted JSON")) setShowImport(false);
            }}
            onClose={() => setShowImport(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function ImportStatusChip({
  result,
  onDismiss,
}: {
  result: ImportResult;
  onDismiss: () => void;
}) {
  const { label, warnings, blocked, raw, min, gz } = result;
  const hasIssues = warnings.length > 0 || blocked.length > 0;
  const deltaPct = pct(raw.lottie, raw.popcorn);
  const minDeltaPct = min ? pct(min.lottie, min.popcorn) : 0;
  const gzDeltaPct = gz ? pct(gz.lottie, gz.popcorn) : 0;
  // Collapsed chip teases the gzipped delta (real wire size); until the async
  // gzip resolves, fall back to the raw delta.
  const chipDeltaPct = gz ? gzDeltaPct : deltaPct;

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
              {fmtPct(chipDeltaPct)}
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
              <span className="flex-1 whitespace-nowrap text-center">
                Lottie
              </span>
              <span className="flex-1 whitespace-nowrap text-center">
                Popcorn
              </span>
              <span className="w-12 whitespace-nowrap text-center">Δ</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-mono">
                <span className="w-2/5 text-muted-foreground">Raw</span>
                <span className="flex-1 whitespace-nowrap text-center">
                  {humanBytes(raw.lottie)}
                </span>
                <span className="flex-1 whitespace-nowrap text-center">
                  {humanBytes(raw.popcorn)}
                </span>
                <span
                  className={`w-12 whitespace-nowrap text-center ${deltaPct <= 0 ? "text-emerald-500" : "text-amber-500"}`}
                >
                  {fmtPct(deltaPct)}
                </span>
              </div>
              {min && (
                <div className="flex items-center gap-2 font-mono">
                  <span className="w-2/5 text-muted-foreground">Minified</span>
                  <span className="flex-1 whitespace-nowrap text-center">
                    {humanBytes(min.lottie)}
                  </span>
                  <span className="flex-1 whitespace-nowrap text-center">
                    {humanBytes(min.popcorn)}
                  </span>
                  <span
                    className={`w-12 whitespace-nowrap text-center ${minDeltaPct <= 0 ? "text-emerald-500" : "text-amber-500"}`}
                  >
                    {fmtPct(minDeltaPct)}
                  </span>
                </div>
              )}
              {gz && (
                <div className="flex items-center gap-2 font-mono">
                  <span className="w-2/5 text-muted-foreground">Gzipped</span>
                  <span className="flex-1 whitespace-nowrap text-center">
                    {humanBytes(gz.lottie)}
                  </span>
                  <span className="flex-1 whitespace-nowrap text-center">
                    {humanBytes(gz.popcorn)}
                  </span>
                  <span
                    className={`w-12 whitespace-nowrap text-center ${gzDeltaPct <= 0 ? "text-emerald-500" : "text-amber-500"}`}
                  >
                    {fmtPct(gzDeltaPct)}
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

function ImportModal({
  onFile,
  onText,
  onClose,
}: {
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
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Lottie</DialogTitle>
          <DialogDescription>
            Drop a bodymovin <code className="font-mono">.json</code> file or
            paste its contents. It will be converted to Popcorn DSL.
          </DialogDescription>
        </DialogHeader>

        {/* Dropzone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
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
              : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
          )}
        >
          Drop a <code className="font-mono">.json</code> file here, or click to
          browse
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
