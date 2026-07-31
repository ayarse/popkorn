---
name: releasing-popkorn
description: Use when publishing @popkorn/* packages to npm — the changesets release flow, and why scripts/publish.ts exists and must not be simplified away.
---

# Releasing

npm publishing is **changesets** + `.github/workflows/release.yml`: run `bun
changeset`, merge to main, then merge the bot's "Version Packages" PR — that
merge publishes. Don't `bun run release` by hand.

`scripts/publish.ts` is a bun-specific shim. changesets shells out to `npm
publish` for any non-pnpm repo, and npm applies neither `publishConfig`
field-overrides nor `workspace:*` resolution. So the script splices each
package's dist-pointing `publishConfig` onto its manifest AND rewrites
`workspace:*` deps → real versions before publishing, then `git checkout`s the
src-pointing dev manifests back (dev keeps main/types/exports on `./src` so the
workspace runs build-free; only the published tarball points at `./dist`).
**Don't drop the `workspace:*` rewrite — without it the published tarballs are
uninstallable.** Tests are `bun:test`, so switching to pnpm (which would delete
this shim) isn't worth it.
