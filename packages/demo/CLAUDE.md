# Popcorn Demo — Design & Code Guide

A Vite + React shell around the `<popcorn-player>` web component. It exists to
*showcase* the player/parser and to *dogfood* the Lottie converter. The UI is a
Linear-style dark IDE: source editor on the left, live canvas on the right.

## Commands

bun, never npm/pnpm (a stray `pnpm-lock.yaml` is always an accident):

```
bun install                              # at repo root, installs the workspace
bun --filter @popcorn/demo dev           # vite dev server
bun --filter @popcorn/demo build         # tsc -b && vite build
bun --filter @popcorn-demo test          # repo-wide tests (DOM-free, bun-native)
```

Always run from repo root with `--filter`; running `bun add` *inside*
`packages/demo` works but `--filter` from root is the documented footgun-free
path — a bare `bun add --filter` at root has been seen to drop deps into the
root `package.json` by mistake, so verify the dep landed in
`packages/demo/package.json` after.

## Stack

- **Vite 6** + `@vitejs/plugin-react`. `@` → `packages/demo/src` alias (in
  `vite.config.ts` *and* `tsconfig.json` `paths` — keep both in sync).
- **Tailwind v4** via `@tailwindcss/vite` (no `tailwind.config.js`). Theme
  tokens live in `src/globals.css` under `@theme inline`. The `dark` variant is
  `@custom-variant dark (&:is(.dark *))`.
- **shadcn-style UI** built by hand from Radix primitives + CVA — there is no
  `components.json`, no shadcn CLI. Components live in `src/components/ui/*`
  and are edited directly.
- **lucide-react** for icons. Import named: `import { Repeat } from "lucide-react"`.
- **Fonts**: Inter via `@import url("https://rsms.me/inter/inter.css")` at the
  *top* of `globals.css` (CSS requires `@import` before any other rule — moving it
  below the Tailwind imports silently drops the font). JetBrains Mono via
  `@fontsource/jetbrains-mono` (400 + 700 weights imported in `main.tsx`); Vite
  emits the woff/woff2 as hashed assets, loaded on demand. `--font-mono` puts
  JetBrains Mono first, system mono as fallback.

## Layout

`app.tsx` is the shell — it owns the shared state and wires up presentational
panels. Structure:

```
<TooltipProvider delayDuration={400}>        # wraps everything; required for any Tooltip
  <div flex h-full flex-col>                  # full-height dark surface
    <AppHeader>                               # logo, Examples ▼, ImportStatusChip, Import, Copilot
    <div flex flex-1 overflow-hidden>         # two-pane split
      <SourcePanel>                           # react-simple-code-editor + Prism, minify toggle
      <PlayerPanel>                           # toolbar + MotionCanvas + error toast + bg menu
      <AgentChat>                             # copilot sidebar
    <ImportModal?>                            # controlled by showImport
```

Files: `app.tsx` (shell) + `components/{app-header,source-panel,player-panel,
import-modal,import-status-chip,bg-context-menu}.tsx`. Size/import math lives in
`lib/import-size.ts`.

No router, no state library. `app.tsx` holds the *shared* state (`source`,
`error`, `importResult`, `currentExample`, `minified`/`sizeDelta`, `chatOpen`)
and the import/minify handlers; `PlayerPanel` owns the *player-only* state
(`fit`, `renderer`, `loop`, controls, bg, export progress) internally so App
doesn't thread it. The editor is the source of truth: `source` feeds both the
Prism-highlighted textarea and `<MotionCanvas source={source}>`.

## Design system

**Dark mode is always on.** `main.tsx` does `document.documentElement.classList.add('dark')`.
There is no light theme and no toggle. All color comes from the oklch tokens in
`globals.css` (`--background`, `--foreground`, `--card`, `--popover`, `--primary`,
`--secondary`, `--muted`, `--border`, `--destructive`, `--ring`, …) mapped into
Tailwind via `@theme inline`. Reference tokens (`bg-background`, `text-muted-foreground`,
`border-border`, …) — never raw hex/oklch in components.

