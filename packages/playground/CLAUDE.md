# @popkorn/playground

Vite + React shell around `<popkorn-player>` — showcases the player/parser and
dogfoods the Lottie/SVG converters. Linear-style dark IDE (editor left, canvas
right) plus a `/docs` route rendering the repo's markdown.

Repo-root `CLAUDE.md` owns the cross-cutting rules (bun, commits,
`examples/popkorn/*.css` as scene source, corpus gate). Below is only what an
agent *can't* infer from the code.

## Non-obvious facts

- **`@` alias is declared twice** — `vite.config.ts` *and* `tsconfig.json`
  `paths`. Keep in sync; the tsconfig copy is what resolves `@` in bun tests.
- **Router needs the 404 copy** — `build` runs `cp dist/index.html dist/404.html`
  as the SPA fallback for `@tanstack/react-router` (`/`, lazy `/docs`, and lazy
  `/docs/$section`). Don't drop it. The router's `basepath` is
  `import.meta.env.BASE_URL`, which `vite.config.ts` sets to `/popkorn/` under
  `GITHUB_PAGES` (else `/`) — the 404-copy step and the basepath must agree.
- **Scene state lives in `useScene` (`src/hooks/use-scene.ts`)**. `app.tsx`
  also lifts `player` (the `PopkornPlayer` instance, out of `PlayerPanel`) and
  `sourceCollapsed` alongside `showImport`/`chatOpen`.
- **Import sniffs SVG vs Lottie JSON** (`useScene.importText/importFile` →
  `convertSvg`/`convertLottie`). It's not Lottie-only.
- **MotionCanvas sets attributes, not properties** — React under-reflects
  custom-element props, so the wrapper `setAttribute`s `controls`/`loop`/`fit`/
  `renderer` in an effect and assigns `player.source` directly. New player props
  follow that pattern (`autoplay` exists on the element but isn't wrapped yet).
- **Toolbar trigger nesting is load-bearing**: `Tooltip > TooltipTrigger >
  (Dropdown|Popover)Trigger > Button`, all `asChild`. Flipping it breaks hover.
- **Inter `@import` must stay at the top of `globals.css`** — CSS drops an
  `@import` that follows other rules, silently losing the font.
- **Don't reintroduce `::-webkit-scrollbar:hover ::-webkit-scrollbar-thumb`** in
  `globals.css` — a descendant combinator between two pseudo-elements is invalid
  CSS; the browser discards the whole rule.
- **Tailwind v4, no config file**; theme tokens are in `globals.css`
  `@theme inline`. UI is hand-built Radix + CVA in `components/ui/*` (no shadcn
  CLI) — copy `button.tsx`/`tooltip.tsx`.
- **Copilot agent loop** — `lib/agent.ts` + `lib/agent-tools.ts` drive the
  chat loop, wired up in `hooks/use-agent-chat.ts` and rendered by
  `components/agent/*`. Tested by `lib/agent-loop.test.ts` and
  `lib/agent-tools.test.ts` (plus `lib/edits.test.ts` for the shared edit
  helpers).
- **Export pipeline** — GIF (`lib/gif.ts` + `lib/gif.worker.ts` +
  `lib/gif-plan.ts`) and MP4 (`lib/mp4.ts` + `lib/mp4.worker.ts` +
  `lib/mp4-plan.ts`) each split into a plan (pure, testable frame/timing math)
  and a worker executor. `gifenc.d.ts` shims the untyped `gifenc` package.
- **Timeline** — `components/timeline-panel.tsx` + `components/timeline/scale.ts`
  (time↔pixel mapping) + `lib/timeline-edits.ts`; edits write back into the
  source text, not just runtime state.
- **Diagnostics** — `components/source-diagnostics.tsx` renders parse
  errors/warnings computed in `lib/edits.ts`.
- **Misc** — `lib/tour.ts` (driver.js first-run onboarding), `lib/analytics.ts`,
  `hooks/use-is-mobile.ts`, `components/resize-handle.tsx` (the split-pane
  drag handle).

## Verify

`bun --filter @popkorn/playground build` green + browser eyeball (canvas bugs
hide from tests). Player/converter changes also run the corpus batch.
