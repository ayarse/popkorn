import Prism from "prismjs";
import { useRef } from "react";
import Editor from "react-simple-code-editor";
import "prismjs/components/prism-css";
import "prismjs/themes/prism-tomorrow.css";
import type { Diagnostic } from "@popkorn/parser";
import {
  FoldVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Shrink,
  UnfoldVertical,
} from "lucide-react";
import {
  DiagnosticsOverlay,
  ProblemsStrip,
  useDiagnostics,
} from "@/components/source-diagnostics";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtPct, humanBytes, pct, type SizeDelta } from "@/lib/import-size";

export function SourcePanel({
  source,
  onSourceChange,
  sizeDelta,
  minified,
  onToggleMinify,
  onCrush,
  collapsed,
  onToggleCollapse,
}: {
  source: string;
  onSourceChange: (value: string) => void;
  sizeDelta: SizeDelta | null;
  minified: boolean;
  onToggleMinify: () => void;
  onCrush: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const diags = useDiagnostics(source);
  const wrapRef = useRef<HTMLDivElement>(null);

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-card/30 pt-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleCollapse}
              aria-label="Expand source editor"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand editor</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Crush is destructive (renames every identifier, unrecoverable), so gate it
  // behind an explicit confirmation that spells out the trade-off.
  const confirmCrush = () => {
    if (
      window.confirm(
        "Crush will minify AND irreversibly rename every id, class, " +
          "@keyframes, symbol and custom property to a short meaningless " +
          "name (e.g. #a, --b). The scene renders identically and ships " +
          "smaller, but the source is no longer human-readable and the " +
          "original names cannot be recovered.\n\nCrush this source?",
      )
    )
      onCrush();
  };

  const jumpTo = (d: Diagnostic) => {
    const ta = wrapRef.current?.querySelector("textarea");
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(d.start, d.end);
    // scroll the selection into view via the scroll container
    const line = source.slice(0, d.start).split("\n").length - 1;
    const scroller = wrapRef.current?.parentElement;
    if (scroller)
      scroller.scrollTop = line * 13 * 1.6 - scroller.clientHeight / 2;
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-r border-border bg-card/30">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleCollapse}
              aria-label="Collapse source editor"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Collapse editor</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-2">
          {sizeDelta && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {humanBytes(sizeDelta.before)} → {humanBytes(sizeDelta.after)} (
              {fmtPct(pct(sizeDelta.before, sizeDelta.after))})
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onToggleMinify}>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={confirmCrush}>
                <Shrink className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Crush: minify + irreversibly rename identifiers (smaller, not
              human-readable)
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div ref={wrapRef} className="relative" style={{ minHeight: "100%" }}>
          <Editor
            value={source}
            onValueChange={onSourceChange}
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
          {diags.length > 0 && (
            <DiagnosticsOverlay
              source={source}
              diags={diags}
              containerRef={wrapRef}
            />
          )}
        </div>
      </div>
      <ProblemsStrip source={source} diags={diags} onJump={jumpTo} />
    </div>
  );
}
