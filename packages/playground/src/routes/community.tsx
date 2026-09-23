import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Send, X } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Masonry, SceneCard, shortDate } from "@/components/scene-cards";
import { ShareModal } from "@/components/share-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { exampleIndex } from "@/examples";
import {
  listExampleAspects,
  listScenes,
  type SceneSummary,
} from "@/lib/scenes";
import { SITE } from "@/routes/__root";

const TITLE = "Community | Popkorn";
const DESCRIPTION =
  "Popkorn scenes published by the community, plus the built-in examples. Every one is a plain CSS file. Open it in the playground and make it yours.";

export const Route = createFileRoute("/community")({
  loader: async () => {
    const [scenes, exampleAspects] = await Promise.all([
      listScenes(),
      listExampleAspects(),
    ]);
    return { scenes, exampleAspects };
  },
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

// Tag chips shown before "more"; the search box also matches tag names.
const TAG_LIMIT = 12;

type Example = (typeof exampleIndex)[number];

const sceneAspectOf = (s: SceneSummary) => s.aspect;

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search scenes, authors, tags"
        aria-label="Search scenes, authors, tags"
        className="h-8 py-1.5 pl-8 pr-7"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
        >
          <X />
        </Button>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Community() {
  const { scenes, exampleAspects } = Route.useLoaderData();
  const [tab, setTab] = useState<"community" | "examples">(
    scenes.length > 0 ? "community" : "examples",
  );
  const [showShare, setShowShare] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [allTags, setAllTags] = useState(false);

  // Most-used first.
  const counts = new Map<string, number>();
  for (const s of scenes)
    for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const shownTags = allTags ? tags : tags.slice(0, TAG_LIMIT);

  // One tag filters at a time; free text matches title, author or tag.
  const q = query.trim().toLowerCase();
  const visibleScenes = scenes.filter(
    (s: SceneSummary) =>
      (!selected || s.tags.includes(selected)) &&
      (!q ||
        s.title.toLowerCase().includes(q) ||
        s.author?.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q))),
  );
  const visibleExamples = exampleIndex.filter(
    (ex) => !q || ex.label.toLowerCase().includes(q),
  );
  const exampleAspectOf = (ex: Example) => exampleAspects[ex.key];

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
          className="ml-auto"
          onClick={() => setShowShare(true)}
        >
          <Send />
          Publish an animation
        </Button>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-8">
          <h1 className="text-2xl font-semibold tracking-tight">Community</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {DESCRIPTION}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ToggleGroup
              type="single"
              value={tab}
              onValueChange={(v) => v && setTab(v as typeof tab)}
              aria-label="Gallery"
            >
              <ToggleGroupItem value="community" className="gap-1.5 px-3">
                Community
                <span className="tabular-nums opacity-60">{scenes.length}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="examples" className="gap-1.5 px-3">
                Examples
                <span className="tabular-nums opacity-60">
                  {exampleIndex.length}
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
            <SearchInput value={query} onChange={setQuery} />
          </div>

          {tab === "community" && tags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {shownTags.map(([tag, count]) => (
                <Button
                  key={tag}
                  variant="outline"
                  size="sm"
                  aria-pressed={selected === tag}
                  onClick={() =>
                    setSelected((prev) => (prev === tag ? null : tag))
                  }
                  className="h-6 rounded-full px-2.5 text-[12px] font-normal text-muted-foreground"
                >
                  {tag}
                  <span className="tabular-nums opacity-60">{count}</span>
                </Button>
              ))}
              {tags.length > TAG_LIMIT && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAllTags((v) => !v)}
                  className="h-6 px-2 text-[12px] font-normal"
                >
                  {allTags ? "Fewer" : `+${tags.length - TAG_LIMIT} more`}
                </Button>
              )}
            </div>
          )}

          <div className="mt-6">
            {tab === "community" ? (
              scenes.length === 0 ? (
                <Empty>
                  Nothing published yet.{" "}
                  <Link to="/" className="text-foreground underline">
                    Make the first one
                  </Link>
                  .
                </Empty>
              ) : visibleScenes.length === 0 ? (
                <Empty>No scenes match that.</Empty>
              ) : (
                <Masonry items={visibleScenes} aspect={sceneAspectOf}>
                  {(s) => (
                    <SceneCard
                      key={s.id}
                      title={s.title}
                      meta={s.author ?? shortDate(s.created_at)}
                      sceneId={s.id}
                      aspect={s.aspect}
                    />
                  )}
                </Masonry>
              )
            ) : visibleExamples.length === 0 ? (
              <Empty>No examples match that.</Empty>
            ) : (
              <Masonry items={visibleExamples} aspect={exampleAspectOf}>
                {(ex) => (
                  // Examples open straight in the editor, not on a share page.
                  <SceneCard
                    key={ex.key}
                    title={ex.label}
                    exampleKey={ex.key}
                    aspect={exampleAspects[ex.key]}
                  />
                )}
              </Masonry>
            )}
          </div>
        </div>
      </main>

      {/* No editor on this page, so the modal takes pasted CSS. */}
      {showShare && <ShareModal onClose={() => setShowShare(false)} />}
    </div>
  );
}
