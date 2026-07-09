import { parse, serialize } from "@popcorn/parser";

const enc = new TextEncoder();
export const bytes = (s: string) => enc.encode(s).length;

async function gzipBytes(s: string): Promise<number> {
  const stream = new Blob([s])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function pct(lottie: number, popcorn: number): number {
  if (lottie === 0) return 0;
  return ((popcorn - lottie) / lottie) * 100;
}

export function fmtPct(d: number): string {
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
}

export type SizePair = { lottie: number; popcorn: number };
export type SizeDelta = { before: number; after: number };

export type ImportResult = {
  format: string; // source-format label for the size columns ("Lottie" / "SVG")
  label: string;
  warnings: string[];
  blocked: string[];
  raw: SizePair;
  min?: SizePair;
  gz?: SizePair;
};

export function buildImportResult(
  format: string,
  label: string,
  rawSource: string,
  css: string,
): ImportResult {
  const raw: SizePair = { lottie: bytes(rawSource), popcorn: bytes(css) };
  let min: SizePair | undefined;
  // Only Lottie has a JSON-minify step; SVG skips the minified row.
  if (format === "Lottie") {
    try {
      min = {
        lottie: bytes(JSON.stringify(JSON.parse(rawSource))),
        popcorn: bytes(serialize(parse(css), { minify: true })),
      };
    } catch {
      // Degrade to unminified sizes only rather than breaking the import.
    }
  }
  return { format, label, warnings: [], blocked: [], raw, min };
}

// Gzipped transfer size of the minified forms (what actually ships over the
// wire). Async because CompressionStream is; the row fills in once resolved.
export async function gzipSizes(
  format: string,
  rawSource: string,
  css: string,
): Promise<SizePair | undefined> {
  try {
    // Lottie ships as minified JSON; SVG ships as-is.
    const source =
      format === "Lottie" ? JSON.stringify(JSON.parse(rawSource)) : rawSource;
    const [lottie, popcorn] = await Promise.all([
      gzipBytes(source),
      gzipBytes(serialize(parse(css), { minify: true })),
    ]);
    return { lottie, popcorn };
  } catch {
    return undefined;
  }
}
