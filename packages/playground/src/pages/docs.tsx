import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Menu,
  Pencil,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { DocsSceneBlock } from "@/components/docs-scene-block";
import { Button } from "@/components/ui/button";
import { useToc } from "@/hooks/use-toc";
import { DOC_GROUPS, docNeighbors, findDoc, GITHUB_REPO } from "@/lib/docs";
import { renderDoc } from "@/lib/docs-render";
import { cn } from "@/lib/utils";

export default function Docs() {
  const navigate = useNavigate();
  const { section } = useParams({ strict: false });
  const activeDoc = findDoc(section);
  const active = activeDoc.key;
  const segments = useMemo(() => renderDoc(activeDoc.file), [activeDoc.file]);
  const { prev, next } = docNeighbors(active);
  const [navOpen, setNavOpen] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const { toc, activeId, scrollToHeading } = useToc(
    proseRef,
    scrollRef,
    activeDoc.file,
  );

  // Scroll the content to top when switching sections.
  // biome-ignore lint/correctness/useExhaustiveDependencies: active is the re-run trigger — scroll to top on section switch
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [active]);

  // Delegated clicks inside rendered markdown: copy buttons, and client-side
  // navigation for links into other docs pages.
  function onProseClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>("[data-copy]");
    if (copy) {
      const block = copy.closest(".code-block");
      const text =
        block?.querySelector("textarea")?.value ??
        block?.querySelector("code")?.textContent ??
        "";
      void navigator.clipboard.writeText(text).then(() => {
        copy.textContent = "Copied";
        setTimeout(() => {
          copy.textContent = "Copy";
        }, 1500);
      });
      return;
    }
    const a = target.closest<HTMLAnchorElement>("a[href^='/docs']");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate({ href: a.getAttribute("href") ?? "/docs" });
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label="Toggle documentation menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <Menu className="size-4" />
        </Button>
        <BrandMark
          suffix={
            <span className="text-[15px] text-muted-foreground/70">/ Docs</span>
          }
        />
        <nav className="ml-auto flex items-center gap-1 text-[13px]">
          <Link
            to="/"
            className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            Playground
          </Link>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub
            <ArrowUpRight className="size-3.5" />
          </a>
        </nav>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {navOpen && (
          <button
            type="button"
            aria-label="Close documentation menu"
            className="fixed inset-0 top-12 z-40 bg-black/50 sm:hidden"
            onClick={() => setNavOpen(false)}
          />
        )}

        <aside
          className={cn(
            "w-60 shrink-0 overflow-auto border-r border-border bg-card/30 px-3 py-5",
            "max-sm:fixed max-sm:inset-y-0 max-sm:top-12 max-sm:left-0 max-sm:z-50 max-sm:bg-background max-sm:transition-transform",
            navOpen ? "max-sm:translate-x-0" : "max-sm:-translate-x-full",
          )}
        >
          <nav className="space-y-6">
            {DOC_GROUPS.map(({ group, docs }) => (
              <div key={group}>
                <div className="mb-1.5 px-2.5 text-[12px] font-semibold text-foreground">
                  {group}
                </div>
                <ul className="space-y-0.5">
                  {docs.map((d) => (
                    <li key={d.key}>
                      <Link
                        to="/docs/$section"
                        params={{ section: d.key }}
                        onClick={() => setNavOpen(false)}
                        className={cn(
                          "block rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                          active === d.key
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                        )}
                      >
                        {d.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <main ref={scrollRef} className="flex-1 overflow-auto">
          <article className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
            <p className="mb-2 text-[13px] font-medium text-primary">
              {activeDoc.group}
            </p>
            {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegated handler for real <a>/<button> children */}
            <div ref={proseRef} className="docs-prose" onClick={onProseClick}>
              {segments.map((s, i) =>
                s.kind === "html" ? (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments are a static render of one doc
                    key={i}
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional render of trusted bundled docs markdown
                    dangerouslySetInnerHTML={{ __html: s.html }}
                  />
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are a static render of one doc
                  <DocsSceneBlock key={`${active}-${i}`} source={s.source} />
                ),
              )}
            </div>

            <footer className="mt-12 border-t border-border pt-6">
              <a
                href={`${GITHUB_REPO}/edit/main/docs/${activeDoc.file}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="size-3.5" />
                Edit this page on GitHub
              </a>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {prev ? (
                  <PagerLink doc={prev} dir="prev" />
                ) : (
                  <span className="max-sm:hidden" />
                )}
                {next && <PagerLink doc={next} dir="next" />}
              </div>
            </footer>
          </article>
        </main>

        {toc.length > 0 && (
          <aside className="hidden w-60 shrink-0 overflow-auto px-3 py-10 lg:block">
            <div className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-semibold text-foreground">
              <ListTree className="size-3.5" />
              On this page
            </div>
            <nav className="space-y-0.5 border-l border-border/60">
              {toc.map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToHeading(t.id);
                    history.replaceState(null, "", `#${t.id}`);
                  }}
                  className={cn(
                    "block truncate border-l-2 py-1 pr-2 text-[12.5px] leading-5 transition-colors",
                    activeId === t.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  style={{ paddingLeft: `${0.75 + t.indent * 0.75}rem` }}
                  title={t.text}
                >
                  {t.text}
                </a>
              ))}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}

function PagerLink({
  doc,
  dir,
}: {
  doc: { key: string; label: string };
  dir: "prev" | "next";
}) {
  return (
    <Link
      to="/docs/$section"
      params={{ section: doc.key }}
      className={cn(
        "group rounded-lg border border-border px-4 py-3 transition-colors hover:border-primary/60",
        dir === "next" && "text-right sm:col-start-2",
      )}
    >
      <div className="text-[12px] text-muted-foreground">
        {dir === "prev" ? "Previous" : "Next"}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[14px] font-medium text-foreground group-hover:text-primary">
        {dir === "prev" && <ChevronLeft className="size-4" />}
        <span className={cn(dir === "next" && "ml-auto")}>{doc.label}</span>
        {dir === "next" && <ChevronRight className="size-4" />}
      </div>
    </Link>
  );
}
