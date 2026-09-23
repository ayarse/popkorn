import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ExportChoice } from "@/components/export-dialog";
import { downloadBytes } from "@/lib/export-common";

export type ExportFormat = "GIF" | "MP4" | "Lottie";

export interface ExportPrompt {
  format: ExportFormat;
  stage: { width: number; height: number };
  scale?: { default: number; max: number };
  lengthMs?: number;
  resolve: (choice: ExportChoice | null) => void;
}

type RasterExport = (
  source: string,
  opts: ExportChoice & {
    onProgress: (p: number) => void;
    signal: AbortSignal;
  },
) => Promise<Uint8Array>;

// Raster encoders load on demand so the worker plumbing stays out of the main chunk.
const RASTER: Record<
  "GIF" | "MP4",
  { load: () => Promise<RasterExport>; filename: string; mime: string }
> = {
  GIF: {
    load: () => import("@/lib/gif").then((m) => m.exportGifInWorker),
    filename: "scene.gif",
    mime: "image/gif",
  },
  MP4: {
    load: () => import("@/lib/mp4").then((m) => m.exportMp4InWorker),
    filename: "scene.mp4",
    mime: "video/mp4",
  },
};

/** Export state + the settings-dialog promise; `runExport` drives any format. */
export function useExport(source: string) {
  // null = idle; otherwise the in-flight export's format + 0..1 progress.
  const [exporting, setExporting] = useState<{
    format: ExportFormat;
    progress: number;
  } | null>(null);
  // Pending settings dialog; resolve(null) = cancelled.
  const [prompt, setPrompt] = useState<ExportPrompt | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Asks for settings: raster formats always (scale), any format needing a length. */
  async function askSettings(
    format: ExportFormat,
  ): Promise<ExportChoice | null> {
    const [{ parse }, { buildSceneGraph, sceneExportLength }, { maxMp4Scale }] =
      await Promise.all([
        import("@popkorn/parser"),
        import("@popkorn/player"),
        import("@/lib/mp4-plan"),
      ]);
    const ast = parse(source);
    const length = sceneExportLength(buildSceneGraph(ast), ast.variables);
    const lengthMs = length && !length.fixed ? length.suggestedMs : undefined;
    const stage = {
      width: ast.canvas?.width ?? 400,
      height: ast.canvas?.height ?? 300,
    };
    const mp4Max = maxMp4Scale(stage.width, stage.height);
    const scale = {
      GIF: { default: 1, max: 3 },
      MP4: { default: Math.min(2, mp4Max), max: mp4Max },
      Lottie: undefined,
    }[format];
    if (!scale && lengthMs === undefined) return {};
    return new Promise((resolve) =>
      setPrompt({ format, stage, scale, lengthMs, resolve }),
    );
  }

  function closePrompt(choice: ExportChoice | null) {
    prompt?.resolve(choice);
    setPrompt(null);
  }

  async function runExport(format: ExportFormat) {
    if (exporting !== null) return;
    try {
      const choice = await askSettings(format);
      if (!choice) return;
      if (format === "Lottie") {
        const { convertPopkorn } = await import("@popkorn/converters");
        const { lottie, warnings } = convertPopkorn(source, {
          durationMs: choice.durationMs,
        });
        downloadBytes(
          new TextEncoder().encode(JSON.stringify(lottie)),
          "scene.json",
          "application/json",
        );
        if (warnings.length)
          toast.warning(
            `Lottie exported with ${warnings.length} warning${warnings.length > 1 ? "s" : ""}`,
            { description: warnings.join("; ") },
          );
        return;
      }
      setExporting({ format, progress: 0 });
      const ac = new AbortController();
      abortRef.current = ac;
      const { load, filename, mime } = RASTER[format];
      const run = await load();
      const bytes = await run(source, {
        ...choice,
        onProgress: (progress) => setExporting({ format, progress }),
        signal: ac.signal,
      });
      downloadBytes(bytes, filename, mime);
    } catch (e: any) {
      if (e?.name !== "AbortError")
        toast.error(`${format} export failed`, { description: e?.message });
    } finally {
      abortRef.current = null;
      setExporting(null);
    }
  }

  const cancelExport = () => abortRef.current?.abort();

  return { exporting, prompt, closePrompt, runExport, cancelExport };
}
