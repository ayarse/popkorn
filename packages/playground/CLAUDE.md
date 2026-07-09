# @popcorn/playground

Vite + React shell around `<popcorn-player>` — showcases the player/parser and
dogfoods the Lottie/SVG converters. Linear-style dark IDE (editor left, canvas
right) plus a `/docs` route rendering the repo's markdown.

Repo-root `CLAUDE.md` owns the cross-cutting rules (bun, commits,
`examples/popcorn/*.css` as scene source, corpus gate). Below is only what an
agent *can't* infer from the code.

## Non-obvious facts

- **`@` alias is declared twice** — `vite.config.ts` *and* `tsconfig.json`
  `paths`. Keep in sync; the tsconfig copy is what resolves `@` in bun tests.
- **Router needs the 404 copy** — `build` runs `cp dist/index.html dist/404.html`
  as the SPA fallback for `@tanstack/react-router` (`/` + lazy `/docs`). Don't
  drop it.
- **Scene state lives in `useScene` (`src/use-scene.ts`)**, not `app.tsx`.
  `app.tsx` holds only `showImport`/`chatOpen`; `PlayerPanel` owns player-only
  state internally.
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

## Verify

`bun --filter @popcorn/playground build` green + browser eyeball (canvas bugs
hide from tests). Player/converter changes also run the corpus batch.
