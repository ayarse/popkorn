import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import {
  createExportLoop,
  downloadBytes,
  type ExportOptions,
  makeCanvas,
  prewarmImages,
  runExportWorker,
  throwIfAborted,
} from "@/lib/export-common";
import { avcCodec, evenDim, maxMp4Scale, planMp4 } from "@/lib/mp4-plan";

/** H.264 carries no alpha; a transparent/absent stage background composites to white. */
function resolveBackground(bg: string | undefined): string {
  return !bg || bg === "transparent" ? "#ffffff" : bg;
}

/**
 * Render `source` offline to a downloadable H.264 MP4 (Uint8Array of file bytes).
 * Same seek-driven walk as the GIF exporter, feeding a WebCodecs
 * `VideoEncoder` muxed by mp4-muxer. Each frame is composited onto the stage
 * background first, since H.264 has no alpha.
 */
export async function exportMp4(
  source: string,
  { onProgress, durationMs, scale = 1, signal }: ExportOptions = {},
): Promise<Uint8Array> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error(
      "MP4 export requires WebCodecs (VideoEncoder), which this browser lacks.",
    );
  }

  // NOTE: even-dimension rounding can crop up to 1px off an odd-sized stage.
  const scene = createExportLoop(source, "mp4", {
    durationMs,
    scale,
    maxScale: maxMp4Scale,
    round: evenDim,
  });
  const { ast, canvas, loop, width, height, duration } = scene;
  const plan = planMp4(duration);
  const times = Array.from({ length: plan.frameCount }, (_, i) =>
    Math.min(i * plan.delayMs, duration),
  );

  // Composite target: fill the (opaque) background, then draw the (transparent)
  // scene canvas on top, so the encoder never sees premultiplied-against-black.
  const background = resolveBackground(ast.canvas?.background);
  const composite = makeCanvas(width, height);
  const cctx = composite.getContext("2d")!;

  await prewarmImages(scene, times);

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

  try {
    for (let i = 0; i < times.length; i++) {
      if (encodeError) throw encodeError;
      throwIfAborted(signal);
      loop.seek(times[i]);

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

      // Bound encoder queue memory on long exports; also yields to the
      // main-thread progress label.
      if (encoder.encodeQueueSize > 30 || typeof document !== "undefined") {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    await encoder.flush();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  if (encodeError) throw encodeError;
  muxer.finalize();
  return new Uint8Array(target.buffer);
}

/** {@link exportMp4} in a Web Worker, falling back to inline where unsupported. */
export function exportMp4InWorker(
  source: string,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  return runExportWorker("mp4", source, options, exportMp4);
}

export function downloadMp4(bytes: Uint8Array, filename = "scene.mp4"): void {
  downloadBytes(bytes, filename, "video/mp4");
}
