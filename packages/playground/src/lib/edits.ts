export type EditBlock = { search: string; replace: string };

export type ApplyResult =
  | { ok: true; result: string }
  | { ok: false; error: string };

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
