import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "popkorn-cli-"));
  const p = join(dir, "in.json");
  writeFileSync(p, JSON.stringify(DOC));
  return p;
}

/** A batch dir with one good doc plus, optionally, a malformed one that FAILs. */
function writeBatch(withBad: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "popkorn-batch-"));
  writeFileSync(join(dir, "good.json"), JSON.stringify(DOC));
  if (withBad) writeFileSync(join(dir, "bad.json"), "{ not valid lottie");
  return dir;
}

async function run(args: string[]) {
  // Route the child's stdout/stderr to real files via shell redirection. Bun's
  // own pipe/fd capture drops child stdout when the parent is the bun-test
  // runner (a Bun quirk — even `bun -e "console.log"` comes back empty), so we
  // redirect at the shell and read the files back instead.
  const dir = mkdtempSync(join(tmpdir(), "popkorn-io-"));
  const outPath = join(dir, "out");
  const errPath = join(dir, "err");
  const quoted = [CLI, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`);
  const proc = Bun.spawn(
    ["sh", "-c", `bun ${quoted.join(" ")} >'${outPath}' 2>'${errPath}'`],
    { stdout: "ignore", stderr: "ignore" },
  );
  const code = await proc.exited;
  return {
    stdout: readFileSync(outPath, "utf8"),
    stderr: readFileSync(errPath, "utf8"),
    code,
  };
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

test("--batch exits 0 when every file converts", async () => {
  const { code } = await run(["--batch", writeBatch(false)]);
  expect(code).toBe(0);
});

test("--batch exits nonzero when a file fails", async () => {
  const { stdout, code } = await run(["--batch", writeBatch(true)]);
  expect(code).not.toBe(0);
  expect(stdout).toContain("failed 1");
});
