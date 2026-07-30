// Docs are the repo's own `docs/*.md`, bundled raw at build time and rendered
// on the server so each section ships real HTML (and real meta tags) to
// crawlers. The client only re-highlights code blocks.

export const DOCS = [
  { key: "introduction", label: "Introduction", file: "introduction.md" },
  {
    key: "getting-started",
    label: "Getting Started",
    file: "getting-started.md",
  },
  { key: "prompting", label: "Prompting with AI", file: "prompting.md" },
  { key: "importing", label: "Importing Lottie and SVG", file: "importing.md" },
  { key: "state-machines", label: "State Machines", file: "state-machines.md" },
  {
    key: "css-art-in-popkorn",
    label: "CSS art → Popkorn",
    file: "css-art-in-popkorn.md",
  },
  { key: "player-api", label: "Player API", file: "player-api.md" },
  { key: "reference", label: "Reference", file: "reference.md" },
  { key: "architecture", label: "Architecture", file: "architecture.md" },
] as const;

export type Doc = (typeof DOCS)[number];

const files = import.meta.glob("../../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

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
