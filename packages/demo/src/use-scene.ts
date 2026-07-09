import { parse, serialize } from "@popcorn/parser";
import { useState } from "react";
import { examples } from "@/examples";
import {
  buildImportResult,
  bytes,
  gzipSizes,
  type ImportResult,
  type SizeDelta,
} from "@/lib/import-size";
import { convertLottie } from "../../../tools/lottie2popcorn";
import { convertSvg } from "../../../tools/svg2popcorn";

// Detects pasted SVG markup (vs Lottie JSON) — leading xml decl / comments then <svg.
const SVG_RE =
  /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(svg|!DOCTYPE svg)/i;

// Owns the playground's scene state — the source, its format flags, and the
// import/minify logic that loads and transforms it. App keeps only view state
// (which modal/sidebar is open) and wires these into the panels.
export function useScene() {
  const [currentExample, setCurrentExample] = useState<string | null>("motion");
  const [source, setSource] = useState(examples[1].source);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [minified, setMinified] = useState(false);
  const [sizeDelta, setSizeDelta] = useState<SizeDelta | null>(null);

  // Load a fresh scene from anywhere but an example (import / copilot): clears
  // the example selection and the format/size state that no longer applies.
  function loadSource(css: string) {
    setCurrentExample(null);
    setSource(css);
    setMinified(false);
    setSizeDelta(null);
  }

  // Editor edits: the byte-delta badge is only meaningful right after a
  // minify/format, so any manual edit clears it.
  function editSource(value: string) {
    setSource(value);
    setSizeDelta(null);
  }

  function selectExample(key: string) {
    const ex = examples.find((e) => e.key === key);
    if (!ex) return;
    setCurrentExample(key);
    setSource(ex.source);
    setMinified(false);
    setSizeDelta(null);
    setImportResult(null);
    setError(null);
  }

  function toggleMinify() {
    try {
      const next = serialize(parse(source), { minify: !minified });
      setSizeDelta({ before: bytes(source), after: bytes(next) });
      setSource(next);
      setMinified(!minified);
      setError(null);
    } catch (e: any) {
      setError(`Could not format: ${e.message}`);
    }
  }

  function applyImport(
    format: string,
    label: string,
    text: string,
    css: string,
    warnings: string[],
    blocked: string[],
  ) {
    loadSource(css);
    const result = buildImportResult(format, label, text, css);
    result.warnings = warnings;
    result.blocked = blocked;
    setImportResult(result);
    void gzipSizes(format, text, css).then((gz) =>
      setImportResult((prev) => (prev === result ? { ...prev, gz } : prev)),
    );
  }

  function importLottie(text: string, label: string): boolean {
    setError(null);
    let lottie: any;
    try {
      lottie = JSON.parse(text);
    } catch (e: any) {
      setError(`Invalid JSON: ${e.message}`);
      return false;
    }
    try {
      const { css, warnings, blocked } = convertLottie(lottie);
      applyImport("Lottie", label, text, css, warnings, blocked);
      return true;
    } catch (e: any) {
      setError(`Lottie conversion failed: ${e.message}`);
      return false;
    }
  }

  function importSvg(text: string, label: string): boolean {
    setError(null);
    try {
      const { css, warnings, blocked } = convertSvg(text);
      applyImport("SVG", label, text, css, warnings, blocked);
      return true;
    } catch (e: any) {
      setError(`SVG conversion failed: ${e.message}`);
      return false;
    }
  }

  // Pasted markup: sniff SVG vs Lottie JSON. Returns success so the caller can
  // dismiss the import modal.
  function importText(text: string): boolean {
    return SVG_RE.test(text)
      ? importSvg(text, "pasted SVG")
      : importLottie(text, "pasted JSON");
  }

  function importFile(file: File): Promise<boolean> {
    const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        resolve(
          isSvg
            ? importSvg(text, `"${file.name}"`)
            : importLottie(text, `"${file.name}"`),
        );
      };
      reader.onerror = () => {
        setError(`Could not read file: ${file.name}`);
        resolve(false);
      };
      reader.readAsText(file);
    });
  }

  // Copilot-generated scene.
  function applyGenerated(css: string) {
    loadSource(css);
    setImportResult(null);
    setError(null);
  }

  return {
    source,
    error,
    importResult,
    currentExample,
    minified,
    sizeDelta,
    setError,
    editSource,
    selectExample,
    dismissImport: () => setImportResult(null),
    toggleMinify,
    importText,
    importFile,
    applyGenerated,
  };
}
