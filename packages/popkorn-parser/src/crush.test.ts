import { expect, test } from "bun:test";
import { parse } from "./parser.js";
import { serialize } from "./serializer.js";

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

test("crush output re-parses without errors", () => {
  const src = `
    :root { width: 100px; height: 100px; --c: #0f0; }
    @keyframes k { 0% { opacity: 0; } 100% { opacity: 1; } }
    #a { type: rect; width: 10px; fill: var(--c); animation: k 1s; }
  `;
  const out = crush(src);
  const reparsed = parse(out);
  expect(reparsed.diagnostics.filter((d) => d.severity === "error")).toEqual(
    [],
  );
});

test("crush renames var() uses inside random() operands", () => {
  const out = crush(`
    :root { --lo: 1px; }
    #x { type: circle; r: random(var(--lo), var(--host-hi)); }
  `);
  expect(out).not.toContain("--lo");
  expect(out).not.toContain("--host-hi");
});

const kfNames = (out: string) =>
  [...out.matchAll(/@keyframes ([a-z]+)\{/g)].map((m) => m[1]);

test("crush merges identical @keyframes and repoints every reference", () => {
  const out = crush(`
    @keyframes fadeA { 0% { opacity: 0; } 100% { opacity: 1; } }
    @keyframes fadeB { 0% { opacity: 0; } 100% { opacity: 1; } }
    @keyframes fadeC { 0% { opacity: 0; } 100% { opacity: 1; } }
    @keyframes fadeD { 0% { opacity: 0; } 100% { opacity: 1; } }
    @define sym { type: circle; r: 2px; animation: fadeD 1s; }
    #x { type: rect; animation: fadeB 2s linear; }
    #y { type: rect; animation-name: fadeC; animation-duration: 1s;
      &:hover { animation: fadeB 3s; } }
    #z { use: sym; }
  `);
  const names = kfNames(out);
  expect(names).toHaveLength(1);
  const k = names[0]!;
  expect(out).toContain(`animation:${k} 2s linear`);
  expect(out).toContain(`animation-name:${k}`);
  expect(out).toContain(`&:hover{animation:${k} 3s}`);
  expect(out).toContain(`animation:${k} 1s`);
  expect(out).not.toMatch(/fade/);
});

test("crush keeps @keyframes whose bodies differ", () => {
  const out = crush(`
    @keyframes a1 { 0% { opacity: 0; } 100% { opacity: 1; } }
    @keyframes a2 { 0% { opacity: 0; } 100% { opacity: 0.5; } }
    @keyframes a3 { 0% { opacity: 0; } 50% { opacity: 1; } }
    @keyframes a4 { 0% { opacity: 0; animation-timing-function: ease-in; } 100% { opacity: 1; } }
    #x { type: rect; animation: a1 1s, a2 1s, a3 1s, a4 1s; }
  `);
  expect(kfNames(out)).toHaveLength(4);
});

test("crush compares keyframe bodies after var renaming", () => {
  const out = crush(`
    :root { --p: 1; --q: 2; }
    @keyframes a1 { 0% { opacity: var(--p); } }
    @keyframes a2 { 0% { opacity: var(--q); } }
    @keyframes a3 { 0% { opacity: var(--p); } }
    #x { type: rect; animation: a1 1s, a2 1s, a3 1s; }
  `);
  const names = kfNames(out);
  expect(names).toHaveLength(2);
  expect(out).toContain(
    `animation:${names[0]} 1s,${names[1]} 1s,${names[0]} 1s`,
  );
});

test("crush keyframe merge respects later-wins redefinition", () => {
  const out = crush(`
    @keyframes a { 0% { opacity: 0; } }
    @keyframes b { 0% { opacity: 1; } }
    @keyframes a { 0% { opacity: 1; } }
    #x { type: rect; animation: a 1s, b 1s; }
  `);
  // `a`'s effective body equals `b`: both references collapse onto one survivor.
  const names = kfNames(out);
  expect(names).toHaveLength(2);
  expect(new Set(names).size).toBe(1);
  expect(out).toContain(`animation:${names[0]} 1s,${names[0]} 1s`);
  expect(out.lastIndexOf("opacity:1")).toBeGreaterThan(
    out.indexOf("opacity:0"),
  );
});

test("crush keyframe merge is deterministic and keeps the first occurrence", () => {
  const src = `
    @keyframes b { 0% { opacity: 1; } }
    @keyframes a { 0% { opacity: 1; } }
    #x { type: rect; animation: a 1s; }
  `;
  const out = crush(src);
  expect(out).toBe(crush(src));
  expect(kfNames(out)).toEqual(["a"]);
  expect(out).toContain("animation:a 1s");
});

test("crush compacts path data in d, keyframes, offset-path and clip-path", () => {
  const out = crush(`
    @keyframes m { 0% { d: 'M 0 0 L 10.004 0 L 10 10 Z'; } }
    #x { type: path; d: 'M 0 0 L 10.004 0 L 10 10 Z'; animation: m 1s;
      offset-path: path('M 0 0 C 50 0 100 50 100 100');
      clip-path: path('M 0 0 H 100 V 100 H 0 Z') path('M 5 5 H 6 V 6 Z'); }
  `);
  expect(out).toContain('d:"m0 0 10 0 0 10z"');
  expect(out).toContain('offset-path:path("m0 0c50 0 100 50 100 100")');
  expect(out).toContain('clip-path:path("m0 0h100v100H0z") path("m5 5h1v1z")');
});

test("crush leaves non-path strings alone", () => {
  const out = crush(`
    :root { --t: 'M 1 2 L 3 4'; }
    #x { type: text; content: 'M 1 2 L 3 4'; font-family: 'M 1 2'; }
    #y { type: text; content: var(--t); }
    #z { type: path; d: var(--t); }
  `);
  expect(out).toContain('content:"M 1 2 L 3 4"');
  expect(out).toContain('font-family:"M 1 2"');
  // --t is also text content, so it is neither compacted nor inlined.
  expect(out).toMatch(/--[a-z]+:"M 1 2 L 3 4"/);
});

test("crush inlines a :root path var referenced exactly once", () => {
  const out = crush(`
    :root { --once: 'M 0 0 L 10 10'; --twice: 'M 0 0 L 20 20'; }
    @keyframes k { 0% { d: var(--twice); } }
    #a { type: path; d: var(--once); }
    #b { type: path; d: var(--twice); animation: k 1s; }
  `);
  expect(out).toContain('d:"m0 0 10 10"');
  expect(out).not.toContain('"m0 0 10 10";');
  // Two references: kept as a (compacted) var.
  expect(out).toMatch(/--[a-z]+:"m0 0 20 20"/);
  expect(out).toMatch(/d:var\(--[a-z]+\)/);
});

test("crush follows var aliases into path positions", () => {
  const out = crush(`
    :root { --base: 'M 0 0 L 10 10'; --alias: var(--base); }
    #a { type: path; d: var(--alias); }
    #b { type: path; d: var(--alias); }
  `);
  // --base's only use is the path var --alias: compacted and inlined into it.
  expect(out).toMatch(/--[a-z]+:"m0 0 10 10"/);
  expect(out).not.toContain("M 0 0");
});

test("crush does not inline overridden, reactive or guard-read path vars", () => {
  const out = crush(`
    :root { --o: 'M 0 0 L 1 1'; --g: 'M 0 0 L 2 2'; }
    #a { type: path; d: var(--o); }
    #b { type: group; --o: 'M 0 0 L 3 3'; }
    #c { type: path; d: var(--g); }
    @machine m { initial: s; state s { to: s on click(#c) when style(--g = 1); } }
  `);
  expect(out).toMatch(/--[a-z]+:"m0 0 1 1"/);
  expect(out).toMatch(/--[a-z]+:"m0 0 3 3"/);
  expect(out).toMatch(/--[a-z]+:"M 0 0 L 2 2"/);
});

test("crush inlines a path var whose other refs sit in merged duplicate @keyframes", () => {
  const out = crush(`
    :root { --p: 'M 0 0 L 10 10'; }
    @keyframes k1 { 0% { d: var(--p); } }
    @keyframes k2 { 0% { d: var(--p); } }
    #a { type: path; animation: k1 1s; }
    #b { type: path; animation: k2 1s; }
  `);
  expect(kfNames(out)).toHaveLength(1);
  expect(out).toContain('d:"m0 0 10 10"');
  expect(out).not.toContain("var(");
});
