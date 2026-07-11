import {
  type Declaration,
  type KeyframeRule,
  parse,
  type Rule,
} from "@popkorn/parser";

// Span-based source edits for the editor timeline. Each function re-parses the
// current source, locates the target node via the new AST spans, and splices
// the source text in place — never regenerating unrelated regions. Every result
// is re-parsed and only returned `ok` when it introduces no new error-severity
// diagnostic (the validate-before-commit pattern from lib/agent-tools.ts).

export type TimelineEditResult =
  | { ok: true; source: string }
  | { ok: false; error: string };

// --- generic text-splice plumbing --------------------------------------------

interface Splice {
  start: number;
  end: number;
  text: string;
}

/** Apply splices right-to-left so earlier offsets stay valid as we edit. */
function applySplices(source: string, splices: Splice[]): string {
  let out = source;
  for (const s of [...splices].sort((a, b) => b.start - a.start))
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return out;
}

const fail = (error: string): TimelineEditResult => ({ ok: false, error });
const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/** Whole (CSS-ident-aware) word match — `-` counts as part of an identifier. */
function includesName(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\w-])${escapeRe(name)}([^\\w-]|$)`).test(text);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A time value (ms) as `123ms` or `1.5s`, in the requested unit. */
function formatTime(ms: number, unit: "s" | "ms"): string {
  return unit === "s" ? `${round2(ms / 1000)}s` : `${round2(ms)}ms`;
}

/** Detect the time unit an existing value text is written in (defaults to ms). */
function unitOf(text: string): "s" | "ms" {
  const t = text.trim();
  return /ms$/.test(t) ? "ms" : /s$/.test(t) ? "s" : "ms";
}

const TIME_RE = /(-?\d*\.?\d+)(ms|s)\b/g;

/** Split a value string on top-level commas (parens shield inner commas). */
function splitTopLevel(s: string): { text: string; start: number }[] {
  const items: { text: string; start: number }[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      items.push({ text: s.slice(last, i), start: last });
      last = i + 1;
    }
  }
  items.push({ text: s.slice(last), start: last });
  return items;
}

// --- selector resolution -----------------------------------------------------

/** Canonical selector text for a rule, matching the timeline's node label. */
function ruleSelText(rule: Rule): string {
  const s = rule.selector;
  if (s.type === "id") return `#${s.name}`;
  if (s.type === "class") return `.${s.name}`;
  return s.name; // root
}

interface ParsedSelector {
  base: string;
  state?: { machine: string | null; name: string };
}

function parseSelectorArg(selector: string): ParsedSelector {
  const norm = selector.trim();
  const idx = norm.indexOf(":state(");
  if (idx === -1) return { base: norm.replace(/\s+/g, "") };
  const base = norm.slice(0, idx).replace(/\s+/g, "");
  const inner = norm.slice(idx + 7, norm.lastIndexOf(")")).trim();
  const dot = inner.indexOf(".");
  const state =
    dot === -1
      ? { machine: null, name: inner }
      : { machine: inner.slice(0, dot), name: inner.slice(dot + 1) };
  return { base, state };
}

/** Depth-first search for the rule whose canonical selector equals `base`. */
function findRule(rules: Rule[], base: string): Rule | null {
  for (const r of rules) {
    if (ruleSelText(r) === base) return r;
    const inChild = findRule(r.children, base);
    if (inChild) return inChild;
    for (const st of r.states) {
      const inState = findRule(st.children, base);
      if (inState) return inState;
    }
  }
  return null;
}

/** The declaration list of the rule/`:state()` block named by `selector`. */
function resolveDeclarations(
  rules: Rule[],
  selector: string,
): { declarations: Declaration[] } | { error: string } {
  const parsed = parseSelectorArg(selector);
  const rule = findRule(rules, parsed.base);
  if (!rule) return { error: `no rule matches selector '${parsed.base}'` };
  if (!parsed.state) return { declarations: rule.declarations };
  const sr = rule.states.find(
    (st) =>
      st.state === "state" &&
      st.machineState &&
      st.machineState.name === parsed.state!.name &&
      (parsed.state!.machine === null ||
        st.machineState.machine === parsed.state!.machine),
  );
  if (!sr)
    return {
      error: `no :state(${parsed.state.machine ? `${parsed.state.machine}.` : ""}${parsed.state.name}) block on '${parsed.base}'`,
    };
  return { declarations: sr.declarations };
}

