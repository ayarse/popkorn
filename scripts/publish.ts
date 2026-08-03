#!/usr/bin/env bun
// Make the workspace manifests publish-ready, run `changeset publish`, then
// restore the dev manifests. Two rewrites the publisher won't do for us:
//
//   1. publishConfig field-overrides (main/types/exports -> ./dist). Dev keeps
//      main/types/exports on ./src so the repo runs build-free; pnpm/yarn apply
//      `publishConfig` at publish time, but npm and bun don't, so we splice it
//      onto the manifest ourselves.
//
//   2. workspace:* deps -> real versions. `changeset publish` shells out to
//      `npm publish` for any non-pnpm repo (bun included), and npm ships
//      `workspace:*` verbatim -> the tarball can't be installed. bun would
//      resolve it, but changesets never calls bun — the known changesets-on-bun
//      gap — so we resolve it here.
//
// Both edits are reverted with `git checkout` afterward, so the working tree
// keeps its src-pointing dev manifests.
// NOTE: git-checkout restore; if you add non-tracked manifest edits, revisit.
import { $ } from "bun";

// Derived, not hand-listed — a hand-listed set silently skips new packages.
const PKGS: string[] = [];
// name -> version for every workspace package, to resolve `workspace:` ranges.
const versions: Record<string, string> = {};
for await (const path of new Bun.Glob("packages/*/package.json").scan(".")) {
  const { name, version, private: isPrivate } = await Bun.file(path).json();
  if (name && version) versions[name] = version;
  if (!isPrivate) PKGS.push(path);
}
PKGS.sort();

// workspace:*  -> "1.2.3"   |   workspace:^ -> "^1.2.3"   |   workspace:^1.2.3 -> "^1.2.3"
function resolveRange(range: string, version: string): string {
  const spec = range.slice("workspace:".length);
  if (spec === "" || spec === "*") return version;
  if (spec === "^" || spec === "~") return spec + version;
  return spec;
}

for (const path of PKGS) {
  const pkg = await Bun.file(path).json();
  if (pkg.publishConfig) Object.assign(pkg, pkg.publishConfig);
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = pkg[field];
    for (const name in deps) {
      if (typeof deps[name] === "string" && deps[name].startsWith("workspace:") && versions[name]) {
        deps[name] = resolveRange(deps[name], versions[name]);
      }
    }
  }
  // devDeps aren't installed transitively; drop workspace refs rather than
  // resolving them — some point at private packages that aren't on npm.
  for (const name in pkg.devDependencies) {
    if (String(pkg.devDependencies[name]).startsWith("workspace:")) delete pkg.devDependencies[name];
  }
  await Bun.write(path, JSON.stringify(pkg, null, 2) + "\n");
}

// --dry-run <dir>: pack the same transformed manifests instead of publishing.
const dryRun = process.argv.indexOf("--dry-run");
try {
  if (dryRun !== -1) {
    const out = Bun.pathToFileURL(process.argv[dryRun + 1] ?? "dry-run-packs").pathname;
    await $`mkdir -p ${out}`;
    for (const path of PKGS) await $`bun pm pack --destination ${out}`.cwd(path.replace("/package.json", ""));
  } else {
    await $`bunx changeset publish`;
  }
} finally {
  await $`git checkout -- ${PKGS}`;
}