A few hardcoded colors are intentional and stay inline:
- `text-amber-500` / `text-emerald-500` for warning/success status (no semantic
  token for these yet).
- `shadow-black/30` on the player frame.

**Spacing/sizing conventions:** headers `h-12`, toolbars `h-10`, buttons `h-8`
(default) / `h-7` (sm) / `size-8` (icon). Dividers are `mx-1 h-5 w-px bg-border`.
Radius comes from `--radius` (0.625rem) and the `@theme inline` `--radius-*` ramp.

## UI components (`src/components/ui/`)

Each file follows the same shape: import the Radix primitive, wrap with
`React.forwardRef`, style via a `cn(...)` className merge, export named. The
`Button` is the template — CVA with `variant` (default/secondary/outline/ghost/
destructive/link) and `size` (default/sm/lg/icon). When adding a new component,
copy `Button` or `tooltip.tsx` as the skeleton; do not reach for a CLI.

`cn()` (in `src/lib/utils.ts`) is `clsx + tailwind-merge`. Always use it for
conditional classes — `twMerge` dedupes conflicting Tailwind utilities so
caller overrides win.

## Player toolbar

The `h-10` toolbar at the top of the animation panel is where player-facing
tools live. Tools are right-aligned (`ml-auto` on the inner flex). Current
order left→right: **Fit ▼** → **Loop** → **Controls** → `divider` → **BG color**.

Two tool shapes, both with tooltips:

**Icon toggle** (Loop, Controls): `<Tooltip>` wrapping a `<TooltipTrigger asChild>`
wrapping a ghost `size="icon"` `<Button>`. Swap the icon on state; reflect the
state in the tooltip text ("Loop playback" / "Loop playback (off)").

**Trigger + floating panel** (Fit dropdown, BG color popover): the trigger needs
*both* a tooltip (hover) and a menu/popover (click). Nest them:

```tsx
<DropdownMenu>
  <Tooltip>
    <TooltipTrigger asChild>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">…</Button>
      </DropdownMenuTrigger>
    </TooltipTrigger>
    <TooltipContent>Fit mode</TooltipContent>
  </Tooltip>
  <DropdownMenuContent>…</DropdownMenuContent>
</DropdownMenu>
```

Order matters: `Tooltip > TooltipTrigger > (Dropdown|Popover)Trigger > Button`,
all `asChild`. This pattern is load-bearing — flipping the Tooltip/Popover order
breaks hover detection. The BG picker uses the same shape with `Popover` instead
of `DropdownMenu`.

Every toolbar tool gets a tooltip. Text-bearing triggers (Fit) are
self-labeling but still get a category tooltip ("Fit mode").

## Player props → web component

`MotionCanvas` (`src/components/MotionCanvas.tsx`) wraps `<popcorn-player>`.
React is unreliable about reflecting custom-element *properties*, so the wrapper
sets *attributes* in a `useEffect` for `controls`/`loop`/`fit` and assigns
`player.source = source` directly for the scene text. When adding a new
player-facing prop:

1. Add it to `MotionCanvasProps` (typed, with a JSDoc comment).
2. Add a default in the destructure.
3. Reflect it as an attribute in the `[controls, loop, fit, …]` effect (boolean
   → `setAttribute(name, '')` / `removeAttribute(name)`; string → `setAttribute`).
4. Surface it as a toolbar tool (see above) — do not leave it hardcoded.

`autoplay` exists on the web component but is not yet exposed by `MotionCanvas`.

## Import flow

`Import Lottie` opens `ImportModal` (a `Dialog` with a dropzone + paste textarea).
On submit, `importLottie(text, label)` runs `convertLottie(lottie)` (from
`@popcorn/converters`) and builds an `ImportResult`:

