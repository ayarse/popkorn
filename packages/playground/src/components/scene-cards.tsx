import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { ScenePreview } from "@/components/scene-preview";

// Widest first; below the last query the grid is one column.
const COLUMN_QUERIES = [
  ["(min-width: 1280px)", 4],
  ["(min-width: 1024px)", 3],
  ["(min-width: 640px)", 2],
] as const;

function subscribeColumns(cb: () => void) {
  const mqls = COLUMN_QUERIES.map(([q]) => window.matchMedia(q));
  for (const m of mqls) m.addEventListener("change", cb);
  return () => {
    for (const m of mqls) m.removeEventListener("change", cb);
  };
}

function useColumnCount() {
  return useSyncExternalStore(
    subscribeColumns,
    () => COLUMN_QUERIES.find(([q]) => window.matchMedia(q).matches)?.[1] ?? 1,
    () => 3,
  );
}

// Caption height as a fraction of card width, for balancing columns.
const CAPTION = 0.14;

/**
 * Masonry in reading order: each card goes to the currently shortest column,
 * so the newest scenes fill the first row, not the first column. Heights come
 * from the scenes' known aspect ratios, so no measuring is needed.
 */
export function Masonry<T>({
  items,
  aspect,
  children,
}: {
  items: T[];
  aspect: (item: T) => number | undefined;
  children: (item: T) => ReactNode;
}) {
  const n = useColumnCount();
  const columns = useMemo(() => {
    const cols: T[][] = Array.from({ length: n }, () => []);
    const heights = new Array<number>(n).fill(0);
    for (const item of items) {
      const i = heights.indexOf(Math.min(...heights));
      cols[i].push(item);
      heights[i] += 1 / (aspect(item) || 4 / 3) + CAPTION;
    }
    return cols;
  }, [items, n, aspect]);

  return (
    <div className="flex items-start gap-4">
      {columns.map((col, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-4">
          {col.map(children)}
        </div>
      ))}
    </div>
  );
}

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
      className="group block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="w-full bg-background/60">
        <ScenePreview
          sceneId={sceneId}
          exampleKey={exampleKey}
          aspect={aspect}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
        <span className="truncate text-[13px] font-medium text-foreground/90 group-hover:text-foreground">
          {title}
        </span>
        {meta && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {meta}
          </span>
        )}
      </div>
    </Link>
  );
}

/** Fixed format, not toLocaleDateString: server and browser disagree on locale
 *  and the mismatch fails hydration. */
export const shortDate = (ms: number) =>
  new Date(ms).toISOString().slice(0, 10);
