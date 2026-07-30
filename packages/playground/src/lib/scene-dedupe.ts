import { parse, serialize } from "@popkorn/parser";

/**
 * Collapses a scene to its rendered meaning: minified, so comments, whitespace
 * and formatting differences all normalize away. Two sources with the same
 * normal form are the same scene.
 */
export function normalize(css: string): string {
  return serialize(parse(css), { minify: true });
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

const trigrams = (s: string): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
};

/**
 * Jaccard similarity over character trigrams, in [0, 1]. Catches the
 * one-character-edit resubmission that an exact hash misses.
 *
 * ponytail: trigram overlap, not edit distance — Levenshtein over 100KB scenes
 * is quadratic and this only has to separate "same scene, nudged" from "new
 * scene". Swap in a proper diff if the threshold ever needs to be fine-grained.
 */
export function similarity(a: string, b: string): number {
  // Length prefilter: nothing near-identical differs in size by more than 10%.
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length, 1);
  if (ratio < 0.9) return 0;

  const A = trigrams(a);
  const B = trigrams(b);
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const union = A.size + B.size - shared;
  return union === 0 ? 1 : shared / union;
}
