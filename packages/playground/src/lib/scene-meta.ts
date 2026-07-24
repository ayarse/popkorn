/**
 * Playground-only convention, NOT part of the Popkorn format: WordPress-style
 * `Key: Value` lines in the *first* comment block of a scene file (currently
 * just `Author` / `Author URL`, shown as the player's attribution badge).
 */
export function parseSceneMeta(source: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const block = source.match(/^\s*\/\*([\s\S]*?)\*\//)?.[1] ?? "";
  for (const line of block.split("\n")) {
    const m = line.match(/^[\s*]*([A-Z][A-Za-z ]{0,20}):\s*(\S.*?)\s*$/);
    if (m) meta[m[1]] = m[2];
  }
  return meta;
}
