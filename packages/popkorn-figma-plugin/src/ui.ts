/**
 * Popkorn Export — UI iframe thread.
 *
 * Runs in a normal browser realm (DOM + Blob downloads, no document access). It
 * asks the sandbox for a capture bundle, runs the real converter core
 * (`@popkorn/converters` figma2popkorn) on it, shows the warning/blocked ledger,
 * and offers the emitted `.css` as a download.
 */
import { convertFigma, type FigmaCaptureBundle } from "@popkorn/converters";

const $ = (id: string) => document.getElementById(id)!;
const parent = window.parent;

// Preview is clamped to this many chars; the note appears only past it.
const PREVIEW_LIMIT = 4000;

let lastCss = "";
let lastBundle: FigmaCaptureBundle | null = null;

function post(type: string) {
  parent.postMessage({ pluginMessage: { type } }, "*");
}

function renderLedger(list: HTMLElement, items: string[], kind: string) {
  list.innerHTML = "";
  if (items.length === 0) {
    list.innerHTML = `<li class="ok">no ${kind}</li>`;
    return;
  }
  for (const w of items) {
    const li = document.createElement("li");
    li.className = kind;
    li.textContent = w;
    list.appendChild(li);
  }
}

function saveBlob(data: string, name: string, ext: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() + ext;
  a.click();
  URL.revokeObjectURL(url);
}

window.onmessage = (e: MessageEvent) => {
  const msg = e.data?.pluginMessage;
  if (!msg) return;
  if (msg.type === "bundle") {
    try {
      const { css, warnings, blocked } = convertFigma(msg.bundle);
      lastCss = css;
      lastBundle = msg.bundle;
      $("status").textContent =
        `Converted "${msg.bundle.name ?? "scene"}" — ${msg.bundle.nodes.length} root node(s).`;
      renderLedger($("warnings"), warnings, "warn");
      renderLedger($("blocked"), blocked, "blocked");
      ($("save") as HTMLButtonElement).disabled = false;
      ($("save-bundle") as HTMLButtonElement).disabled = false;
      $("preview").textContent = css.slice(0, PREVIEW_LIMIT);
      // Only label the preview when it is actually clamped.
      const kb = (n: number) => Math.max(1, Math.round(n / 1024));
      $("preview-note").textContent =
        css.length > PREVIEW_LIMIT
          ? `— first ${kb(PREVIEW_LIMIT)} KB of ${kb(new Blob([css]).size)} KB; Save downloads the full file`
          : "";
    } catch (err: any) {
      $("status").textContent =
        "Conversion failed: " + String(err?.message ?? err);
    }
  } else if (msg.type === "error") {
    $("status").textContent = "Capture failed: " + msg.message;
  }
};

$("export").addEventListener("click", () => {
  $("status").textContent = "Capturing selection…";
  ($("save") as HTMLButtonElement).disabled = true;
  ($("save-bundle") as HTMLButtonElement).disabled = true;
  post("export");
});
$("save").addEventListener("click", () => {
  if (lastCss) saveBlob(lastCss, "popkorn-scene", ".css", "text/css");
});
$("save-bundle").addEventListener("click", () => {
  if (lastBundle)
    saveBlob(
      JSON.stringify(lastBundle),
      lastBundle.name || "popkorn-scene",
      ".figma.json",
      "application/json",
    );
});
$("close").addEventListener("click", () => post("close"));
