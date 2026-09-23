import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { SITE } from "@/routes/__root";

/** Title/description/canonical for a keyword landing page. */
export function landingHead(path: string, title: string, description: string) {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: `${SITE}${path}` },
    ],
    links: [{ rel: "canonical", href: `${SITE}${path}` }],
  };
}

/** Shared shell: header, h1 + lede, page body, and the "why the CSS file" pitch. */
export function Landing({
  heading,
  lede,
  children,
}: {
  heading: string;
  lede: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <BrandMark />
        <Link
          to="/"
          className={buttonVariants({ size: "sm", className: "ml-auto" })}
        >
          Open the playground
        </Link>
      </header>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
          <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
          <p className="mt-3 text-muted-foreground">{lede}</p>
          <div className="mt-8">{children}</div>
          <section className="mt-12 border-t border-border pt-8">
            <h2 className="text-xl font-semibold">
              The Lottie is the export. The CSS is the source.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Every animation here starts as a Popkorn scene: a short text file
              written in CSS, with <code>@keyframes</code>,{" "}
              <code>transform</code> and <code>offset-path</code>. You can read
              it, diff it in a pull request, edit it by hand, or ask an AI to
              change it. Export Lottie when a project needs it, or play the
              scene directly on web and native mobile with the Popkorn player
              and skip the conversion.
            </p>
            <p className="mt-3 text-sm">
              <Link
                to="/docs/{-$section}"
                params={{ section: "introduction" }}
                className="underline"
              >
                What is Popkorn?
              </Link>
              {" · "}
              <Link
                to="/docs/{-$section}"
                params={{ section: "coming-from-lottie-and-rive" }}
                className="underline"
              >
                Coming from Lottie
              </Link>
              {" · "}
              <Link to="/community" className="underline">
                Gallery
              </Link>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
