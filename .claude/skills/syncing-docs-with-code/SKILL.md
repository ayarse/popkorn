---
name: syncing-docs-with-code
description: Use when asked to check whether the repo docs are stale, sync docs with recent commits, audit CLAUDE.md/README/docs against git history, or verify documentation still matches the code after a batch of changes.
---

# Syncing Docs With Code

## Overview

The prose docs drift when a `feat`/`fix` changes behavior the docs describe.
This finds that drift by diffing the docs' last-updated timestamps against the
git log, then confirms each suspect against the actual source before editing.
Core rule: **a commit message flags a suspect; the source confirms the drift.**
Never rewrite a doc from the commit message alone.

## Docs in scope

- `CLAUDE.md` (root) and `README.md`
- `docs/*.md` (ARCHITECTURE, REFERENCE, STATE-MACHINES, …)
- `.claude/skills/*/SKILL.md` (the authoring/parity skills)

## Process

1. **Get each doc's last-changed time — use git, not `stat`.** Filesystem
   mtime is checkout time, not edit time. Git last-commit is authoritative:
   ```bash
   for f in CLAUDE.md README.md docs/*.md .claude/skills/*/SKILL.md; do
     printf '%-50s %s\n' "$f" "$(git log -1 --format='%cd' \
       --date=format:'%Y-%m-%d %H:%M:%S' -- "$f")"
   done | sort -k2
   ```

2. **List commits since the oldest doc timestamp:**
   ```bash
   git log --since='<oldest doc time>' \
     --date=format:'%Y-%m-%d %H:%M:%S' --pretty=format:'%cd  %h  %s'
   ```

3. **Triage by commit type.** Only behavior changes can strand a doc:
   - `feat` / `fix` → **suspect**, especially converter/player/parser scope.
   - `refactor` / `chore` / `style` / `ci` / `test` / `build` → skip unless the
     message names something a doc states (e.g. a rename, a removed file).
   For each suspect, note which docs describe that area, and only consider
   commits **newer than that doc's** timestamp (step 1).

4. **Confirm against source, not the message.** For each suspect: `git show
   <hash> --stat` and read the diff or the file's current source (converters
   keep an authoritative scope comment in their header — e.g.
   `svg2popkorn.ts` top-of-file). Then `grep` the docs for the specific claim
   the change contradicts. Drift is real only when the doc text and the source
   disagree.

5. **Edit stale docs, pulling wording from the source of truth** (header
   comments, the registry, CLAUDE.md invariants) so the fix stays true. Fix
   every doc carrying the same stale claim — one drift often lives in 2–3
   files (CLAUDE.md + README + docs/reference.md commonly echo each other).

6. **Commit** with a `docs:` message naming what changed, not "sync docs".

## Common mistakes

- **Trusting `stat`/mtime.** It reflects the last checkout, not the last edit.
  Always use `git log -1 --format=%cd -- <file>`.
- **Editing from the commit message.** Messages exaggerate ("import SMIL") when
  the reality is partial ("basic SMIL; `@media` keyframes still warn"). Read
  the source and mirror its exact hedges.
- **Fixing one file and missing the echoes.** Grep the whole doc set for the
  stale phrase before declaring done.
- **Flagging refactors.** A rename touches many files but rarely a doc claim —
  check, don't rewrite.
