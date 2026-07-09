#!/usr/bin/env bun
/**
 * CLI wrapper around lottie2popcorn.ts's pure conversion core.
 *
 *   bun tools/lottie2popcorn-cli.ts <in.json> [-o out.css] [--validate]
 *   bun tools/lottie2popcorn-cli.ts --batch <dir> [--validate]
 *
 * Node/Bun-only (fs, path, process) — kept out of lottie2popcorn.ts so that
 * module stays importable from browser code (e.g. the demo's Lottie import).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Converter, validate } from "./lottie2popcorn.ts";

function convertFile(path: string): {
  css: string;
  warnings: string[];
  blocked: Set<string>;
} {
  const lottie = JSON.parse(readFileSync(path, "utf8"));
  const c = new Converter();
  const css = c.convert(lottie);
  return { css, warnings: c.warnings, blocked: c.blocked };
}

function walkJson(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkJson(p, out);
    else if (name.endsWith(".json") && !name.endsWith("-meta.json"))
      out.push(p);
  }
  return out;
}

function runBatch(dir: string) {
  const files = walkJson(dir).sort();
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
    const errors = validate(res.css);
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
      "usage: bun tools/lottie2popcorn-cli.ts <in.json> [-o out.css] [--validate]",
    );
    console.error(
      "       bun tools/lottie2popcorn-cli.ts --batch <dir> [--validate]",
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
    const errors = validate(css);
    if (errors.length) {
      for (const e of errors) console.error(`validate error: ${e}`);
      process.exit(1);
    }
    console.error("validate: ok");
  }
}

// Only run the CLI when executed directly, so tests can import the Converter.
if (import.meta.main) main();
