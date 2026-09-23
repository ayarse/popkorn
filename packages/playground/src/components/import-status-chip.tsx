import { AlertCircle, AlertTriangle, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fmtPct,
  humanBytes,
  type ImportResult,
  pct,
  type SizePair,
} from "@/lib/import-size";

export function ImportStatusChip({
  result,
  onDismiss,
}: {
  result: ImportResult;
  onDismiss: () => void;
}) {
  const { format, label, warnings, blocked, raw, min, gz, crushGz } = result;
  const hasIssues = warnings.length > 0 || blocked.length > 0;
  const rows = [
    { name: "Raw", size: raw },
    { name: "Minified", size: min },
    { name: "Gzipped", size: gz },
    {
      name: "Crushed",
      size: crushGz,
      title:
        "Gzipped, identifiers renamed — smallest wire size (not human-readable)",
    },
  ];
  const delta = (p: SizePair) => pct(p.source, p.popkorn);
  // Collapsed chip teases the gzipped delta (real wire size); until the async
  // gzip resolves, fall back to the raw delta.
  const chipDeltaPct = delta(gz ?? raw);

  return (
    <div className="flex items-center overflow-hidden rounded-md border border-border">
      {/* Dismiss */}
      <button
        type="button"
        onClick={onDismiss}
        className="flex h-8 items-center px-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label="Dismiss import summary"
      >
        <X className="size-3.5" />
      </button>

      {/* Status — opens popover */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {hasIssues ? (
              <AlertTriangle className="size-3.5 text-amber-500" />
            ) : (
              <Check className="size-3.5 text-emerald-500" />
            )}
            <span className="max-w-[160px] truncate">{label}</span>
            {warnings.length > 0 && (
              <Badge variant="warning" shape="count">
                {warnings.length}w
              </Badge>
            )}
            {blocked.length > 0 && (
              <Badge variant="destructive" shape="count">
                {blocked.length}b
              </Badge>
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
                {format}
              </span>
              <span className="flex-1 whitespace-nowrap text-center">
                Popkorn
              </span>
              <span className="w-12 whitespace-nowrap text-center">Δ</span>
            </div>
            <div className="space-y-1.5">
              {rows.map(
                ({ name, size, title }) =>
                  size && (
                    <div
                      key={name}
                      className="flex items-center gap-2 font-mono"
                    >
                      {title ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="w-2/5 cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">
                              {name}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-56">
                            {title}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="w-2/5 text-muted-foreground">
                          {name}
                        </span>
                      )}
                      <span className="flex-1 whitespace-nowrap text-center">
                        {humanBytes(size.source)}
                      </span>
                      <span className="flex-1 whitespace-nowrap text-center">
                        {humanBytes(size.popkorn)}
                      </span>
                      <span
                        className={`w-12 whitespace-nowrap text-center ${delta(size) <= 0 ? "text-emerald-500" : "text-amber-500"}`}
                      >
                        {fmtPct(delta(size))}
                      </span>
                    </div>
                  ),
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
                  // biome-ignore lint/suspicious/noArrayIndexKey: warning strings are not guaranteed unique; index is a stable position key
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
                  // biome-ignore lint/suspicious/noArrayIndexKey: blocked strings are not guaranteed unique; index is a stable position key
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
