---
name: writing-popkorn-docs
description: >
  Use when writing or rewriting any public-facing Popkorn documentation — README,
  docs/*.md (CONCEPT, ARCHITECTURE, DSL, state-machines, getting-started, etc.),
  package READMEs, or landing/marketing copy. Sets the voice, tone, and positioning
  for prose meant for humans discovering the project, NOT for CLAUDE.md dev-notes.
  Trigger whenever the task is "improve/rewrite the docs", "make this read for public
  consumption", "this reads like dev notes / an LLM spec", "write the intro", or any
  doc that a newcomer or potential user will read. Also use to sanity-check existing
  doc prose against the house voice before committing.
---

# Writing Popkorn docs

Public docs get rewritten for **humans discovering the project**, not as a log of
what we built. The failure mode we are fixing: docs that read like a changelog,
LLM dev-notes, or a coding spec. Order everything **concept → mechanics** (the
Google `DESIGN.md` intro is the north star). Nothing in the current docs is gospel;
rewrite freely.

CLAUDE.md and other internal notes are exempt — this voice is only for prose a
newcomer or user reads.

## What Popkorn is (positioning — get this right first, everything flows from it)

- Popkorn is a **format + runtime**: a small **language for portable motion
  graphics**. Say "format + runtime." Do NOT call it an engine, toolkit, or
  "a CSS-subset DSL played by a Canvas2D engine" — those name parts, not the whole.
- Lead with the what-if hook: **"What if a CSS animation could leave the browser?"**
- It's a **close CSS dialect, not CSS.** Frame it as "very close, kept as close as
  possible — maybe some good parts go upstream one day 🤞". Never claim "it is CSS."

## Tone

- **Confident about the idea, honest that it's early.** The frame: a what-if that
  became a proof of concept and went further than expected — the bet already holds.
- **Only positive, forward-looking framing about maturity.** Say "very early PoC
  stages, surface still growing." Never say "not production-ready" or any negative
  "it's not X" construction. Early is a feature (honesty that lands), not a caveat.
- **No self-deprecation.** Confident about the concept, humble about the timeline.
- Don't parrot the user's or source's exact words back. Lead with the positive
  reframing (e.g. not "most scenes start one of two ways" but the version that says
  *this is what's available today, and even today you can do this*).

## The thesis: Why CSS (deserves its own section)

This is the load-bearing idea, not a side-note. Two beats:

1. **Idiomatic CSS on purpose.** If CSS already has a property, use it with its exact
   semantics — motion paths are `offset-path`, holds are `step-end`, staggering is
   negative `animation-delay`, layering is `z-index`. Never invent syntax CSS has.
2. **Dual readership from that one choice.** Humans already speak it (there's a
   vibrant community making genuinely beautiful hand-written-CSS art). LLMs already
   speak it too, for free — because the format *is* CSS-shaped, a model writes valid
   Popkorn from its existing training data with minimal guidance. No fine-tuned
   models, no special format to teach. Reframe any vague "LLM-friendly" claim into
   this concrete version.

Free-tooling payoff worth mentioning: the `.css` shape gives syntax highlighting
free on GitHub, in editors, everywhere — because it stays close to CSS.

## Lottie / Rive

Mention them **minimally**, and only as **evidence/proof** (e.g. "imports real
Lottie files faithfully"), never as identity. Do not lean on "Lottie you can write
by hand" and do not position Popkorn as "a better Lottie."

## The size claim (precise and humble)

Do NOT say "usually smaller than the Lottie." The true, humble version: in our tests
it's more often than not **significantly smaller** than the Lottie or even SVG source;
sometimes equal; in rare cases slightly larger by a couple of KB. Phrase as an
observation ("often slightly smaller"), not a benchmarked guarantee. Offer a real
measured number only if asked.

## How scenes get made (what's available *today*)

- Frame around *today*: it's so early there are no authoring tools yet, but even now
  you can do this. Two practical paths today — **prompting (Copilot)** and **import** —
  plus **hand-authoring** as an always-open, genuinely pleasant door. Nod at a
  possible future creation tool. Lead with the positive ("most scenes start one of
  two ways today"), so hand-authoring reads as an option, not a disclaimer.
- Push readers to **the playground** to explore the format first. Don't send them
  into the packages or CLI yet — no CLI in the README. Link packages only as the
  "if you want the how" pointer.
- The differentiator that holds no matter who made the scene: it's **readable and
  editable**.

## Capabilities

Write them as **grouped prose**, never a changelog/feature-log. **Show, don't
assert:** include a complete, real scene inline. Every line of sample syntax must be
**verified-real** — nothing invented. Verify against `examples/popkorn/*.css` or the
parser before pasting. A good sample also demonstrates a differentiator inline (e.g.
`transition: fill` + `&:hover` on a bouncing ball: interactive states compose on top
of a running animation instead of restarting it — different channels, one continuous
timeline).

## Writing the status section

Keep it **honest and forward-looking**: what works today, what's WIP, what's next —
no "not production-ready" framing. Don't hardcode the current facts (renderer count,
which backends are WIP, perf state) into prose you won't revisit; pull them fresh
from the repo and CLAUDE.md at write time so the doc doesn't rot.

## Mechanics

- **No em-dashes.** Use colons, commas, or periods instead. This is a hard rule the
  maintainer enforces across every doc — sweep for `—` before finishing and get the
  count to zero.
- Prose over lists where a paragraph reads better; reserve bullets for genuinely
  parallel items.
- Reference tables (packages, scripts, license) go at the end.

## Reference README spine (proven structure)

Use this ordering as the default shape for the README, adapt for other docs:

1. Opening — the what-if hook + "a small language for portable motion graphics" +
   honest early-PoC close.
2. A scene, in full — one complete, verified-real scene, shown not described.
3. Getting started — `bun` + the `<popkorn-player>` web component (push to playground).
4. What it can do — capabilities as grouped prose.
5. Why CSS — the idiom rule + dual readership (humans *and* LLMs).
6. Making a scene / importing — the two paths today + the humble size observation.
7. How it works — one paragraph pointing to `docs/ARCHITECTURE.md`.
8. Status & what's next — honest "early, here's the direction."
9. Packages / Scripts / License.

## Self-check before finishing

- [ ] Zero em-dashes (`grep -c '—' <file>` returns 0).
- [ ] Framed as "format + runtime," not engine/toolkit/DSL-played-by-engine.
- [ ] "Close CSS dialect," never "it is CSS."
- [ ] Lottie/Rive appear only as evidence, sparingly.
- [ ] No "not production-ready" or negative maturity framing.
- [ ] Any sample syntax is verified-real.
- [ ] Size claim is humble and observational.
- [ ] Reads as concept → mechanics, for a newcomer — not a dev-log or LLM spec.
