// Curated example gallery for the Popkorn demo.
// Source of truth is examples/popkorn/*.css — each file IS a scene.
// Filename convention: `NN-kebab-name.css` where NN sets gallery order and the
// name (prefix stripped, dashes -> spaces, sentence-cased) becomes the label.
// A `--` separates a feature family from the scene's own name and renders as
// ": " (`12-state-machine--pip.css` -> "State machine: Pip"), keeping sibling
// scenes visibly grouped. Add or edit a scene by touching that folder; no code
// change needed here.

export interface Example {
  key: string;
  label: string;
  source: string;
}

const files = import.meta.glob("../../../examples/popkorn/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const examples: Example[] = Object.keys(files)
  .sort()
  .map((path) => {
    const name = path
      .split("/")
      .pop()!
      .replace(/\.css$/, "")
      .replace(/^\d+-/, "");
    const label = name
      .split("--")
      .map((part) =>
        part.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      )
      .join(": ");
    // Root-absolute asset URLs in scenes resolve against the deploy base
    // (GitHub Pages serves the app under /popkorn/, dev under /).
    const source = files[path]
      .split("url('/")
      .join(`url('${import.meta.env.BASE_URL}`);
    return { key: name, label, source };
  });
