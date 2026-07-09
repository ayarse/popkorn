import Prism from "prismjs";
import Editor from "react-simple-code-editor";
import "prismjs/components/prism-css";
import "prismjs/themes/prism-tomorrow.css";
import { FoldVertical, UnfoldVertical } from "lucide-react";
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
}: {
  source: string;
  onSourceChange: (value: string) => void;
  sizeDelta: SizeDelta | null;
  minified: boolean;
  onToggleMinify: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden border-r border-border bg-card/30">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
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
        </div>
      </div>
      <div className="flex-1 overflow-auto">
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
      </div>
    </div>
  );
}