```ts
type ImportResult = {
  label: string;            // file name or "pasted JSON"
  warnings: string[];       // non-fatal, scene still renders
  blocked: string[];        // modifiers/features dropped (scene may differ)
  raw: SizePair;            // { lottie, popcorn } byte sizes
  min?: SizePair;           // minified (JSON.stringify / serialize minify)
};
```

The result renders as `ImportStatusChip` in the header: a dismiss (✕) + a status
button (✓/⚠ + label + `Nw`/`Nb` badges + delta %) that opens a `Popover` with
the full breakdown. **Size cells must use `whitespace-nowrap`** — values like
`157.9 KB` wrap mid-number otherwise. Columns are labeled `Lottie` / `Popcorn`
in full (not `L`/`P`).

Errors (invalid JSON, conversion failure, player runtime error) surface as a
floating toast at the bottom-center of the player pane, not a modal.

## Examples

`src/examples.ts` exports `examples: Example[]` where `Example = { key, label, source }`.
**The scenes themselves live in `examples/popcorn/*.css` at the repo root** (the
source of truth, also test-globbed by the parser/player suite); `examples.ts`
loads them with `import.meta.glob(..., { query: '?raw', eager: true })` and
derives `key`/`label`/order from the filename. Convention: `NN-kebab-name.css`
— `NN` orders the gallery, the name (prefix stripped, dashes → spaces,
sentence-cased) is the label. Add or edit a scene by touching that folder; no
change to `examples.ts` needed. Use the `creating-popcorn-animations` skill
when authoring scenes.

The Examples dropdown uses `DropdownMenuCheckboxItem` (multi-select semantics
for "which is active"); fit mode uses `DropdownMenuRadioGroup`/`RadioItem`
(single-select). Pick the item type that matches the semantics.

## Conventions & gotchas

- **`verbatimModuleSyntax: true`** — type-only imports must be
  `import type { … }` or inline `import { type Foo }`. Mixing a value and a type
  from the same module needs `import { Foo, type Bar }`.
- **`noUnusedLocals` / `noUnusedParameters: true`** — remove imports you stop
  using before building; `tsc -b` will fail otherwise.
- **`@/*` alias** — one rule: anything under `src/` imports via `@/…`
  (`@/components/…`, `@/lib/…`, `@/use-scene`, `@/globals.css`), never relative.
  Relative imports are *only* for files outside `src/` that the alias can't
  reach — the repo-root converters (`../../../tools/…`) and skill docs
  (`../../../../.claude/…`). `@` resolves in the Vite build and in bun tests
  (via the demo `tsconfig.json` `paths`).
- **No comments in code** unless asked.
- **Scrollbar styling** lives in `globals.css` (`@layer base`): a thin dark thumb
  on a faint always-visible rail that brightens on `:hover`. Do not reintroduce
  `::-webkit-scrollbar:hover ::-webkit-scrollbar-thumb` — a descendant combinator
  between two pseudo-elements is invalid CSS and the browser discards the whole
  rule. There is no `:scrolling` pseudo; the hover-brighten trick is the
  portable approach.
- **`prism-tomorrow.css`** is imported for token *colors* only; the editor's
  font comes from `style.fontFamily = "var(--font-mono)"`.

## Verification bar

After any UI change: `bun --filter @popcorn/demo build` green (runs `tsc -b` +
Vite) and a browser eyeball of the affected surface. Screenshots lie less than
tests here — several real bugs were only visible on canvas. After any
player/converter change, also run the LottieFiles corpus batch
(`packages/popcorn-converters/src/cli.ts --batch`) and confirm the clean/warn/blocked
counts are unchanged-or-better.

## Commits

Straight to `main`, short conventional messages (`feat(demo): …`, `style(demo): …`),
no attribution trailers. Stage only the files you actually changed — the working
tree often carries unrelated `.claude/agents/*` or `tools/*` edits that belong
to other work.
