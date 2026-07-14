import Prism from "prismjs";
import { useRef } from "react";
import Editor from "react-simple-code-editor";
import "prismjs/components/prism-css";
import "prismjs/themes/prism-tomorrow.css";
import type { Diagnostic } from "@popkorn/parser";
import {
  FoldVertical,
  PanelBottomClose,
  PanelBottomOpen,
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
import { useIsMobile } from "@/hooks/use-is-mobile";
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
  // Editor sits left of the canvas on desktop (collapse to a left rail) and
  // below it on mobile (collapse to a bottom bar) — pick the matching affordance.
  const isMobile = useIsMobile();
  const CollapseIcon = isMobile ? PanelBottomClose : PanelLeftClose;
  const ExpandIcon = isMobile ? PanelBottomOpen : PanelLeftOpen;
  const tipSide = isMobile ? "top" : "right";

  // Cache the highlighted HTML by source. Editor re-renders (e.g. the collapse
  // toggle flipping props) re-call `highlight`; returning the identical string
  // lets React skip the dangerouslySetInnerHTML write — on a 340KB imported
  // Lottie an uncached re-highlight + relayout blocks the main thread ~700ms.
  const hlCache = useRef<{ code: string; html: string } | null>(null);
  const highlight = (code: string): string => {
    if (hlCache.current?.code !== code) {
      hlCache.current = {
        code,
        html: Prism.highlight(code, Prism.languages.css, "css"),
      };
    }
    return hlCache.current.html;
  };

  // The expanded panel below stays mounted (just display:none) while collapsed:
  // remounting the editor re-highlights + re-lays-out the whole document in one
  // main-thread task (~650ms on a 340KB imported Lottie), which janks expand.
  const rail = collapsed && (
    <div className="flex shrink-0 items-center border-border bg-card/30 max-sm:h-9 max-sm:w-full max-sm:border-t max-sm:px-2 sm:w-9 sm:flex-col sm:border-r sm:pt-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label="Expand source editor"
          >
            <ExpandIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tipSide}>Expand editor</TooltipContent>
      </Tooltip>
      <span className="ml-2 text-[11px] text-muted-foreground sm:hidden">
        Source
      </span>
    </div>
  );

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
    <>
      {rail}
      <div
        className="flex flex-1 flex-col overflow-hidden bg-card/30 sm:border-r sm:border-border"
        style={collapsed ? { display: "none" } : undefined}
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapse}
                aria-label="Collapse source editor"
              >
                <CollapseIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={tipSide}>Collapse editor</TooltipContent>
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
              highlight={highlight}
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
    </>
  );
}
