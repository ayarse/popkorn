#!/usr/bin/env bun
// Minify/format/crush a Popkorn file via parse → serialize; byte counts go to stderr.
import { readFileSync, writeFileSync } from "node:fs";
import { crushSource, format, minify } from "./index.js";

const args = process.argv.slice(2);
let input: string | undefined;
let output: string | undefined;
let pretty = false;
let crushed = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--pretty") pretty = true;
  else if (a === "--crush") crushed = true;
  else if (a === "-o" || a === "--out") output = args[++i];
  else if (!a.startsWith("-")) input = a;
  else {
    console.error(`unknown option: ${a}`);
    process.exit(1);
  }
}

if (!input) {
  console.error(
    "usage: popkorn-minify <in.css> [-o out.css] [--pretty | --crush]",
  );
  process.exit(1);
}

const src = readFileSync(input, "utf8");
const out = pretty ? format(src) : crushed ? crushSource(src) : minify(src);

const before = Buffer.byteLength(src);
const after = Buffer.byteLength(out);
const pct = before ? ((1 - after / before) * 100).toFixed(1) : "0.0";
console.error(`${input}: ${before} → ${after} bytes (${pct}% smaller)`);

if (output) writeFileSync(output, out);
else process.stdout.write(out + "\n");
