import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compactPath } from "@popkorn/parser";
import {
  LottieConverter,
  SvgConverter,
} from "../../../popkorn-converters/src/index.js";
import type { PathCommand } from "../renderer/types.js";
import { parsePath } from "./path-parser.js";

const EXAMPLES = join(import.meta.dir, "../../../../examples");
const QUOTED = /'([Mm][^']*)'|"([Mm][^"]*)"/g;

// Every quoted string starting with M/m in the popkorn sources and the converted lottie/svg outputs.
function corpusPaths(): string[] {
  const sources: string[] = [];
  for (const dir of ["popkorn", "generated"])
    for (const f of readdirSync(join(EXAMPLES, dir)))
      if (f.endsWith(".css"))
        sources.push(readFileSync(join(EXAMPLES, dir, f), "utf8"));
  for (const f of readdirSync(join(EXAMPLES, "lottie")))
    if (f.endsWith(".json"))
      sources.push(
        new LottieConverter().convert(
          JSON.parse(readFileSync(join(EXAMPLES, "lottie", f), "utf8")),
        ),
      );
  for (const f of readdirSync(join(EXAMPLES, "svg")))
    if (f.endsWith(".svg"))
      sources.push(
        new SvgConverter().convert(
          readFileSync(join(EXAMPLES, "svg", f), "utf8"),
        ),
      );
  const out: string[] = [];
  for (const src of sources)
    for (const m of src.matchAll(QUOTED)) out.push(m[1] ?? m[2]);
  return out;
}

const numericFields = (c: PathCommand): [string, number][] =>
  Object.entries(c).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );

test("player parses crush-compacted paths to the same commands within 0.005", () => {
  const paths = corpusPaths();
  expect(paths.length).toBeGreaterThan(500);
  let before = 0;
  let after = 0;
  for (const d of paths) {
    const compact = compactPath(d);
    before += d.length;
    after += compact.length;
    const a = parsePath(d);
    const b = parsePath(compact);
    expect(
      b.map((c) => c.type),
      d,
    ).toEqual(a.map((c) => c.type));
    a.forEach((c, i) => {
      const other = b[i] as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(c))
        if (typeof v !== "number") expect(other[k], d).toBe(v);
      for (const [k, v] of numericFields(c)) {
        const diff = Math.abs((other[k] as number) - v);
        if (diff > 0.005 + 1e-9)
          throw new Error(
            `${d}\n→ ${compact}\ncommand ${i}.${k}: ${v} vs ${other[k]}`,
          );
      }
    });
  }
  expect(after).toBeLessThan(before * 0.8);
});
