import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  SCENE_GRID,
  SceneCard,
  SectionHeading,
  shortDate,
} from "@/components/scene-cards";
import { buttonVariants } from "@/components/ui/button";
import { examples } from "@/examples";
import { listScenes, type SceneSummary } from "@/lib/scenes";
import { SITE } from "@/routes/__root";

const DESCRIPTION =
  "What the community has published, plus the built-in examples. Every scene is hand-authorable CSS you can open and fork.";

/** Just a teaser here; /community is where the whole feed lives. */
const TEASER = 6;

export const Route = createFileRoute("/gallery")({
  loader: () => listScenes({ data: TEASER }),
  head: () => ({
    meta: [
      { title: "Gallery — Popkorn" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Gallery — Popkorn" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: `${SITE}/gallery` },
    ],
  }),
  component: Gallery,
});

function Gallery() {
  const scenes = Route.useLoaderData();

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <BrandMark
          suffix={
            <span className="text-[15px] text-muted-foreground/70">
              / Gallery
            </span>
          }
        />
      </header>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
          <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
            {DESCRIPTION}
          </p>

          <SectionHeading>From the community</SectionHeading>
          {scenes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing shared yet.{" "}
              <Link to="/" className="text-primary underline">
                Make the first one
              </Link>
              .
            </p>
          ) : (
            <>
              <div className={`${SCENE_GRID} mb-4`}>
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
              <Link
                to="/community"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                More from the community
                <ArrowRight className="size-3.5" />
              </Link>
            </>
          )}

          <div className="mt-10">
            <SectionHeading>Examples</SectionHeading>
            <div className={SCENE_GRID}>
              {examples.map((ex) => (
                // Examples open straight in the editor, not on a share page.
                <SceneCard
                  key={ex.key}
                  href={`/examples/${ex.key}`}
                  title={ex.label}
                  meta="Built-in"
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
