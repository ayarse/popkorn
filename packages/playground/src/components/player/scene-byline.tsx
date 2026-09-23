import { useParams } from "@tanstack/react-router";
import { findExample } from "@/examples";
import type { CommunityScene } from "@/hooks/use-scene";
import { parseSceneMeta } from "@/lib/scene-meta";

/** Title, author and tags of the open scene, always visible in the toolbar.
 *  Community scenes use their stored fields; examples their label and the
 *  source's `Author:` header. */
export function SceneByline({
  community,
  source,
}: {
  community: CommunityScene | null;
  source: string;
}) {
  const key = useParams({ strict: false }).key;
  const meta = parseSceneMeta(source);
  const title = community?.title ?? findExample(key)?.label;
  const author = community ? community.author : meta.Author;
  const authorUrl = community ? undefined : meta["Author URL"];
  const tags = community?.tags ?? [];
  // "AI Generated" is a credit, not a name: no "by" in front of it.
  const aiCredit = author?.match(/^AI Generated\b(.*)$/i);
  if (!title && !author) return null;

  return (
    <div className="flex min-w-0 items-baseline gap-2 px-1 text-[13px]">
      {title && (
        <span className="truncate font-medium text-foreground">{title}</span>
      )}
      {author && (
        <span className="shrink-0 truncate text-muted-foreground">
          {aiCredit ? "AI-generated" : "by "}
          {aiCredit ? (
            aiCredit[1]
          ) : authorUrl ? (
            <a
              href={authorUrl}
              target="_blank"
              rel="noreferrer"
              className="text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground"
            >
              {author}
            </a>
          ) : (
            author
          )}
        </span>
      )}
      {tags.length > 0 && (
        <span className="hidden shrink-0 gap-1 md:flex">
          {tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="rounded-full border border-border px-1.5 text-[11px] text-muted-foreground"
            >
              #{t}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
