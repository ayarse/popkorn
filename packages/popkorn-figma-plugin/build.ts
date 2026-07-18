/**
 * Bundles the plugin into `dist/`: `main.js` (sandbox) and a self-contained
 * `ui.html` (the UI JS is inlined, since Figma loads the UI as one HTML blob via
 * `__html__`). Zero config beyond Bun's bundler — no webpack/esbuild step.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

// Sandbox entry -> dist/main.js.
const main = await Bun.build({
  entrypoints: [join(root, "src/main.ts")],
  target: "browser",
  minify: false,
});
if (!main.success) {
  console.error(main.logs.join("\n"));
  process.exit(1);
}
writeFileSync(join(dist, "main.js"), await main.outputs[0].text());

// UI entry -> inline into dist/ui.html.
const ui = await Bun.build({
  entrypoints: [join(root, "src/ui.ts")],
  target: "browser",
  minify: true,
});
if (!ui.success) {
  console.error(ui.logs.join("\n"));
  process.exit(1);
}
const uiJs = await ui.outputs[0].text();

const html = `<!doctype html>
<meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  body { font: 12px/1.5 Inter, system-ui, sans-serif; margin: 0; padding: 12px; }
  h1 { font-size: 13px; margin: 0 0 8px; }
  button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #0000002a; cursor: pointer; }
  button.primary { background: #0d99ff; color: #fff; border-color: transparent; }
  button:disabled { opacity: .5; cursor: default; }
  .row { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  #preview-note { text-transform: none; letter-spacing: 0; font-weight: normal; color: #888; }
  #status { color: #666; margin: 6px 0; min-height: 1.4em; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #888; margin: 10px 0 4px; }
  ul { margin: 0; padding-left: 16px; }
  li { margin: 2px 0; }
  li.ok { list-style: none; margin-left: -16px; color: #888; }
  li.warn { color: #b8860b; }
  li.blocked { color: #c0392b; }
  pre { background: #00000010; padding: 8px; border-radius: 6px; overflow: auto; max-height: 180px; white-space: pre-wrap; }
</style>
<h1>Popkorn Export</h1>
<div class="row">
  <button id="export" class="primary">Export selection</button>
  <button id="save" disabled>Download .css</button>
  <button id="save-bundle" disabled>Save bundle (.figma.json)</button>
  <button id="close">Close</button>
</div>
<div id="status">Select frames/shapes, then Export. Nothing selected exports the whole page.</div>
<h2>Warnings</h2>
<ul id="warnings"><li class="ok">—</li></ul>
<h2>Blocked</h2>
<ul id="blocked"><li class="ok">—</li></ul>
<h2>Preview <span id="preview-note"></span></h2>
<pre id="preview"></pre>
<script>${uiJs}</script>
`;
writeFileSync(join(dist, "ui.html"), html);

console.log("built dist/main.js and dist/ui.html");
