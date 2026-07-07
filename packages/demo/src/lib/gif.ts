import { parse } from "@popcorn/parser";
import {
  buildSceneGraph,
  Canvas2DRenderer,
  RenderLoop,
  AnimationScheduler,
} from "@popcorn/player";
import { quantize, applyPalette, GIFEncoder } from "gifenc";
import { planGif } from "./gif-plan";

export { planGif } from "./gif-plan";

/**
 * Render `source` offline to a downloadable GIF (Uint8Array of GIF bytes).
 *
 * The timeline is a pure function of time, so we spin up a throwaway player
 * over an offscreen canvas at the scene's native size (viewport identity → 1:1
 * scene px), seek frame-by-frame across [0, duration), and encode each frame.
 * No DPR/letterbox from the on-screen canvas leaks in.
 */
export async function exportGif(
  source: string,
  {
    background,
    onProgress,
  }: { background?: string | null; onProgress?: (fraction: number) => void } = {},
): Promise<Uint8Array> {
  const ast = parse(source);
  const width = ast.canvas?.width ?? 400;
  const height = ast.canvas?.height ?? 300;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const renderer = new Canvas2DRenderer(canvas);
  const scheduler = new AnimationScheduler();
  const loop = new RenderLoop(renderer, scheduler);
  loop.setScene(buildSceneGraph(ast));
  loop.setSceneSize(width, height);
  loop.getVariableResolver().setVariables(ast.variables);

  // A transparent export keeps alpha; anything else fills a solid backdrop.
  const bg = background === "transparent" ? null : background ?? ast.canvas?.background ?? null;
  const transparent = bg === null;
  if (bg) loop.setBackgroundColor(bg);

  const ctx = canvas.getContext("2d")!;
  const format = transparent ? "rgba4444" : "rgb565";

  const plan = planGif(loop.duration);
  const gif = GIFEncoder();

  for (let i = 0; i < plan.frameCount; i++) {
    const t = plan.frameCount > 1 ? (i / plan.frameCount) * loop.duration : 0;
    loop.seek(t);

    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256, { format });
    const index = applyPalette(data, palette, format);
    const transparentIndex = transparent ? palette.findIndex((c) => c[3] === 0) : -1;

    gif.writeFrame(index, width, height, {
      palette,
      delay: plan.delayMs,
      repeat: 0,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
    });

    onProgress?.((i + 1) / plan.frameCount);
    // Yield so the progress label can repaint between frames.
    await new Promise((r) => setTimeout(r, 0));
  }

  gif.finish();
  return gif.bytes();
}

/** Trigger a browser download of `bytes` as `filename` via a temporary object URL. */
export function downloadGif(bytes: Uint8Array, filename = "scene.gif"): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke: revoking synchronously after click() cancels the download
  // before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
