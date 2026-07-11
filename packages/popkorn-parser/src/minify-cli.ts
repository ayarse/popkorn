#!/usr/bin/env bun
/**
 * Minify (or pretty-print) a Popkorn DSL file by round-tripping it through the
 * parser and serializer. The output is guaranteed to parse to the same AST as
 * the input — minification is value-preserving, not lossy.
 *
 *   popkorn-minify <in.css> [-o out.css] [--pretty]
 *
 * Default minifies; --pretty reformats (2-space indent). With -o the result is
 * written to a file, otherwise it goes to stdout. Byte counts are printed to
 * stderr either way.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { format, minify } from "./index";

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
  console.error("usage: popkorn-minify <in.css> [-o out.css] [--pretty]");
  process.exit(1);
}

const src = readFileSync(input, "utf8");
const out = pretty ? format(src) : minify(src);

const before = Buffer.byteLength(src);
const after = Buffer.byteLength(out);
const pct = before ? ((1 - after / before) * 100).toFixed(1) : "0.0";
console.error(`${input}: ${before} → ${after} bytes (${pct}% smaller)`);

if (output) writeFileSync(output, out);
else process.stdout.write(out + "\n");
