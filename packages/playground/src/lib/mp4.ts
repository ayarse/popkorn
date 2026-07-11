import { parse } from "@popkorn/parser";
import {
  AnimationScheduler,
  buildSceneGraph,
  Canvas2DRenderer,
  RenderLoop,
} from "@popkorn/player";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { avcCodec, evenDim, planMp4 } from "@/lib/mp4-plan";

export { planMp4 } from "@/lib/mp4-plan";

/** H.264 carries no alpha; a transparent/absent stage background composites to white. */
function resolveBackground(bg: string | undefined): string {
  return !bg || bg === "transparent" ? "#ffffff" : bg;
}

/** A DOM-free canvas: OffscreenCanvas in a worker, a real element on the main thread. */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas =
    typeof document === "undefined"
      ? (new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement)
      : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Render `source` offline to a downloadable H.264 MP4 (Uint8Array of file bytes).
 *
 * Same seek-driven walk as {@link exportGif}: spin up a throwaway player over an
 * offscreen canvas at the scene's native size, seek frame-by-frame across
 * [0, duration], and feed each frame to a WebCodecs `VideoEncoder`, muxing the
 * chunks with mp4-muxer. Each frame is composited onto the stage background
 * first, since H.264 has no alpha.
 */
export async function exportMp4(
  source: string,
  { onProgress }: { onProgress?: (fraction: number) => void } = {},
): Promise<Uint8Array> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error(
      "MP4 export requires WebCodecs (VideoEncoder), which this browser lacks.",
    );
  }

  const ast = parse(source);
  // NOTE: even-dimension rounding can crop up to 1px off an odd-sized stage.
  const width = evenDim(ast.canvas?.width ?? 400);
  const height = evenDim(ast.canvas?.height ?? 300);

  const canvas = makeCanvas(width, height);
  const renderer = new Canvas2DRenderer(canvas);
  const scheduler = new AnimationScheduler();
  const loop = new RenderLoop(renderer, scheduler);
  loop.setScene(buildSceneGraph(ast));
  loop.setSceneSize(width, height);
  loop.getVariableResolver().setVariables(ast.variables);

  const plan = planMp4(loop.duration);

  // Composite target: fill the (opaque) background, then draw the (transparent)
  // scene canvas on top, so the encoder never sees premultiplied-against-black.
  const background = resolveBackground(ast.canvas?.background);
  const composite = makeCanvas(width, height);
  const cctx = composite.getContext("2d")!;

  // Prewarm image decodes: seek every frame time once to kick off every load,
  // then await them all (a seek-driven export has no "repaint later").
  if (renderer.whenImagesSettled) {
    for (let i = 0; i < plan.frameCount; i++) {
      loop.seek(Math.min(i * plan.delayMs, loop.duration));
    }
    await renderer.whenImagesSettled();
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: Math.round(plan.fps) },
    fastStart: "in-memory",
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure({
    codec: avcCodec(width, height),
    width,
    height,
    framerate: plan.fps,
    // NOTE: fixed heuristic bitrate (no quality UI); ~0.12 bits/px/frame, capped.
    bitrate: Math.min(20_000_000, Math.round(width * height * plan.fps * 0.12)),
  });

  for (let i = 0; i < plan.frameCount; i++) {
    if (encodeError) throw encodeError;

    // Sample at real wall-clock time so playback speed matches the scene.
    loop.seek(Math.min(i * plan.delayMs, loop.duration));

    cctx.fillStyle = background;
    cctx.fillRect(0, 0, width, height);
    cctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);

    const frame = new VideoFrame(composite as unknown as CanvasImageSource, {
      timestamp: Math.round(i * plan.frameDurationUs),
      duration: plan.frameDurationUs,
    });
    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();

    onProgress?.((i + 1) / plan.frameCount);

    // Bound encoder queue memory on long exports; also yields to the main-thread
    // progress label. In a worker there's no UI, but backpressure still matters.
    if (encoder.encodeQueueSize > 30 || typeof document !== "undefined") {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await encoder.flush();
  if (encodeError) throw encodeError;
  muxer.finalize();
  return new Uint8Array(target.buffer);
}

/**
 * Same as {@link exportMp4}, but runs the whole render/encode pipeline in a Web
 * Worker so the main thread stays responsive. Falls back to inline `exportMp4`
 * where Worker/OffscreenCanvas aren't available (WebCodecs is still required —
 * `exportMp4` throws a clear error if `VideoEncoder` is missing).
 */
export function exportMp4InWorker(
  source: string,
  { onProgress }: { onProgress?: (fraction: number) => void } = {},
): Promise<Uint8Array> {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    return exportMp4(source, { onProgress });
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mp4.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress?.(msg.fraction);
      } else if (msg.type === "done") {
        worker.terminate();
        resolve(msg.bytes);
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ source });
  });
}

/** Trigger a browser download of `bytes` as `filename` via a temporary object URL. */
export function downloadMp4(bytes: Uint8Array, filename = "scene.mp4"): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke: revoking synchronously after click() cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
