// Docs are the repo's own `docs/*.md`, bundled raw at build time and rendered
// on the server so each section ships real HTML (and real meta tags) to
// crawlers. Rendering lives in `docs-render.ts`.

export const GITHUB_REPO = "https://github.com/ayarse/popkorn";

export const DOCS = [
  {
    key: "introduction",
    label: "Introduction",
    file: "introduction.md",
    group: "Get started",
  },
  {
    key: "getting-started",
    label: "Getting Started",
    file: "getting-started.md",
    group: "Get started",
  },
  {
    key: "prompting",
    label: "Prompting with AI",
    file: "prompting.md",
    group: "Get started",
  },
  {
    key: "coming-from-lottie-and-rive",
    label: "Coming from Lottie or Rive",
    file: "coming-from-lottie-and-rive.md",
    group: "Migrating",
  },
  {
    key: "importing",
    label: "Importing Lottie and SVG",
    file: "importing.md",
    group: "Migrating",
  },
  {
    key: "state-machines",
    label: "State Machines",
    file: "state-machines.md",
    group: "Guides",
  },
  {
    key: "css-art-in-popkorn",
    label: "CSS art → Popkorn",
    file: "css-art-in-popkorn.md",
    group: "Guides",
  },
  {
    key: "player-api",
    label: "Player API",
    file: "player-api.md",
    group: "Guides",
  },
  {
    key: "reference",
    label: "Format Reference",
    file: "reference.md",
    group: "Reference",
  },
  {
    key: "limitations",
    label: "Limitations",
    file: "limitations.md",
    group: "Reference",
  },
  {
    key: "architecture",
    label: "Architecture",
    file: "architecture.md",
    group: "Reference",
  },
] as const;

/** Sidebar sections, in first-appearance order. */
export const DOC_GROUPS = [...new Set(DOCS.map((d) => d.group))].map(
  (group) => ({
    group,
    docs: DOCS.filter((d) => d.group === group),
  }),
);

export function docNeighbors(key: string): { prev?: Doc; next?: Doc } {
  const i = DOCS.findIndex((d) => d.key === key);
  return { prev: DOCS[i - 1], next: DOCS[i + 1] };
}

export type Doc = (typeof DOCS)[number];

const files = import.meta.glob("../../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const diagrams = import.meta.glob("../../../../docs/diagrams/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Raw SVG for a docs-relative `diagrams/*.svg` path, if it exists. */
export function docDiagram(href: string): string | undefined {
  const name = href.replace(/^\.\//, "");
  const path = Object.keys(diagrams).find((p) => p.endsWith(`/docs/${name}`));
  return path ? diagrams[path] : undefined;
}

export function findDoc(section: string | undefined): Doc {
  return DOCS.find((d) => d.key === section) ?? DOCS[0];
}

export function docSource(file: string): string {
  const path = Object.keys(files).find((p) => p.endsWith(`/${file}`));
  return path ? files[path] : `# ${file}\n\nSource file not found.`;
}

/** First prose paragraph, flattened to plain text — used as the meta description. */
export function docDescription(file: string): string {
  const body = docSource(file);
  const para = body
    .split("\n\n")
    .map((b) => b.trim())
    .find((b) => b && !b.startsWith("#") && !b.startsWith("```"));
  if (!para) return "";
  const text = para
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}
