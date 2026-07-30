import { createFileRoute, notFound } from "@tanstack/react-router";
import { examples } from "@/examples";
import { SITE } from "@/routes/__root";
import { Playground } from "@/routes/-playground";

/**
 * An example, deep-linked. The editor itself is client-only, so all the server
 * renders here is the per-example head — which is the point: one crawlable URL
 * per scene instead of a `#key` fragment nothing indexes.
 */
export const Route = createFileRoute("/examples/$key")({
  loader: ({ params }) => {
    const ex = examples.find((e) => e.key === params.key);
    if (!ex) throw notFound();
    return { label: ex.label };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {};
    const title = `${loaderData.label} — Popkorn`;
    const description = `${loaderData.label}, a hand-authored Popkorn scene. Open it in the playground to read and edit its CSS.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: `${SITE}/examples/${params.key}` },
      ],
      links: [{ rel: "canonical", href: `${SITE}/examples/${params.key}` }],
    };
  },
  component: Playground,
});
