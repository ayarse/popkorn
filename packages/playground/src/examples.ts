// Curated example gallery for the Popkorn demo.
// Source of truth is examples/popkorn/*.css — each file IS a scene.
// Filename convention: `NN-kebab-name.css` where NN sets gallery order and the
// name (prefix stripped, dashes -> spaces, sentence-cased) becomes the label.
// A `--` separates a feature family from the scene's own name and renders as
// ": " (`12-state-machine--pip.css` -> "State machine: Pip"), keeping sibling
// scenes visibly grouped. Add or edit a scene by touching that folder; no code
// change needed here.

export interface ExampleMeta {
  key: string;
  label: string;
}

export interface Example extends ExampleMeta {
  source: string;
}

// Lazy: the key/label manifest is free, each source is its own chunk.
const files = import.meta.glob<string>("../../../examples/popkorn/*.css", {
  query: "?raw",
  import: "default",
});

const pathByKey = new Map<string, string>();

/** Every example's key and label, in gallery order. No sources. */
export const exampleIndex: ExampleMeta[] = Object.keys(files)
  .sort()
  .map((path) => {
    const key = path
      .split("/")
      .pop()!
      .replace(/\.css$/, "")
      .replace(/^\d+-/, "");
    pathByKey.set(key, path);
    const label = key
      .split("--")
      .map((part) =>
        part.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      )
      .join(": ");
    return { key, label };
  });

/** Scene shown at `/`. */
export const DEFAULT_EXAMPLE_KEY = "trim-path";

export function findExample(key: string | undefined): ExampleMeta | undefined {
  return exampleIndex.find((e) => e.key === key);
}

/** One example's CSS, or undefined for an unknown key. */
export function loadExampleSource(key: string): Promise<string | undefined> {
  const path = pathByKey.get(key);
  return path ? files[path]() : Promise.resolve(undefined);
}

let all: Promise<Example[]> | undefined;

/** Every example with its source, loaded once. */
export function loadExamples(): Promise<Example[]> {
  all ??= Promise.all(
    exampleIndex.map(async (e) => ({
      ...e,
      source: (await loadExampleSource(e.key)) ?? "",
    })),
  );
  return all;
}
