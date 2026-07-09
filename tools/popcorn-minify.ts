#!/usr/bin/env bun
/**
 * Minify (or pretty-print) a Popcorn DSL file by round-tripping it through the
 * parser and serializer. The output is guaranteed to parse to the same AST as
 * the input — minification is value-preserving, not lossy.
 *
 *   bun tools/popcorn-minify.ts <in.css> [-o out.css] [--pretty]
 *
 * Default minifies; --pretty reformats (2-space indent). With -o the result is
 * written to a file, otherwise it goes to stdout. Byte counts are printed to
 * stderr either way.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parse, serialize } from "../packages/popcorn-parser/src/index.ts";

const args = process.argv.slice(2);
let input: string | undefined;
let output: string | undefined;
let pretty = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--pretty") pretty = true;
  else if (a === "-o" || a === "--out") output = args[++i];
  else if (!a.startsWith("-")) input = a;
  else {
    console.error(`unknown option: ${a}`);
    process.exit(1);
  }
}

if (!input) {
  console.error(
    "usage: bun tools/popcorn-minify.ts <in.css> [-o out.css] [--pretty]",
  );
  process.exit(1);
}

const src = readFileSync(input, "utf8");
const out = serialize(parse(src), { minify: !pretty });

const before = Buffer.byteLength(src);
const after = Buffer.byteLength(out);
const pct = before ? ((1 - after / before) * 100).toFixed(1) : "0.0";
console.error(`${input}: ${before} → ${after} bytes (${pct}% smaller)`);

if (output) writeFileSync(output, out);
else process.stdout.write(out + "\n");
