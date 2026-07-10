import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "cli.ts");

// A tiny valid Lottie doc: one solid layer. Enough to convert + validate.
const DOC = {
  v: "5",
  fr: 30,
  ip: 0,
  op: 30,
  w: 100,
  h: 100,
  layers: [
    {
      ty: 1,
      nm: "bg",
      ind: 1,
      ip: 0,
      op: 30,
      st: 0,
      sw: 100,
      sh: 100,
      sc: "#112233",
      ks: {
        r: { a: 0, k: 0 },
        p: { a: 0, k: [50, 50] },
        a: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] },
        o: { a: 0, k: 100 },
      },
    },
  ],
};

function writeDoc(): string {
  const dir = mkdtempSync(join(tmpdir(), "popcorn-cli-"));
  const p = join(dir, "in.json");
  writeFileSync(p, JSON.stringify(DOC));
  return p;
}

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

test("no -o dumps CSS to stdout", async () => {
  const { stdout, code } = await run([writeDoc()]);
  expect(code).toBe(0);
  expect(stdout).toContain("type: rect");
});

test("--validate writes no CSS and reports ok", async () => {
  const { stdout, stderr, code } = await run([writeDoc(), "--validate"]);
  expect(code).toBe(0);
  // Report-only: nothing on stdout, the report goes to stderr.
  expect(stdout).toBe("");
  expect(stderr).toContain("validate: ok");
});
