export type EditBlock = {
  search: string;
  replace: string;
  replaceAll?: boolean;
};

export type ApplyResult =
  | { ok: true; result: string; counts: number[] }
  | { ok: false; error: string };

export function applyEdits(source: string, edits: EditBlock[]): ApplyResult {
  let result = source;
  const counts: number[] = [];
  for (let i = 0; i < edits.length; i++) {
    const { search, replace, replaceAll } = edits[i];
    const miss = {
      ok: false as const,
      error: `Edit block ${i + 1} didn't match the scene — not applied`,
    };
    if (replaceAll) {
      if (search === "" || !result.includes(search)) return miss;
      const parts = result.split(search);
      counts.push(parts.length - 1);
      result = parts.join(replace);
      continue;
    }
    const at = result.indexOf(search);
    if (search === "" || at === -1 || result.indexOf(search, at + 1) !== -1) {
      return miss;
    }
    result = result.slice(0, at) + replace + result.slice(at + search.length);
    counts.push(1);
  }
  return { ok: true, result, counts };
}
