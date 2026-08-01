/// <reference types="vite/client" />
import { ClerkProvider } from "@clerk/tanstack-react-start";
import { dark } from "@clerk/themes";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import favicon from "@/assets/favicon.svg?url";
import appCss from "@/globals.css?url";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";

export const SITE = "https://usepopkorn.dev";

// Clerk's colour engine derives whole scales from these, so they're hex rather
// than `var(--card)` — it can't read a custom property, and oklch() isn't in the
// formats it parses. Keep in step with the `.dark` block in `globals.css`.
const CLERK_APPEARANCE = {
  theme: dark,
  variables: {
    colorPrimary: "#6875f8",
    colorBackground: "#0d111a",
    colorForeground: "#f8fafe",
    colorMutedForeground: "#8a8f9b",
    colorInput: "#161b24",
    colorInputForeground: "#f8fafe",
    colorBorder: "#23262e",
    // Dark themes want a light neutral: it's the base for borders and hovers.
    colorNeutral: "#f8fafe",
    colorDanger: "#ff6166",
    colorRing: "#6875f8",
    colorModalBackdrop: "rgba(6, 10, 19, 0.8)",
    fontFamily: '"Inter", "Inter var", system-ui, sans-serif',
    borderRadius: "0.625rem",
  },
};

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
    // ponytail: dev builds ship no analytics at all, so localhost never counts.
    scripts: import.meta.env.DEV
      ? []
      : [
          {
            src: "https://www.googletagmanager.com/gtag/js?id=G-WMECFVPC03",
            async: true,
          },
          {
            children:
              "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-WMECFVPC03');",
          },
          {
            // Proxied through the worker (see server/entry.ts) so adblockers
            // don't see a third-party analytics domain.
            src: "/pk/s.js",
            defer: true,
            "data-website-id": "29f483fa-c21e-43ae-9478-0e4ef8d23d72",
            "data-host-url": "/pk",
          },
        ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider appearance={CLERK_APPEARANCE}>
      <html lang="en" className="dark">
        <head>
          <HeadContent />
        </head>
        <body>
          {children}
          <Scripts />
        </body>
      </html>
    </ClerkProvider>
  );
}
