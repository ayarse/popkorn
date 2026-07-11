import { parse, serialize } from "@popkorn/parser";

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

export function pct(lottie: number, popkorn: number): number {
  if (lottie === 0) return 0;
  return ((popkorn - lottie) / lottie) * 100;
}

export function fmtPct(d: number): string {
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
}

export type SizePair = { lottie: number; popkorn: number };
export type SizeDelta = { before: number; after: number };

export type ImportResult = {
  format: string; // source-format label for the size columns ("Lottie" / "SVG")
  label: string;
  warnings: string[];
  blocked: string[];
  raw: SizePair;
  min?: SizePair;
  gz?: SizePair;
  // Gzipped size with the popkorn side additionally crushed (identifiers
  // renamed) — the smallest wire size the format reaches. Source side mirrors
  // `gz.lottie` so the row compares against the same source bytes.
  crushGz?: SizePair;
};

export function buildImportResult(
  format: string,
  label: string,
  rawSource: string,
  css: string,
): ImportResult {
  const raw: SizePair = { lottie: bytes(rawSource), popkorn: bytes(css) };
  let min: SizePair | undefined;
  // Only Lottie has a JSON-minify step; SVG skips the minified row.
  if (format === "Lottie") {
    try {
      min = {
        lottie: bytes(JSON.stringify(JSON.parse(rawSource))),
        popkorn: bytes(serialize(parse(css), { minify: true })),
      };
    } catch {
      // Degrade to unminified sizes only rather than breaking the import.
    }
  }
  return { format, label, warnings: [], blocked: [], raw, min };
}

// Gzipped transfer size of the minified forms (what actually ships over the
// wire), plus the crushed form (identifiers renamed) as the achievable floor.
// Async because CompressionStream is; the rows fill in once resolved.
export async function gzipSizes(
  format: string,
  rawSource: string,
  css: string,
): Promise<{ gz: SizePair; crushGz: SizePair } | undefined> {
  try {
    // Lottie ships as minified JSON; SVG ships as-is.
    const source =
      format === "Lottie" ? JSON.stringify(JSON.parse(rawSource)) : rawSource;
    const sheet = parse(css);
    const [srcGz, minGz, crushGz] = await Promise.all([
      gzipBytes(source),
      gzipBytes(serialize(sheet, { minify: true })),
      gzipBytes(serialize(sheet, { crush: true })),
    ]);
    return {
      gz: { lottie: srcGz, popkorn: minGz },
      crushGz: { lottie: srcGz, popkorn: crushGz },
    };
  } catch {
    return undefined;
  }
}
