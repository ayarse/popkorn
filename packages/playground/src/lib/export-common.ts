import { parse } from "@popkorn/parser";
import {
  AnimationScheduler,
  buildSceneGraph,
  Canvas2DRenderer,
  computeSceneDuration,
  RenderLoop,
} from "@popkorn/player";
import { scaledFrame } from "@/lib/export-scale";

export type ExportFormat = "gif" | "mp4";

export interface ExportOptions {
  onProgress?: (fraction: number) => void;
  /** Export length in ms; overrides the scene's computed duration. */
  durationMs?: number;
  /** Output pixel scale over the stage size (default 1). */
  scale?: number;
  /** Aborting rejects the export with an `AbortError` and stops its worker. */
  signal?: AbortSignal;
}

/** A DOM-free canvas: OffscreenCanvas in a worker, a real element on the main thread. */
export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  // Canvas2DRenderer only calls getContext("2d"), so the cast is safe at runtime.
  const canvas =
    typeof document === "undefined"
      ? (new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement)
      : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * A throwaway player over an offscreen canvas at the scene's (scaled) size,
 * for seek-driven frame capture. No DPR/letterbox from the on-screen canvas
 * leaks in. `duration` is the export range in ms.
 */
export function createExportLoop(
  source: string,
  format: ExportFormat,
  {
    durationMs,
    scale = 1,
    maxScale,
    round,
  }: {
    durationMs?: number;
    scale?: number;
    maxScale?: (w: number, h: number) => number;
    round?: (n: number) => number;
  } = {},
) {
  const ast = parse(source);
  const stageWidth = ast.canvas?.width ?? 400;
  const stageHeight = ast.canvas?.height ?? 300;
  const { width, height, viewport } = scaledFrame(
    stageWidth,
    stageHeight,
    maxScale ? Math.min(scale, maxScale(stageWidth, stageHeight)) : scale,
    round,
  );

  const root = buildSceneGraph(ast);
  const canvas = makeCanvas(width, height);
  const renderer = new Canvas2DRenderer(canvas);
  const loop = new RenderLoop(renderer, new AnimationScheduler());
  loop.setScene(root);
  loop.setSceneSize(stageWidth, stageHeight);
  loop.setViewport(viewport);
  loop.getVariableResolver().setVariables(ast.variables);

  // Export range, NOT `loop.duration`: an unbounded scene reports Infinity to
  // hide the seeker, but a perpetual (all-infinite) scene still has an honest
  // frame range — one cycle of the nominal period. Only a state machine with no
  // timeline animations (nominal 0 yet unbounded) has nothing to export; a
  // static scene is nominal 0 and bounded, and exports its single frame.
  const duration = durationMs ?? computeSceneDuration(root);
  if (
    durationMs === undefined &&
    duration <= 0 &&
    !Number.isFinite(loop.duration)
  ) {
    throw new Error(
      `This scene is a state machine with no timeline animation, so it has no frame range to export to ${format.toUpperCase()}.`,
    );
  }

  return { ast, canvas, renderer, loop, width, height, duration };
}

/**
 * Seek every frame time once to kick off every image decode, then await them:
 * the live loop repaints when a decode lands, a seek-driven export can't.
 */
export async function prewarmImages(
  {
    loop,
    renderer,
  }: Pick<ReturnType<typeof createExportLoop>, "loop" | "renderer">,
  frameTimes: number[],
): Promise<void> {
  if (!renderer.whenImagesSettled) return;
  for (const t of frameTimes) loop.seek(t);
  await renderer.whenImagesSettled();
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Export aborted", "AbortError");
}

/**
 * Runs `format`'s export in a Web Worker so the main thread stays responsive;
 * falls back to `inline` where Worker/OffscreenCanvas aren't available.
 */
export function runExportWorker(
  format: ExportFormat,
  source: string,
  { onProgress, durationMs, scale, signal }: ExportOptions,
  inline: (source: string, options: ExportOptions) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    return inline(source, { onProgress, durationMs, scale, signal });
  }
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const worker = new Worker(new URL("./export.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Export aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress?.(msg.fraction);
      } else if (msg.type === "done") {
        finish();
        resolve(msg.bytes);
      } else if (msg.type === "error") {
        finish();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message));
    };
    worker.postMessage({ format, source, durationMs, scale });
  });
}

/** Trigger a browser download of `bytes` as `filename` via a temporary object URL. */
export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke: revoking synchronously after click() cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
