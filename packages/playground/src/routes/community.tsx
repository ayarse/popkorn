import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
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

/** Search box shared by the scene list and the sidebar's tag filter. */
function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-7 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Community() {
  const scenes = Route.useLoaderData();
  const [showAll, setShowAll] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [query, setQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  // Tag facet, most-used first — the sidebar's own search is what makes a long
  // tail navigable, so the list isn't truncated.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of scenes)
      for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [scenes]);

  const shownTags = tagCounts.filter(([t]) =>
    t.includes(tagQuery.trim().toLowerCase()),
  );

  // One tag filters at a time; free text matches title, author or tag.
  const q = query.trim().toLowerCase();
  const visible = scenes.filter(
    (s: SceneSummary) =>
      (!selected || s.tags.includes(selected)) &&
      (!q ||
        s.title.toLowerCase().includes(q) ||
        s.author?.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q))),
  );
  const filtering = Boolean(q) || selected !== null;

  const toggleTag = (tag: string) =>
    setSelected((prev) => (prev === tag ? null : tag));

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
      <main className="flex min-h-0 flex-1">
        {/* Tags are desktop-only furniture; the search box covers them on
            mobile, since it matches tag names too. */}
        <aside className="hidden w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-4 md:flex">
          <SearchInput
            value={tagQuery}
            onChange={setTagQuery}
            placeholder="Search tags"
          />
          {selected && (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="self-start text-xs text-muted-foreground hover:text-foreground"
            >
              Clear filter
            </button>
          )}
          <div className="flex flex-col gap-0.5">
            {shownTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {tagCounts.length === 0 ? "No tags yet." : "No matching tags."}
              </p>
            ) : (
              shownTags.map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm ${
                    selected === tag
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="truncate">{tag}</span>
                  <span className="shrink-0 text-[11px] tabular-nums opacity-60">
                    {count}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
            <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
              {DESCRIPTION}
            </p>

            <div className="mb-8 max-w-sm">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search scenes, authors, tags"
              />
            </div>

            <SectionHeading>Community submissions</SectionHeading>
            {scenes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing published yet.{" "}
                <Link to="/" className="text-primary underline">
                  Make the first one
                </Link>
                .
              </p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No scenes match that.
              </p>
            ) : (
              <div className={SCENE_GRID}>
                {visible.map((s: SceneSummary) => (
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

            {/* Examples are noise while you're looking for something specific. */}
            <div className={`mt-10 ${filtering ? "hidden" : ""}`}>
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
        </div>
      </main>

      {/* No editor on this page, so the modal takes pasted CSS. */}
      {showShare && <ShareModal onClose={() => setShowShare(false)} />}
    </div>
  );
}
