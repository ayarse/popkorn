// Docs section list and metadata. The markdown itself is only bundled on the
// server (`docs-render.ts`); the client receives rendered segments.

export const GITHUB_REPO = "https://github.com/ayarse/popkorn";

export const DOCS = [
  {
    key: "introduction",
    label: "Introduction",
    file: "introduction.md",
    group: "Get started",
    description:
      "Popkorn is a format and a runtime for motion graphics: a text file written in a close dialect of CSS, and a small player that draws it on web and native mobile.",
  },
  {
    key: "getting-started",
    label: "Getting Started",
    file: "getting-started.md",
    group: "Get started",
    description:
      "The fastest way to get a feel for Popkorn is the playground. When you're ready to put a scene in your own project, it's one web component.",
  },
  {
    key: "prompting",
    label: "Prompting with AI",
    file: "prompting.md",
    group: "Get started",
    description:
      "Popkorn scenes are written in a close dialect of CSS, and language models have read a great deal of CSS. How to have a model write and edit Popkorn scenes.",
  },
  {
    key: "coming-from-lottie-and-rive",
    label: "Coming from Lottie or Rive",
    file: "coming-from-lottie-and-rive.md",
    group: "Migrating",
    description:
      "Lottie, Rive and Popkorn all make an animation once and play it the same way everywhere. The main difference is the file, and what that means for you.",
  },
  {
    key: "importing",
    label: "Importing Lottie and SVG",
    file: "importing.md",
    group: "Migrating",
    description:
      "You don't have to start from a blank file. Popkorn can read existing Lottie animations and SVG artwork and turn them into scenes you can read and edit.",
  },
  {
    key: "state-machines",
    label: "State Machines",
    file: "state-machines.md",
    group: "Guides",
    description:
      "Interactions that need memory: a switch that stays on, an intro that settles into an idle loop, a long-press. Named states and transitions, declared in the scene.",
  },
  {
    key: "css-art-in-popkorn",
    label: "CSS art → Popkorn",
    file: "css-art-in-popkorn.md",
    group: "Guides",
    description:
      "Porting single-div CSS art (pseudo-elements, gradient stacks, box-shadow copies, border tricks) to Popkorn, where every shape is a real shape.",
  },
  {
    key: "player-api",
    label: "Player API",
    file: "player-api.md",
    group: "Guides",
    description:
      "Rendering a Popkorn scene in your own project: the <popkorn-player> web component, its lower-level API, and the React Native component.",
  },
  {
    key: "reference",
    label: "Format Reference",
    file: "reference.md",
    group: "Reference",
    description:
      "The complete reference for the Popkorn format: canvas, selectors, shapes, text, transforms, gradients, masks, filters, animations and motion paths.",
  },
  {
    key: "limitations",
    label: "Limitations",
    file: "limitations.md",
    group: "Reference",
    description:
      "Popkorn is a close CSS dialect, scoped on purpose to motion graphics. What it deliberately leaves out, and why.",
  },
  {
    key: "architecture",
    label: "Architecture",
    file: "architecture.md",
    group: "Reference",
    description:
      "How the Popkorn pipeline fits together: parser, scene graph, animation, render loop and the Canvas2D, SVG and Skia backends.",
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

export function findDoc(section: string | undefined): Doc {
  return DOCS.find((d) => d.key === section) ?? DOCS[0];
}