// --- validation gate ---------------------------------------------------------

/** Re-parse the edited source; accept only if it adds no error-severity diag. */
function commitValidated(
  edited: string,
  errsBefore: number,
): TimelineEditResult {
  let errsAfter: number;
  try {
    errsAfter = parse(edited).diagnostics.filter(
      (d) => d.severity === "error",
    ).length;
  } catch (e) {
    return fail(
      `edit produced unparseable source: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (errsAfter > errsBefore)
    return fail("edit introduced a parse error; not applied");
  return { ok: true, source: edited };
}

// --- retimeAnimation ---------------------------------------------------------

interface RetimeChanges {
  delay?: number;
  duration?: number;
}

/** Build splices that retime an `animation:` shorthand item. */
function shorthandSplices(
  source: string,
  decl: Declaration,
  animationName: string,
  changes: RetimeChanges,
): { splices: Splice[] } | { error: string } {
  const vs = decl.valueSpan;
  const valueText = source.slice(vs.start, vs.end);
  const item = splitTopLevel(valueText).find((it) =>
    includesName(it.text, animationName),
  );
  if (!item)
    return { error: `animation '${animationName}' not found in shorthand` };
  const base = vs.start + item.start;
  const times = [...item.text.matchAll(TIME_RE)];
  const splices: Splice[] = [];

  const nameMatch = new RegExp(
    `(^|[^\\w-])(${escapeRe(animationName)})([^\\w-]|$)`,
  ).exec(item.text);
  const nameEnd = nameMatch
    ? nameMatch.index + nameMatch[1].length + nameMatch[2].length
    : item.text.length;
  const anchor = base + nameEnd;

  // Both times absent: insert `<duration> <delay>` as one token pair after the
  // name, so duration-before-delay order is guaranteed.
  if (!times.length && changes.duration !== undefined) {
    const parts = [formatTime(changes.duration, "ms")];
    if (changes.delay !== undefined)
      parts.push(formatTime(changes.delay, "ms"));
    return {
      splices: [{ start: anchor, end: anchor, text: ` ${parts.join(" ")}` }],
    };
  }

  if (changes.duration !== undefined) {
    const t = times[0];
    if (t)
      splices.push({
        start: base + t.index!,
        end: base + t.index! + t[0].length,
        text: formatTime(changes.duration, t[2] as "s" | "ms"),
      });
    else
      splices.push({
        start: anchor,
        end: anchor,
        text: ` ${formatTime(changes.duration, "ms")}`,
      });
  }
  if (changes.delay !== undefined) {
    const t2 = times[1];
    if (t2)
      splices.push({
        start: base + t2.index!,
        end: base + t2.index! + t2[0].length,
        text: formatTime(changes.delay, t2[2] as "s" | "ms"),
      });
    else if (times[0]) {
      const after = base + times[0].index! + times[0][0].length;
      splices.push({
        start: after,
        end: after,
        text: ` ${formatTime(changes.delay, "ms")}`,
      });
    } else {
      return {
        error: `cannot set delay on '${animationName}': shorthand has no duration`,
      };
    }
  }
  return { splices };
}

/** Insert `<indent><prop>: <value>;` on its own line after `anchor`. */
function insertLonghand(
  source: string,
  anchor: Declaration,
  prop: string,
  value: string,
): Splice {
  // Line indent of the anchor declaration.
  let ls = anchor.span.start;
  while (ls > 0 && source[ls - 1] !== "\n") ls--;
  let indent = "";
  for (let i = ls; source[i] === " " || source[i] === "\t"; i++)
    indent += source[i];
  // Insert after the anchor's terminating `;` (span excludes it).
  let p = anchor.span.end;
  let q = p;
  while (q < source.length && /\s/.test(source[q])) q++;
  if (source[q] === ";") p = q + 1;
  return { start: p, end: p, text: `\n${indent}${prop}: ${value};` };
}

/**
 * Rewrite `animation-delay` and/or `animation-duration` for the animation named
 * `animationName` on the rule/`:state()` block matching `selector`. Handles the
 * `animation:` shorthand and longhand declarations, and inserts a longhand
 * declaration when the property is absent.
 */
export function retimeAnimation(
  source: string,
  selector: string,
  animationName: string,
  changes: RetimeChanges,
): TimelineEditResult {
  if (changes.delay === undefined && changes.duration === undefined)
    return fail("no changes requested");

  let errsBefore: number;
  let rules: Rule[];
  try {
    const sheet = parse(source);
    errsBefore = sheet.diagnostics.filter((d) => d.severity === "error").length;
    rules = sheet.rules;
  } catch (e) {
    return fail(
      `current source does not parse: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const resolved = resolveDeclarations(rules, selector);
  if ("error" in resolved) return fail(resolved.error);
  const decls = resolved.declarations;

  const shorthand = decls.find(
    (d) =>
      d.property === "animation" &&
      includesName(
        source.slice(d.valueSpan.start, d.valueSpan.end),
        animationName,
      ),
  );

  let splices: Splice[];
  if (shorthand) {
    const r = shorthandSplices(source, shorthand, animationName, changes);
    if ("error" in r) return fail(r.error);
    splices = r.splices;
  } else {
    // Longhand: anchored by an `animation-name` declaring this animation.
    // NOTE: single-animation longhand only; comma-listed longhand would need
    // per-index targeting, which no timeline scene uses today.
    const nameDecl = decls.find(
      (d) =>
        d.property === "animation-name" &&
        includesName(
          source.slice(d.valueSpan.start, d.valueSpan.end),
          animationName,
        ),
    );
    if (!nameDecl)
      return fail(`animation '${animationName}' not found on '${selector}'`);
    splices = [];
    const each: [keyof RetimeChanges, string][] = [
      ["duration", "animation-duration"],
      ["delay", "animation-delay"],
    ];
    for (const [key, prop] of each) {
      const ms = changes[key];
      if (ms === undefined) continue;
      const existing = decls.find((d) => d.property === prop);
      if (existing) {
        const cur = source.slice(
          existing.valueSpan.start,
          existing.valueSpan.end,
        );
        splices.push({
          start: existing.valueSpan.start,
          end: existing.valueSpan.end,
          text: formatTime(ms, unitOf(cur)),
        });
      } else {
        splices.push(
          insertLonghand(source, nameDecl, prop, formatTime(ms, "ms")),
        );
      }
    }
  }

  return commitValidated(applySplices(source, splices), errsBefore);
}

// --- moveKeyframe ------------------------------------------------------------

/**
 * Move one keyframe block of `@keyframes name` from `oldOffset` (0..1) to
 * `newOffset` by rewriting its `%` selector. When the block lists several
 * selectors, only the matching one is rewritten. Rejected when `newOffset`
 * would collide with a different block's selector.
 */
export function moveKeyframe(
  source: string,
  name: string,
  oldOffset: number,
  newOffset: number,
): TimelineEditResult {
  let errsBefore: number;
  let kf: KeyframeRule | undefined;
  try {
    const sheet = parse(source);
    errsBefore = sheet.diagnostics.filter((d) => d.severity === "error").length;
    kf = sheet.keyframes.find((k) => k.name === name);
  } catch (e) {
    return fail(
      `current source does not parse: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!kf) return fail(`@keyframes '${name}' not found`);

  const oldPct = round2(oldOffset * 100);
  const newPct = round2(newOffset * 100);
  const approx = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;

  let target: { block: KeyframeRule["blocks"][number]; index: number } | null =
    null;
  for (const b of kf.blocks) {
    const i = b.selectors.findIndex((s) => approx(s, oldPct));
    if (i !== -1) {
      target = { block: b, index: i };
      break;
    }
  }
  if (!target) return fail(`no keyframe at ${oldPct}% in @keyframes '${name}'`);

  // Collision: any other selector (in any block) already sits at newPct.
  for (const b of kf.blocks)
    for (let i = 0; i < b.selectors.length; i++) {
      if (b === target.block && i === target.index) continue;
      if (approx(b.selectors[i], newPct))
        return fail(`a keyframe already sits at ${newPct}%`);
    }

  // Rewrite the matching selector token inside the block's selector-list text.
  const { block, index } = target;
  const selText = source.slice(
    block.selectorSpan.start,
    block.selectorSpan.end,
  );
  const item = splitTopLevel(selText)[index];
  const lead = item.text.length - item.text.trimStart().length;
  const core = item.text.trim();
  const absStart = block.selectorSpan.start + item.start + lead;
  const edited =
    source.slice(0, absStart) +
    `${round2(newPct)}%` +
    source.slice(absStart + core.length);

  return commitValidated(edited, errsBefore);
}
