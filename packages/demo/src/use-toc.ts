import { type RefObject, useEffect, useState } from "react";

export type TocItem = { id: string; text: string; indent: number };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// Builds the on-this-page outline from rendered markdown and tracks which
// heading is currently in view (scrollspy). `html` is the re-run trigger:
// whenever the rendered doc changes, headings get fresh ids and the outline is
// rebuilt. Shares the caller's refs — `prose` holds the rendered markdown,
// `scroll` is the scroll viewport.
export function useToc(
  proseRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  html: string,
) {
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Assign stable ids to headings + build the outline. Heading levels vary per
  // doc (DSL uses h3, others h2), so indentation is relative to the shallowest
  // collected level.
  // biome-ignore lint/correctness/useExhaustiveDependencies: html is the re-run trigger — the effect reads the DOM rendered from it
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) return;
    const heads = Array.from(
      prose.querySelectorAll<HTMLHeadingElement>("h2, h3, h4"),
    );
    const counts = new Map<string, number>();
    let minLevel = Infinity;
    const items: TocItem[] = [];
    for (const h of heads) {
      minLevel = Math.min(minLevel, Number(h.tagName.slice(1)));
    }
    heads.forEach((h, i) => {
      const base = slugify(h.textContent || "") || `heading-${i}`;
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      h.id = id;
      const level = Number(h.tagName.slice(1));
      items.push({
        id,
        text: h.textContent || "",
        indent: Math.max(0, level - minLevel),
      });
    });
    setToc(items);
    setActiveId(items[0]?.id ?? null);
  }, [html]);

  // Scrollspy: the current section is the last heading sitting at or above the
  // top of the scroll viewport.
  useEffect(() => {
    const root = scrollRef.current;
    const prose = proseRef.current;
    if (!root || !prose || toc.length === 0) return;
    const heads = Array.from(
      prose.querySelectorAll<HTMLHeadingElement>("h2, h3, h4"),
    );
    let raf = 0;
    const update = () => {
      raf = 0;
      const rootTop = root.getBoundingClientRect().top;
      const offset = 80;
      let current = heads[0]?.id ?? null;
      for (const h of heads) {
        const top = h.getBoundingClientRect().top - rootTop;
        if (top <= offset) current = h.id;
        else break;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [toc, proseRef, scrollRef]);

  function scrollToHeading(id: string) {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    setActiveId(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return { toc, activeId, scrollToHeading };
}
