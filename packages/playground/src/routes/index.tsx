import { createFileRoute } from "@tanstack/react-router";
import { DEFAULT_EXAMPLE_KEY, loadExampleSource } from "@/examples";
import { SITE } from "@/routes/__root";
import { Playground } from "@/routes/-playground";

export const Route = createFileRoute("/")({
  // The default scene loads up front so the editor's first render has it.
  loader: async () => ({
    key: DEFAULT_EXAMPLE_KEY,
    source: (await loadExampleSource(DEFAULT_EXAMPLE_KEY)) ?? "",
  }),
  head: () => ({ links: [{ rel: "canonical", href: `${SITE}/` }] }),
  component: Playground,
});
