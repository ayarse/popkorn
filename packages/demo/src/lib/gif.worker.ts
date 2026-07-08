import { exportGif } from "./gif";

// Cast the worker global to the minimal surface we use, so the file typechecks
// under the DOM lib without pulling in the WebWorker lib (which conflicts).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

// ponytail: raster image nodes render blank and custom web fonts aren't
// registered in the worker — acceptable for now.
ctx.onmessage = async (e: MessageEvent) => {
  const { source } = e.data as {
    source: string;
  };
  try {
    const bytes = await exportGif(source, {
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
