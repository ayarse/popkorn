import { describe, expect, test } from "bun:test";
import { normalize, similarity } from "@/lib/scene-dedupe";

// Sized like a real scene: the trigram ratio is only meaningful against a body
// of source, and every scene the gate ever sees is kilobytes of it.
const SCENE = `
/* a comment */
:root { width: 400px; height: 300px; background: #101020; }
#dot { shape: circle; width: 40px; height: 40px; background: #f0f; }
#bar { shape: rect; width: 100px; height: 10px; background: #0ff; }
${Array.from(
  { length: 40 },
  (_, i) =>
    `#n${i} { shape: rect; x: ${i * 7}px; y: ${i * 3}px; width: 12px; height: 12px; background: #2${i % 10}4${i % 7}6${i % 5}; }`,
).join("\n")}
`;

describe("normalize", () => {
  test("collapses comments and formatting", () => {
    const reformatted = SCENE.replace(/\/\*[\s\S]*?\*\//, "")
      .replace(/\n/g, "\n\n")
      .replace(/; /g, ";   ");
    expect(normalize(reformatted)).toBe(normalize(SCENE));
  });
});

describe("similarity", () => {
  test("identical sources score 1", () => {
    expect(similarity(normalize(SCENE), normalize(SCENE))).toBe(1);
  });

  test("a one-value tweak still reads as a near-duplicate", () => {
    const nudged = SCENE.replace("#f0f", "#f0e");
    expect(similarity(normalize(SCENE), normalize(nudged))).toBeGreaterThan(
      0.95,
    );
  });

  test("a genuinely different scene does not", () => {
    const other = `
      :root { width: 800px; height: 600px; background: #fff; }
      #ring { shape: ellipse; width: 200px; height: 120px; border: 4px solid #333; }
      @keyframes spin { from { rotate: 0deg } to { rotate: 360deg } }
    `;
    expect(similarity(normalize(SCENE), normalize(other))).toBeLessThan(0.95);
  });

  test("very different lengths short-circuit to 0", () => {
    expect(similarity("a".repeat(100), "a".repeat(1000))).toBe(0);
  });
});
