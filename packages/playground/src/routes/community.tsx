import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand-mark";
import {
  SCENE_GRID,
  SceneCard,
  SectionHeading,
  shortDate,
} from "@/components/scene-cards";
import { examples } from "@/examples";
import { listScenes, type SceneSummary } from "@/lib/scenes";
import { SITE } from "@/routes/__root";

const TITLE = "Community — Popkorn";
const DESCRIPTION =
  "Popkorn scenes published by the community, plus the built-in examples. Every one is a plain CSS file — open it in the playground and make it yours.";

export const Route = createFileRoute("/community")({
  loader: () => listScenes(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: `${SITE}/community` },
    ],
  }),
  component: Community,
});

function Community() {
  const scenes = Route.useLoaderData();

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <BrandMark
          suffix={
            <span className="text-[15px] text-muted-foreground/70">
              / Community
            </span>
          }
        />
      </header>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
          <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
            {DESCRIPTION}
          </p>

          <SectionHeading>Published scenes</SectionHeading>
          {scenes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing published yet.{" "}
              <Link to="/" className="text-primary underline">
                Make the first one
              </Link>
              .
            </p>
          ) : (
            <div className={SCENE_GRID}>
              {scenes.map((s: SceneSummary) => (
                <SceneCard
                  key={s.id}
                  href={`/s/${s.id}`}
                  title={s.title}
                  meta={shortDate(s.created_at)}
                  sceneId={s.id}
                />
              ))}
            </div>
          )}

          <div className="mt-10">
            <SectionHeading>Official examples</SectionHeading>
            <div className={SCENE_GRID}>
              {examples.map((ex) => (
                // Examples open straight in the editor, not on a share page.
                <SceneCard
                  key={ex.key}
                  href={`/examples/${ex.key}`}
                  title={ex.label}
                  source={ex.source}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
