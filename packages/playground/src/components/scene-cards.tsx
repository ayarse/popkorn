import { ScenePreview } from "@/components/scene-preview";

// Masonry via native CSS multi-column: equal widths, cards keep their scene's
// own height. `break-inside-avoid` on the card is what stops a split mid-card.
export const SCENE_GRID = "columns-1 gap-4 sm:columns-2 lg:columns-3";

/** The anchor and its text server-render; only the preview inside is client-only. */
export function SceneCard({
  href,
  title,
  meta,
  source,
  sceneId,
  aspect,
}: {
  href: string;
  title: string;
  meta?: string;
  source?: string;
  sceneId?: string;
  aspect?: number;
}) {
  return (
    <a
      href={href}
      className="group mb-4 block break-inside-avoid overflow-hidden rounded-xl border border-border bg-card/40 transition-colors hover:border-primary/60"
    >
      <div className="w-full bg-background/60">
        <ScenePreview source={source} sceneId={sceneId} aspect={aspect} />
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
    </a>
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
