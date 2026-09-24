import type { ToolOutput } from "@/lib/agent-defs";
import { createExportLoop, prewarmImages } from "@/lib/export-common";
import { formatSeconds, planSheet } from "@/lib/frame-sheet-plan";

const LABEL_HEIGHT = 20;
const GAP = 4;
const CHECKER = 8;
const JPEG_QUALITY = 0.85;

type ExportScene = ReturnType<typeof createExportLoop>;

// A state machine with no timeline has no export range, but its t=0 frame is still worth a look.
function openScene(source: string, scale: number): ExportScene {
  try {
    return createExportLoop(source, "gif", { scale });
  } catch (e) {
    if (e instanceof Error && e.message.includes("state machine")) {
      return createExportLoop(source, "gif", { scale, durationMs: 0 });
    }
    throw e;
  }
}

/** render_frames: the scene paused at each requested time, tiled into one labelled JPEG. */
export async function renderFrameSheet(
  source: string,
  args: Record<string, unknown>,
): Promise<ToolOutput> {
  try {
    // A scale-1 probe learns the stage size and loop length before sizing the real one.
    const probe = openScene(source, 1);
    const plan = planSheet(args, probe.duration);
    if ("error" in plan) return { text: `Error: ${plan.error}` };
    const scene = openScene(source, plan.cellWidth / probe.width);
    return await drawSheet(scene, plan, probe.duration);
  } catch (e) {
    return {
      text: `Error rendering frames: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function drawSheet(
  scene: ExportScene,
  plan: Exclude<ReturnType<typeof planSheet>, { error: string }>,
  durationMs: number,
): Promise<ToolOutput> {
  const { loop, canvas, width, height } = scene;
  await prewarmImages(scene, plan.timesMs);

  const sheet = document.createElement("canvas");
  sheet.width = plan.cols * width + (plan.cols - 1) * GAP;
  sheet.height = plan.rows * (height + LABEL_HEIGHT) + (plan.rows - 1) * GAP;
  const ctx = sheet.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#9aa0a6";
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  plan.timesMs.forEach((t, i) => {
    const x = (i % plan.cols) * (width + GAP);
    const y = Math.floor(i / plan.cols) * (height + LABEL_HEIGHT + GAP);
    ctx.fillStyle = "#1f2328";
    ctx.fillRect(x, y, width, LABEL_HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(`t=${formatSeconds(t)}`, x + 6, y + LABEL_HEIGHT / 2);
    drawChecker(ctx, x, y + LABEL_HEIGHT, width, height);
    loop.seek(t);
    ctx.drawImage(canvas, x, y + LABEL_HEIGHT);
  });

  const data = sheet.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
  const loopNote =
    durationMs > 0 && Number.isFinite(durationMs)
      ? `one loop is ${formatSeconds(durationMs)}`
      : "no finite loop";
  return {
    text: `Rendered ${plan.timesMs.length} frame(s) at ${plan.timesMs.map(formatSeconds).join(", ")} (${loopNote}); grid ${plan.cols}×${plan.rows}, read left→right, top→bottom.`,
    images: [{ data, mimeType: "image/jpeg" }],
  };
}

function drawChecker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ececec";
  for (let cy = 0; cy < h; cy += CHECKER) {
    for (let cx = (cy / CHECKER) % 2 ? CHECKER : 0; cx < w; cx += CHECKER * 2) {
      ctx.fillRect(
        x + cx,
        y + cy,
        Math.min(CHECKER, w - cx),
        Math.min(CHECKER, h - cy),
      );
    }
  }
}
