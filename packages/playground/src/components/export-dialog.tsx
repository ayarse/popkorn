import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EXPORT_SCALES } from "@/lib/export-scale";
import { cn } from "@/lib/utils";

export const MAX_EXPORT_SECONDS = 60;

export interface ExportChoice {
  scale?: number;
  durationMs?: number;
}

const LABEL =
  "block text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

/** Export settings: output scale (raster formats) and a length when the scene has no fixed end. */
export function ExportDialog({
  format,
  stage,
  scale,
  lengthMs,
  onSubmit,
  onCancel,
}: {
  format: string;
  stage: { width: number; height: number };
  /** Omitted for vector formats. `max` caps the offered scales. */
  scale?: { default: number; max: number };
  /** Suggested length; omitted when the scene has a fixed end. */
  lengthMs?: number;
  onSubmit: (choice: ExportChoice) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [pickedScale, setPickedScale] = useState(scale?.default ?? 1);
  const [seconds, setSeconds] = useState(
    lengthMs === undefined
      ? ""
      : String(Math.min(MAX_EXPORT_SECONDS, Math.round(lengthMs / 100) / 10)),
  );
  const s = Number(seconds);
  const validLength =
    lengthMs === undefined || (s >= 0.1 && s <= MAX_EXPORT_SECONDS);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Export {format}</DialogTitle>
          {lengthMs !== undefined && (
            <DialogDescription>
              This scene has no fixed end. Choose how much of it to export.
            </DialogDescription>
          )}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validLength) return;
            onSubmit({
              scale: scale ? pickedScale : undefined,
              durationMs: lengthMs === undefined ? undefined : s * 1000,
            });
          }}
        >
          {scale && (
            <fieldset className="space-y-1.5">
              <legend className={LABEL}>Size</legend>
              <div className="grid grid-cols-3 gap-1.5 pt-1.5">
                {EXPORT_SCALES.filter((n) => n <= scale.max).map((n) => (
                  <label
                    key={n}
                    className={cn(
                      "flex cursor-pointer flex-col items-center rounded-lg border px-2 py-1.5 text-[12px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                      pickedScale === n
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary/60",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-scale`}
                      value={n}
                      checked={pickedScale === n}
                      onChange={() => setPickedScale(n)}
                      className="sr-only"
                    />
                    <span className="font-medium">{n}×</span>
                    <span className="font-mono text-[11px]">
                      {Math.round(stage.width * n)}×
                      {Math.round(stage.height * n)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {lengthMs !== undefined && (
            <div className="space-y-1.5">
              <label htmlFor={`${id}-length`} className={LABEL}>
                Length (seconds)
              </label>
              <input
                id={`${id}-length`}
                type="number"
                min={0.1}
                max={MAX_EXPORT_SECONDS}
                step={0.1}
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
                autoFocus
                aria-invalid={!validLength}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] font-mono text-foreground outline-none transition-colors focus:border-primary/50"
              />
              {!validLength && (
                <p className="text-[12px] text-destructive">
                  Enter a length between 0.1 and {MAX_EXPORT_SECONDS} seconds.
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!validLength}>
              Export
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
