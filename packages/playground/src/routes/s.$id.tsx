import {
  ClientOnly,
  createFileRoute,
  Link,
  notFound,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { getScene } from "@/lib/scenes";
import { SITE } from "@/routes/__root";

// Pulls in <popkorn-player>, which extends HTMLElement at module scope — keep
// it off the server entirely.
const SceneView = lazy(() =>
  import("@/pages/scene-view").then((m) => ({ default: m.SceneView })),
);

export const Route = createFileRoute("/s/$id")({
  loader: async ({ params }) => {
    const scene = await getScene({ data: params.id });
    if (!scene) throw notFound();
    return scene;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const title = `${loaderData.title} — Popkorn`;
    const description = `A Popkorn scene, shared from the playground. Play it in your browser, or fork the CSS.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: `${SITE}/s/${loaderData.id}` },
      ],
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
  component: SharedScene,
});

function SharedScene() {
  const scene = Route.useLoaderData();
  // The player is a custom element — the surrounding page SSRs, the canvas doesn't.
  return (
    <ClientOnly fallback={null}>
      <Suspense fallback={null}>
        <SceneView id={scene.id} title={scene.title} css={scene.css} />
      </Suspense>
    </ClientOnly>
  );
}
