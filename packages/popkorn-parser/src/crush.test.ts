import { expect, test } from "bun:test";
import { crushSource } from "./index";
import { parse } from "./parser";
import { serialize } from "./serializer";

const crush = (src: string) => serialize(parse(src), { crush: true });

test("crush implies minify and shortens identifiers", () => {
  const out = crush(`
    #hero { type: circle; r: 10px; }
    #hero2 { type: rect; width: 5px; }
  `);
  expect(out).not.toContain("hero");
  expect(out).toContain("#a");
  expect(out).toContain("#b");
  // minified: no newlines / no ": " spacing
  expect(out).not.toContain("\n");
  expect(out).not.toContain(": ");
});

test("crush renames custom properties consistently at def and use", () => {
  const out = crush(`
    :root { --brand: #f00; }
    #x { type: rect; fill: var(--brand); }
  `);
  expect(out).not.toContain("--brand");
  // Whatever short name the var got, the def and the var() use must match.
  const m = out.match(/--([a-z]+):#f00/);
  expect(m).not.toBeNull();
  expect(out).toContain(`var(--${m![1]})`);
});

test("crush renames @keyframes and its animation reference together", () => {
  const out = crush(`
    @keyframes spin { 0% { rotate: 0deg; } 100% { rotate: 360deg; } }
    #x { type: rect; animation: spin 2s linear infinite; }
  `);
  expect(out).not.toContain("spin");
  const m = out.match(/@keyframes ([a-z]+)\{/);
  expect(m).not.toBeNull();
  // Reserved timing keywords are preserved verbatim in the shorthand.
  expect(out).toContain("linear");
  expect(out).toContain("infinite");
  // The animation shorthand references the crushed keyframes name.
  expect(out).toContain(`${m![1]} 2s`);
});

test("crush renames @define symbol and its use: reference together", () => {
  const out = crush(`
    @define starsym { type: star; points: 5; }
    #x { use: starsym; }
  `);
  expect(out).not.toContain("starsym");
  const m = out.match(/@define ([a-z]+)\{/);
  expect(m).not.toBeNull();
  expect(out).toContain(`use:${m![1]}`);
});

test("crush renames an id and its mask reference together", () => {
  const out = crush(`
    #cutter { type: circle; r: 8px; }
    #box { type: rect; width: 20px; height: 20px; mask: #cutter alpha; }
  `);
  expect(out).not.toContain("cutter");
  // The mask value points at the crushed id (as #id, whichever short name).
  expect(out).toMatch(/mask:#[a-z]+ alpha/);
});

test("crush preserves machine/state/emit names and input() paths", () => {
  const out = crush(`
    :root { --t: 0; }
    #hero { type: circle; r: 4px; }
    @machine m {
      initial: idle;
      state idle { to: run on click(#hero) when style(--t > 5); emit: started; }
      state run { to: idle on complete; }
    }
  `);
  expect(out).toContain("@machine m");
  expect(out).toContain("idle");
  expect(out).toContain("run");
  expect(out).toContain("started");
  // The guard var and pointer target still track the crushed names.
  expect(out).not.toContain("--t");
  expect(out).not.toContain("#hero");
});

test("crush renames a var() used in per-keyframe animation-timing-function", () => {
  const src = `
    :root { --e0: cubic-bezier(0.2, 0, 0, 1); }
    @keyframes spin {
      0% { rotate: 0deg; animation-timing-function: var(--e0); }
      100% { rotate: 360deg; }
    }
    #x { type: rect; animation: spin 2s; }
  `;
  const out = crush(src);
  expect(out).not.toContain("--e0");
  // The var() use inside the keyframe block must track the renamed --e0.
  const m = out.match(/--([a-z]+):cubic-bezier/);
  expect(m).not.toBeNull();
  expect(out).toContain(`var(--${m![1]})`);

  const reparsed = parse(out);
  const undefinedVarDiags = reparsed.diagnostics.filter(
    (d) => d.severity === "error" && /undefined/i.test(d.message),
  );
  expect(undefinedVarDiags).toEqual([]);
});

test("crush output re-parses without errors (crushSource)", () => {
  const src = `
    :root { width: 100px; height: 100px; --c: #0f0; }
    @keyframes k { 0% { opacity: 0; } 100% { opacity: 1; } }
    #a { type: rect; width: 10px; fill: var(--c); animation: k 1s; }
  `;
  const out = crushSource(src);
  const reparsed = parse(out);
  expect(reparsed.diagnostics.filter((d) => d.severity === "error")).toEqual(
    [],
  );
});
