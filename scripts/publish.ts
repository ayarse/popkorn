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

const PKGS = [
  "packages/popcorn-parser/package.json",
  "packages/popcorn-player/package.json",
  "packages/popcorn-skia/package.json",
];

// name -> version for every workspace package, to resolve `workspace:` ranges.
const versions: Record<string, string> = {};
for await (const path of new Bun.Glob("packages/*/package.json").scan(".")) {
  const { name, version } = await Bun.file(path).json();
  if (name && version) versions[name] = version;
}

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
  // Only consumer-facing dep fields need real versions; devDependencies aren't
  // installed transitively, so a leftover workspace:* there is inert.
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = pkg[field];
    for (const name in deps) {
      if (typeof deps[name] === "string" && deps[name].startsWith("workspace:") && versions[name]) {
        deps[name] = resolveRange(deps[name], versions[name]);
      }
    }
  }
  await Bun.write(path, JSON.stringify(pkg, null, 2) + "\n");
}

try {
  await $`bunx changeset publish`;
} finally {
  await $`git checkout -- ${PKGS}`;
}
