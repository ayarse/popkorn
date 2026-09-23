import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getScene } from "@/lib/scenes";
import { SITE } from "@/routes/__root";
import { Playground } from "@/routes/-playground";

export const Route = createFileRoute("/s/$id")({
  // The scene feeds both the server-rendered head and the editor (useScene).
  loader: async ({ params }) => {
    const scene = await getScene({ data: params.id });
    if (!scene) throw notFound();
    return scene;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const by = loaderData.author ? ` by ${loaderData.author}` : "";
    const title = `${loaderData.title} — Popkorn`;
    const description = `${loaderData.title}${by}, a Popkorn scene. Play it in your browser and read the CSS that draws it.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: `${SITE}/s/${loaderData.id}` },
      ],
      links: [{ rel: "canonical", href: `${SITE}/s/${loaderData.id}` }],
    };
  },
  notFoundComponent: () => (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">
      <p>
        That scene isn't here.{" "}
        <Link to="/" className="text-primary underline">
          Back to the playground
        </Link>
      </p>
    </div>
  ),
  component: Playground,
});
