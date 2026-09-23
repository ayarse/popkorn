import { parse, serialize } from "@popkorn/parser";
import { useMatch, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { findExample } from "@/examples";
import { track } from "@/lib/analytics";
import {
  buildImportResult,
  bytes,
  gzipSizes,
  type ImportResult,
  type SizeDelta,
} from "@/lib/import-size";

// Detects pasted SVG markup (vs Lottie JSON) — leading xml decl / comments then <svg.
const SVG_RE =
  /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(svg|!DOCTYPE svg)/i;

/** How long typing must pause before the player reloads the scene. */
const TYPING_DEBOUNCE_MS = 150;

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

// Owns the playground's scene state — the source, its format flags, and the
// import/minify logic that loads and transforms it. App keeps only view state.
export function useScene() {
  // Each playground route's loader fetches its scene: `/examples/$key` and
  // `/` an example source, `/s/$id` a community scene.
  const navigate = useNavigate();
  const routeKey = useParams({ strict: false }).key;
  const loaded = useMatch({ from: "/s/$id", shouldThrow: false })?.loaderData;
  const exampleSource = useMatch({ from: "/examples/$key", shouldThrow: false })
    ?.loaderData?.source;
  const home = useMatch({ from: "/", shouldThrow: false })?.loaderData;

  const [initial] = useState(() => {
    if (loaded) return { css: loaded.css, example: null };
    if (routeKey && exampleSource !== undefined)
      return { css: exampleSource, example: routeKey };
    return { css: home?.source ?? "", example: home?.key ?? null };
  });
  const [currentExample, setCurrentExample] = useState<string | null>(
    initial.example,
  );
  const [source, setSource] = useState(initial.css);
  // What the player renders: trails `source` while typing, else in lockstep.
  const [playerSource, setPlayerSource] = useState(initial.css);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [minified, setMinified] = useState(false);
  const [sizeDelta, setSizeDelta] = useState<SizeDelta | null>(null);
  const [community, setCommunity] = useState<CommunityScene | null>(
    loaded ? toCommunity(loaded) : null,
  );
  const typingTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  /** Programmatic source change: the player follows immediately. */
  function commit(css: string) {
    clearTimeout(typingTimer.current);
    setSource(css);
    setPlayerSource(css);
  }

  // A fresh scene replaces the format/size state that no longer applies.
  function loadScene(css: string, example: string | null) {
    commit(css);
    setCurrentExample(example);
    setCommunity(null);
    setMinified(false);
    setSizeDelta(null);
  }

  function loadExample(key: string, css: string) {
    loadScene(css, key);
    setImportResult(null);
    setError(null);
  }

  // `/s/$id` opens a community submission in this same editor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the scene id alone
  useEffect(() => {
    if (!loaded || loaded.id === community?.id) return;
    loadScene(loaded.css, null);
    setCommunity(toCommunity(loaded));
  }, [loaded?.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the URL alone
  useEffect(() => {
    if (!routeKey || routeKey === currentExample || exampleSource === undefined)
      return;
    loadExample(routeKey, exampleSource);
  }, [routeKey]);

  // Typing: the byte-delta badge only means something right after a
  // minify/format, and the player reload waits for a pause.
  function editSource(value: string) {
    setSource(value);
    setSizeDelta(null);
    clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(
      () => setPlayerSource(value),
      TYPING_DEBOUNCE_MS,
    );
  }

  /** Programmatic edit of the current scene (timeline drag). */
  function replaceSource(value: string) {
    commit(value);
    setSizeDelta(null);
  }

  // Picking an example is a navigation, so back/forward and pasted URLs take
  // the same path; re-picking the current URL's example loads it directly.
  function selectExample(key: string) {
    if (!findExample(key)) return;
    track("example_view", { example: key });
    if (key === routeKey && exampleSource !== undefined)
      loadExample(key, exampleSource);
    else void navigate({ to: "/examples/$key", params: { key } });
  }

  function reserialize(
    opts: Parameters<typeof serialize>[1],
    minifiedAfter: boolean,
    verb: string,
  ) {
    try {
      const next = serialize(parse(source), opts);
      setSizeDelta({ before: bytes(source), after: bytes(next) });
      commit(next);
      setMinified(minifiedAfter);
      setError(null);
    } catch (e: any) {
      setError(`Could not ${verb}: ${e.message}`);
    }
  }

  const toggleMinify = () =>
    reserialize({ minify: !minified }, !minified, "format");

  // Destructive: minify AND rename every id/class/@keyframes/@define/custom
  // property to a short meaningless name. The UI confirms before calling this.
  const crush = () => reserialize({ crush: true }, true, "crush");

  function applyImport(
    format: string,
    label: string,
    text: string,
    converted: { css: string; warnings: string[]; blocked: string[] },
  ) {
    const { css, warnings, blocked } = converted;
    loadScene(css, null);
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

  // Converters load on demand, keeping them out of the main chunk.
  async function importLottie(text: string, label: string): Promise<boolean> {
    setError(null);
    let lottie: any;
    try {
      lottie = JSON.parse(text);
    } catch (e: any) {
      setError(`Invalid JSON: ${e.message}`);
      return false;
    }
    try {
      const { convertLottie } = await import("@popkorn/converters");
      applyImport("Lottie", label, text, convertLottie(lottie));
      return true;
    } catch (e: any) {
      setError(`Lottie conversion failed: ${e.message}`);
      return false;
    }
  }

  async function importSvg(text: string, label: string): Promise<boolean> {
    setError(null);
    try {
      const { convertSvg } = await import("@popkorn/converters");
      applyImport("SVG", label, text, convertSvg(text));
      return true;
    } catch (e: any) {
      setError(`SVG conversion failed: ${e.message}`);
      return false;
    }
  }

  // Pasted markup: sniff SVG vs Lottie JSON. Resolves to success so the caller
  // can dismiss the import modal.
  function importText(text: string): Promise<boolean> {
    return SVG_RE.test(text)
      ? importSvg(text, "pasted SVG")
      : importLottie(text, "pasted JSON");
  }

  async function importFile(file: File): Promise<boolean> {
    const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError(`Could not read file: ${file.name}`);
      return false;
    }
    return isSvg
      ? importSvg(text, `"${file.name}"`)
      : importLottie(text, `"${file.name}"`);
  }

  // Copilot-generated scene.
  function applyGenerated(css: string) {
    loadScene(css, null);
    setImportResult(null);
    setError(null);
  }

  return {
    source,
    playerSource,
    error,
    importResult,
    currentExample,
    community,
    minified,
    sizeDelta,
    setError,
    editSource,
    replaceSource,
    selectExample,
    dismissImport: () => setImportResult(null),
    toggleMinify,
    crush,
    importText,
    importFile,
    applyGenerated,
  };
}

function toCommunity(s: {
  id: string;
  title: string;
  author: string | null;
  tags: string[];
  mine: boolean;
}): CommunityScene {
  return {
    id: s.id,
    title: s.title,
    author: s.author,
    tags: s.tags,
    mine: s.mine,
  };
}
