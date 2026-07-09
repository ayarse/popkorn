#!/usr/bin/env bun
/**
 * Unified CLI over the lottie/svg conversion cores. Format is picked from the
 * file extension (.json → lottie, .svg → svg) — same dispatch the demo's Import
 * button uses — so there's no --from flag to restate what the extension says.
 *
 *   bun packages/popcorn-converters/src/cli.ts <in.json|in.svg> [-o out.css] [--validate]
 *   bun packages/popcorn-converters/src/cli.ts --batch <dir> [--validate]   # walks by extension
 *
 * Node/Bun-only (fs, path, process) — kept out of the *2popcorn.ts cores so they
 * stay importable from browser code (the demo's Lottie/SVG import).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import * as lottie from "./lottie2popcorn";
import * as svg from "./svg2popcorn";

// Registry keyed by extension. Both cores share the Converter/validate contract
// shape, so a format is just: which module, how to parse input, which files to
// pick up in --batch.
const FORMATS: Record<
  string,
  {
    mod: { Converter: new () => any; validate: (css: string) => string[] };
    parse: (raw: string) => unknown;
    take: (name: string) => boolean;
  }
> = {
  ".json": {
    mod: lottie,
    parse: (raw) => JSON.parse(raw),
    take: (name) => name.endsWith(".json") && !name.endsWith("-meta.json"),
  },
  ".svg": {
    mod: svg,
    parse: (raw) => raw,
    take: (name) => name.endsWith(".svg"),
  },
};

function formatFor(path: string) {
  const fmt = FORMATS[extname(path).toLowerCase()];
  if (!fmt) {
    console.error(`unsupported input: ${path} (expected .json or .svg)`);
    process.exit(1);
  }
  return fmt;
}

function convertFile(path: string): {
  css: string;
  warnings: string[];
  blocked: Set<string>;
} {
  const fmt = formatFor(path);
  const c = new fmt.mod.Converter();
  const css = c.convert(fmt.parse(readFileSync(path, "utf8")));
  return { css, warnings: c.warnings, blocked: c.blocked };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (FORMATS[extname(name).toLowerCase()]?.take(name)) out.push(p);
  }
  return out;
}

function runBatch(dir: string) {
  const files = walk(dir).sort();
  let clean = 0,
    warn = 0,
    blockedCount = 0,
    failed = 0;
  const blockerTally = new Map<string, number>();
  const rows: string[] = [];

  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    let res: ReturnType<typeof convertFile>;
    try {
      res = convertFile(f);
    } catch (e: any) {
      failed++;
      rows.push(`  FAIL      ${rel}  (${e.message})`);
      continue;
    }
    const errors = formatFor(f).mod.validate(res.css);
    const blocked = [...res.blocked];
    for (const b of blocked)
      blockerTally.set(b, (blockerTally.get(b) || 0) + 1);

    if (errors.length) {
      failed++;
      rows.push(`  FAIL      ${rel}  validate: ${errors[0]}`);
    } else if (blocked.length) {
      blockedCount++;
      rows.push(`  BLOCKED   ${rel}  [${blocked.join("; ")}]`);
    } else if (res.warnings.length) {
      warn++;
      rows.push(`  WARN      ${rel}  (${res.warnings.join("; ")})`);
    } else {
      clean++;
      rows.push(`  CLEAN     ${rel}`);
    }
  }

  console.log(rows.join("\n"));
  console.log("\n" + "-".repeat(60));
  console.log(
    `total ${files.length}: clean ${clean}, warn ${warn}, blocked ${blockedCount}, failed ${failed}`,
  );
  if (blockerTally.size) {
    console.log("\ntop blockers:");
    [...blockerTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => {
        console.log(`  ${v}x  ${k}`);
      });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const doValidate = argv.includes("--validate");
  const batchIdx = argv.indexOf("--batch");
  if (batchIdx >= 0) {
    const dir = argv[batchIdx + 1];
    if (!dir) {
      console.error("--batch requires a directory");
      process.exit(1);
    }
    runBatch(dir);
    return;
  }

  const positional = argv.filter(
    (a, i) => !a.startsWith("-") && argv[i - 1] !== "-o",
  );
  const input = positional[0];
  if (!input) {
    console.error(
      "usage: bun packages/popcorn-converters/src/cli.ts <in.json|in.svg> [-o out.css] [--validate]",
    );
    console.error(
      "       bun packages/popcorn-converters/src/cli.ts --batch <dir> [--validate]",
    );
    process.exit(1);
  }
  const oIdx = argv.indexOf("-o");
  const outPath = oIdx >= 0 ? argv[oIdx + 1] : null;

  const { css, warnings, blocked } = convertFile(input);
  if (outPath) {
    writeFileSync(outPath, css);
    console.error(`wrote ${outPath}`);
  } else process.stdout.write(css);

  for (const w of warnings) console.error(`warning: ${w}`);
  for (const b of blocked) console.error(`blocked: ${b}`);
  if (doValidate) {
    const errors = formatFor(input).mod.validate(css);
    if (errors.length) {
      for (const e of errors) console.error(`validate error: ${e}`);
      process.exit(1);
    }
    console.error("validate: ok");
  }
}

// Only run the CLI when executed directly, so tests can import helpers.
if (import.meta.main) main();
