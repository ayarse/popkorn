import { useNavigate } from "@tanstack/react-router";
import Prism from "prismjs";
import { useEffect, useMemo, useRef, useState } from "react";
import "prismjs/themes/prism-tomorrow.css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-css";
import { ArrowLeft, BookOpen, ListTree } from "lucide-react";
import { marked } from "marked";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DOCS = [
  { key: "CONCEPT", label: "Concept", file: "CONCEPT.md" },
  { key: "DSL", label: "DSL Reference", file: "DSL.md" },
  { key: "STATE-MACHINES", label: "State Machines", file: "STATE-MACHINES.md" },
  { key: "ARCHITECTURE", label: "Architecture", file: "ARCHITECTURE.md" },
] as const;

const files = import.meta.glob("../../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function docSource(file: string): string {
  const path = Object.keys(files).find((p) => p.endsWith(`/${file}`));
  return path ? files[path] : `# ${file}\n\n.Source file not found.`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

type TocItem = { id: string; text: string; indent: number };

marked.use({ gfm: true, breaks: false });

export default function Docs() {
  const navigate = useNavigate();
  const [active, setActive] = useState<(typeof DOCS)[number]["key"]>("CONCEPT");
  const activeDoc = DOCS.find((d) => d.key === active)!;
  const html = useMemo(
    () => marked.parse(docSource(activeDoc.file)) as string,
    [activeDoc.file],
  );
  const scrollRef = useRef<HTMLElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Assign stable ids to headings + build the on-this-page outline. Heading
  // levels vary per doc (DSL uses h3, others h2), so indentation is relative
  // to the shallowest collected level.
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

  // Scroll the content to top when switching sections.
  // biome-ignore lint/correctness/useExhaustiveDependencies: active is the re-run trigger — scroll to top on section switch
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [active]);

  // Highlight code blocks.
  // biome-ignore lint/correctness/useExhaustiveDependencies: html is the re-run trigger — re-highlight after content renders
  useEffect(() => {
    if (scrollRef.current) Prism.highlightAllUnder(scrollRef.current);
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
  }, [toc]);

  function scrollToHeading(id: string) {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    setActiveId(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header — mirrors the playground shell */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <BrandMark
          suffix={
            <span className="text-[15px] text-muted-foreground/70">/ Docs</span>
          }
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate({ to: "/" })}
          >
            <ArrowLeft className="size-3.5" />
            Playground
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Primary section nav */}
        <aside className="w-56 shrink-0 overflow-auto border-r border-border bg-card/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <BookOpen className="size-3.5" />
            Documentation
          </div>
          <nav className="space-y-0.5">
            {DOCS.map((d) => (
              <button
                type="button"
                key={d.key}
                onClick={() => setActive(d.key)}
                className={cn(
                  "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
                  active === d.key
                    ? "bg-secondary/70 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                )}
              >
                {d.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Rendered markdown */}
        <main ref={scrollRef} className="flex-1 overflow-auto">
          <div className="mx-auto max-w-3xl px-8 py-8">
            <div
              ref={proseRef}
              className="docs-prose"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional render of trusted bundled docs markdown
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </main>

        {/* Secondary on-this-page nav */}
        {toc.length > 0 && (
          <aside className="hidden w-60 shrink-0 overflow-auto border-l border-border bg-card/20 p-3 lg:block">
            <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <ListTree className="size-3.5" />
              On this page
            </div>
            <nav className="space-y-0.5 border-l border-border/60">
              {toc.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => scrollToHeading(t.id)}
                  className={cn(
                    "block w-full truncate border-l-2 py-1 pr-2 text-left text-[12.5px] leading-5 transition-colors",
                    activeId === t.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  style={{ paddingLeft: `${0.75 + t.indent * 0.75}rem` }}
                  title={t.text}
                >
                  {t.text}
                </button>
              ))}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
