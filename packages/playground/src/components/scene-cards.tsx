import { Link } from "@tanstack/react-router";
import { ScenePreview } from "@/components/scene-preview";

// Masonry via native CSS multi-column: equal widths, cards keep their scene's
// own height. `break-inside-avoid` on the card is what stops a split mid-card.
export const SCENE_GRID = "columns-1 gap-4 sm:columns-2 lg:columns-3";

/** The link and its text server-render; only the preview inside is client-only.
 *  Community scenes open at `/s/$id`, built-in examples at `/examples/$key`. */
export function SceneCard({
  title,
  meta,
  sceneId,
  exampleKey,
  aspect,
}: {
  title: string;
  meta?: string;
  sceneId?: string;
  exampleKey?: string;
  aspect?: number;
}) {
  return (
    <Link
      {...(sceneId
        ? { to: "/s/$id", params: { id: sceneId } }
        : { to: "/examples/$key", params: { key: exampleKey ?? "" } })}
      className="group mb-4 block break-inside-avoid overflow-hidden rounded-xl border border-border bg-card/40 transition-colors hover:border-primary/60 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="w-full bg-background/60">
        <ScenePreview
          sceneId={sceneId}
          exampleKey={exampleKey}
          aspect={aspect}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-border px-3 py-2">
        <span className="truncate text-[13px] group-hover:text-primary">
          {title}
        </span>
        {meta && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {meta}
          </span>
        )}
      </div>
    </Link>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </h2>
  );
}

/** Fixed format, not toLocaleDateString: server and browser disagree on locale
 *  and the mismatch fails hydration. */
export const shortDate = (ms: number) =>
  new Date(ms).toISOString().slice(0, 10);
