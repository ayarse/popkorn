import { AlertCircle, AlertTriangle, Check, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { fmtPct, humanBytes, type ImportResult, pct } from "@/lib/import-size";

export function ImportStatusChip({
  result,
  onDismiss,
}: {
  result: ImportResult;
  onDismiss: () => void;
}) {
  const { format, label, warnings, blocked, raw, min, gz, crushGz } = result;
  const hasIssues = warnings.length > 0 || blocked.length > 0;
  const deltaPct = pct(raw.lottie, raw.popkorn);
  const minDeltaPct = min ? pct(min.lottie, min.popkorn) : 0;
  const gzDeltaPct = gz ? pct(gz.lottie, gz.popkorn) : 0;
  const crushDeltaPct = crushGz ? pct(crushGz.lottie, crushGz.popkorn) : 0;
  // Collapsed chip teases the gzipped delta (real wire size); until the async
  // gzip resolves, fall back to the raw delta.
  const chipDeltaPct = gz ? gzDeltaPct : deltaPct;

  return (
    <div className="flex items-center overflow-hidden rounded-md border border-border">
      {/* Dismiss */}
      <button
        type="button"
        onClick={onDismiss}
        className="flex h-8 items-center px-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>

      {/* Status — opens popover */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors hover:bg-muted/40"
          >
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
                {format}
              </span>
              <span className="flex-1 whitespace-nowrap text-center">
                Popkorn
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
                  {humanBytes(raw.popkorn)}
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
                    {humanBytes(min.popkorn)}
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
                    {humanBytes(gz.popkorn)}
                  </span>
                  <span
                    className={`w-12 whitespace-nowrap text-center ${gzDeltaPct <= 0 ? "text-emerald-500" : "text-amber-500"}`}
                  >
                    {fmtPct(gzDeltaPct)}
                  </span>
                </div>
              )}
              {crushGz && (
                <div className="flex items-center gap-2 font-mono">
                  <span
                    className="w-2/5 text-muted-foreground"
                    title="Gzipped, identifiers renamed — smallest wire size (not human-readable)"
                  >
                    Crushed
                  </span>
                  <span className="flex-1 whitespace-nowrap text-center">
                    {humanBytes(crushGz.lottie)}
                  </span>
                  <span className="flex-1 whitespace-nowrap text-center">
                    {humanBytes(crushGz.popkorn)}
                  </span>
                  <span
                    className={`w-12 whitespace-nowrap text-center ${crushDeltaPct <= 0 ? "text-emerald-500" : "text-amber-500"}`}
                  >
                    {fmtPct(crushDeltaPct)}
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
