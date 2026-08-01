import { convertLottie, convertSvg } from "@popkorn/converters";
import { parse, serialize } from "@popkorn/parser";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { examples } from "@/examples";
import { track } from "@/lib/analytics";
import {
  buildImportResult,
  bytes,
  gzipSizes,
  type ImportResult,
  type SizeDelta,
} from "@/lib/import-size";
import { getScene } from "@/lib/scenes";

// Detects pasted SVG markup (vs Lottie JSON) — leading xml decl / comments then <svg.
const SVG_RE =
  /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(svg|!DOCTYPE svg)/i;

// Owns the playground's scene state — the source, its format flags, and the
// import/minify logic that loads and transforms it. App keeps only view state
// (which modal/sidebar is open) and wires these into the panels.
/** A community submission opened in the editor, for the header's byline and
 *  report button. Null for examples and for scratch scenes. */
export interface CommunityScene {
  id: string;
  title: string;
  author: string | null;
  tags: string[];
  /** True when the signed-in user published it — unlocks save/delete. */
  mine: boolean;
}

export function useScene() {
  // Deep links are the `/examples/$key` and `/s/$id` routes; `/` falls back to
  // the default scene.
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const routeKey = params.key;
  const routeSceneId = params.id;
  const defaultExample =
    examples.find((e) => e.key === routeKey) ??
    examples.find((e) => e.key === "lottie--magic-eye") ??
    examples[0];
  const [currentExample, setCurrentExample] = useState<string | null>(
    defaultExample.key,
  );
  const [source, setSource] = useState(defaultExample.source);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [minified, setMinified] = useState(false);
  const [sizeDelta, setSizeDelta] = useState<SizeDelta | null>(null);
  const [community, setCommunity] = useState<CommunityScene | null>(null);

  // Load a fresh scene from anywhere but an example (import / copilot): clears
  // the example selection and the format/size state that no longer applies.
  function loadSource(css: string) {
    setCurrentExample(null);
    setCommunity(null);
    setSource(css);
    setMinified(false);
    setSizeDelta(null);
  }

  // `/s/$id` opens a community submission in this same editor — there is no
  // separate viewer. The route SSRs the head; the CSS is fetched here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the URL alone
  useEffect(() => {
    if (!routeSceneId || routeSceneId === community?.id) return;
    void getScene({ data: routeSceneId }).then((s) => {
      if (!s) {
        setError("That shared scene no longer exists.");
        return;
      }
      loadSource(s.css);
      setCommunity({
        id: s.id,
        title: s.title,
        author: s.author,
        tags: s.tags,
        mine: s.mine,
      });
    });
  }, [routeSceneId]);

  // Editor edits: the byte-delta badge is only meaningful right after a
  // minify/format, so any manual edit clears it.
  function editSource(value: string) {
    setSource(value);
    setSizeDelta(null);
  }

  // Picking an example is a navigation; the effect below is what actually
  // loads it, so the back button and a pasted URL take the same path.
  function selectExample(key: string) {
    if (!examples.some((e) => e.key === key)) return;
    track("example_view", { example: key });
    void navigate({ to: "/examples/$key", params: { key } });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the URL alone
  useEffect(() => {
    if (!routeKey || routeKey === currentExample) return;
    const ex = examples.find((e) => e.key === routeKey);
    if (!ex) return;
    setCurrentExample(ex.key);
    setCommunity(null);
    setSource(ex.source);
    setMinified(false);
    setSizeDelta(null);
    setImportResult(null);
    setError(null);
  }, [routeKey]);

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

  // Destructive: minify AND rename every id/class/@keyframes/@define/custom
  // property to a short meaningless name. Render-preserving but one-way — the
  // human names are gone. The UI confirms before calling this.
  function crush() {
    try {
      const next = serialize(parse(source), { crush: true });
      setSizeDelta({ before: bytes(source), after: bytes(next) });
      setSource(next);
      setMinified(true);
      setError(null);
    } catch (e: any) {
      setError(`Could not crush: ${e.message}`);
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
    track("import", {
      format,
      blocked: blocked.length,
      warnings: warnings.length,
    });
    const result = buildImportResult(format, label, text, css);
    result.warnings = warnings;
    result.blocked = blocked;
    setImportResult(result);
    void gzipSizes(format, text, css).then((sizes) =>
      setImportResult((prev) =>
        prev === result && sizes
          ? { ...prev, gz: sizes.gz, crushGz: sizes.crushGz }
          : prev,
      ),
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
    community,
    minified,
    sizeDelta,
    setError,
    editSource,
    selectExample,
    dismissImport: () => setImportResult(null),
    toggleMinify,
    crush,
    importText,
    importFile,
    applyGenerated,
  };
}
