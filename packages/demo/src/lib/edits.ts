export type EditBlock = { search: string; replace: string };

export type ApplyResult =
  | { ok: true; result: string }
  | { ok: false; error: string };

export function extractEdits(text: string): EditBlock[] {
  const blocks: EditBlock[] = [];
  const fence = /```edit\s*\n([\s\S]*?)```/g;
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    const inner = m[1].match(
      /<<<<<<<\n?([\s\S]*?)\n?=======\n?([\s\S]*?)\n?>>>>>>>/,
    );
    if (inner) blocks.push({ search: inner[1], replace: inner[2] });
  }
  return blocks;
}

export function applyEdits(source: string, edits: EditBlock[]): ApplyResult {
  let result = source;
  for (let i = 0; i < edits.length; i++) {
    const { search, replace } = edits[i];
    const at = result.indexOf(search);
    if (search === "" || at === -1 || result.indexOf(search, at + 1) !== -1) {
      return {
        ok: false,
        error: `Edit block ${i + 1} didn't match the scene — not applied`,
      };
    }
    result = result.slice(0, at) + replace + result.slice(at + search.length);
  }
  return { ok: true, result };
}
