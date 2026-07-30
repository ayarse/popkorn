/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import favicon from "@/assets/favicon.svg?url";
import appCss from "@/globals.css?url";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";

export const SITE = "https://usepopkorn.dev";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      {
        title:
          "Popkorn - A Portable CSS-Based Format for Interactive Motion Graphics",
      },
      {
        name: "description",
        content:
          "A portable format for motion graphics — write scenes in CSS, run the same file on web and native mobile.",
      },
      {
        property: "og:title",
        content: "Popkorn — portable CSS animations that run anywhere",
      },
      {
        property: "og:description",
        content:
          "Write motion graphics in CSS. The same file runs on web and native mobile.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/` },
      { property: "og:image", content: `${SITE}/screenshot.png` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: favicon },
    ],
    scripts: [
      {
        src: "https://www.googletagmanager.com/gtag/js?id=G-WMECFVPC03",
        async: true,
      },
      {
        children:
          "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-WMECFVPC03');",
      },
      {
        src: "https://cloud.umami.is/script.js",
        defer: true,
        "data-website-id": "29f483fa-c21e-43ae-9478-0e4ef8d23d72",
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
