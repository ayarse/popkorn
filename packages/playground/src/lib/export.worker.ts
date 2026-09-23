import type { ExportFormat } from "@/lib/export-common";
import { exportGif } from "@/lib/gif";
import { exportMp4 } from "@/lib/mp4";

// Cast the worker global to the minimal surface we use, so the file typechecks
// under the DOM lib without pulling in the WebWorker lib (which conflicts).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const exporters = { gif: exportGif, mp4: exportMp4 };

// NOTE: raster image nodes render blank and custom web fonts aren't
// registered in the worker — acceptable for now.
ctx.onmessage = async (e: MessageEvent) => {
  const { format, source, durationMs, scale } = e.data as {
    format: ExportFormat;
    source: string;
    durationMs?: number;
    scale?: number;
  };
  try {
    const bytes = await exporters[format](source, {
      durationMs,
      scale,
      onProgress: (fraction) => ctx.postMessage({ type: "progress", fraction }),
    });
    ctx.postMessage({ type: "done", bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (err) {
    ctx.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
