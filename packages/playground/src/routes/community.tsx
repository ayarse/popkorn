import { createFileRoute, Link } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import {
  SCENE_GRID,
  SceneCard,
  SectionHeading,
  shortDate,
} from "@/components/scene-cards";
import { ShareModal } from "@/components/share-modal";
import { Button } from "@/components/ui/button";
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
  const [showAll, setShowAll] = useState(false);
  const [showShare, setShowShare] = useState(false);

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
        <Button
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => setShowShare(true)}
        >
          <Send className="size-3.5" />
          Publish an animation
        </Button>
      </header>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
          <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
            {DESCRIPTION}
          </p>

          <SectionHeading>Community submissions</SectionHeading>
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
                  meta={s.author ?? shortDate(s.created_at)}
                  sceneId={s.id}
                  aspect={s.aspect}
                />
              ))}
            </div>
          )}

          <div className="mt-10">
            <SectionHeading>Official examples</SectionHeading>
            {/* Community submissions are the point of this page, so the examples
                stay clamped to about two and a half rows until asked for. */}
            <div className="relative">
              <div
                className={`${SCENE_GRID} ${showAll ? "" : "max-h-[580px] overflow-hidden"}`}
              >
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
              {!showAll && (
                <div className="absolute inset-x-0 bottom-0 flex h-40 items-end justify-center bg-gradient-to-t from-background via-background/80 to-transparent">
                  <Button size="lg" onClick={() => setShowAll(true)}>
                    Show all official examples
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* No editor on this page, so the modal takes pasted CSS. */}
      {showShare && <ShareModal onClose={() => setShowShare(false)} />}
    </div>
  );
}
