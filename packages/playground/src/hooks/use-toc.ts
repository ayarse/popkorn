import { type RefObject, useEffect, useState } from "react";
import type { TocItem } from "@/lib/docs-render";

// Scrollspy over a server-built outline: the current section is the last
// heading sitting at or above the top of the scroll viewport.
export function useToc(
  scrollRef: RefObject<HTMLElement | null>,
  toc: TocItem[],
) {
  const [activeId, setActiveId] = useState<string | null>(toc[0]?.id ?? null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || toc.length === 0) return;
    const heads = toc
      .map((t) => root.querySelector<HTMLElement>(`#${CSS.escape(t.id)}`))
      .filter((h) => h !== null);
    let raf = 0;
    const update = () => {
      raf = 0;
      const rootTop = root.getBoundingClientRect().top;
      const offset = 80;
      let current = heads[0]?.id ?? null;
      for (const h of heads) {
        if (h.getBoundingClientRect().top - rootTop <= offset) current = h.id;
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
  }, [toc, scrollRef]);

  function scrollToHeading(id: string) {
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(id)}`,
    );
    setActiveId(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return { activeId, scrollToHeading };
}
