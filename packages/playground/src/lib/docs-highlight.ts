import Prism from "prismjs";
import "prismjs/components/prism-css";
import "prismjs/components/prism-css-extras";

// Client-side highlighting for editable docs scenes: CSS only, so the rest of
// Prism's grammars stay on the server with `docs-render.ts`.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function highlightCss(code: string): string {
  return Prism.highlight(code, Prism.languages.css, "css");
}
