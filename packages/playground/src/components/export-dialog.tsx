import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label, labelClass } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EXPORT_SCALES } from "@/lib/export-scale";

export const MAX_EXPORT_SECONDS = 60;

export interface ExportChoice {
  scale?: number;
  durationMs?: number;
}

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
            <div className="space-y-1.5">
              <span id={`${id}-size`} className={labelClass}>
                Size
              </span>
              <ToggleGroup
                type="single"
                aria-labelledby={`${id}-size`}
                value={String(pickedScale)}
                onValueChange={(v) => v && setPickedScale(Number(v))}
                className="grid grid-cols-3"
              >
                {EXPORT_SCALES.filter((n) => n <= scale.max).map((n) => (
                  <ToggleGroupItem
                    key={n}
                    value={String(n)}
                    className="flex-col"
                  >
                    <span className="font-medium">{n}×</span>
                    <span className="font-mono text-[11px]">
                      {Math.round(stage.width * n)}×
                      {Math.round(stage.height * n)}
                    </span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
          {lengthMs !== undefined && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-length`}>Length (seconds)</Label>
              <Input
                id={`${id}-length`}
                type="number"
                min={0.1}
                max={MAX_EXPORT_SECONDS}
                step={0.1}
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
                autoFocus
                aria-invalid={!validLength}
                className="h-9 rounded-lg py-0 font-mono text-[13px]"
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
