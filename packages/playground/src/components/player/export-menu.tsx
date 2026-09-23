import { ChevronDown, FileJson, Film, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ExportFormat } from "./use-export";

/** Export dropdown (GIF / MP4 / Lottie); the trigger shows in-flight progress. */
export function ExportMenu({
  exporting,
  onExport,
  onCancel,
}: {
  exporting: { format: ExportFormat; progress: number } | null;
  onExport: (format: ExportFormat) => void;
  onCancel: () => void;
}) {
  // WebCodecs is required for MP4; hide that item where it's unavailable.
  const canExportMp4 = typeof VideoEncoder !== "undefined";
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={exporting !== null}
              >
                <Film className="size-3.5" />
                {exporting !== null
                  ? `Exporting ${exporting.format}… ${Math.round(exporting.progress * 100)}%`
                  : "Export"}
                {exporting === null && (
                  <ChevronDown className="size-3 opacity-60" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Export animation</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onSelect={() => onExport("GIF")}>
            <Film className="size-3.5" />
            GIF
          </DropdownMenuItem>
          {canExportMp4 && (
            <DropdownMenuItem onSelect={() => onExport("MP4")}>
              <Video className="size-3.5" />
              MP4
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onExport("Lottie")}>
            <FileJson className="size-3.5" />
            Lottie
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {exporting !== null && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label="Cancel export"
          title="Cancel export"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </>
  );
}
