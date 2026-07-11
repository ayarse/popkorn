/**
 * Internal helpers shared by the Lottie and SVG converter cores.
 *
 * Both converters emit Popkorn CSS from a normalized IR and grew byte-identical
 * copies of these formatting/serialization/validation utilities; extracted here
 * so the two stay in lockstep. Browser-safe — no Node builtins.
 */
import { parse } from "@popkorn/parser";
import { buildSceneGraph } from "@popkorn/player";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Round to `dec` decimals, kill -0/NaN/Inf, no scientific notation. */
export function num(x: number, dec = 2): string {
  if (!isFinite(x)) x = 0;
  const p = 10 ** dec;
  let r = Math.round(x * p) / p;
  if (Object.is(r, -0)) r = 0;
  return String(r);
}

/**
 * [r,g,b] as 0..255 ints + alpha 0..1 -> `#rrggbb` (opaque) / `rgba()`.
 * Hex components clamp to 0..255; the rgba path rounds only (callers normalize
 * their inputs), matching the two prior hand-copied emitters exactly.
 */
export function emitColor(r: number, g: number, b: number, a: number): string {
  if (a >= 0.999) {
    const hex = (n: number) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${num(a, 3)})`;
}

// ---------------------------------------------------------------------------
// Identifiers & warnings
// ---------------------------------------------------------------------------

/**
 * Sanitize an arbitrary name to a valid DSL ident body: ascii word chars only,
 * no leading/trailing dashes. Callers apply their own leading-char fallback and
 * collision-suffix loop.
 */
export function sanitizeIdent(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Append `msg` to `warnings` unless already present. */
export function warnOnce(warnings: string[], msg: string): void {
  if (!warnings.includes(msg)) warnings.push(msg);
}

// ---------------------------------------------------------------------------
// Emitted rule tree + serialization
// ---------------------------------------------------------------------------

/** The subset of an emitted animation spec the serializer reads. */
export interface SerializableAnim {
  name: string;
  durationSec: number;
  delaySec: number;
  defaultEasing: string;
}

/**
 * An emitted rule tree node. Lottie extends this with a required `channels`
 * accumulator and its richer `AnimSpec`; SVG uses it as-is (no anims).
 */
export interface Rule {
  id: string;
  type: string; // group | rect | circle | ellipse | path
  decls: string[];
  children: Rule[];
  // One anim per animated channel, so each keeps its own keyframe times and
  // per-segment easing (emitted as a comma-separated `animation:` list).
  anims?: SerializableAnim[];
}

export function serializeRule(rule: Rule, depth: number, top: boolean): string {
  const pad = "  ".repeat(depth);
  const head = top ? `#${rule.id}` : `> #${rule.id}`;
  const ip = pad + "  ";
  const lines = [`${pad}${head} {`, `${ip}type: ${rule.type};`];
  for (const d of rule.decls) lines.push(`${ip}${d};`);
  if (rule.anims && rule.anims.length) {
    // One comma-separated entry per channel; a single `animation-fill-mode: both`
    // longhand applies to every entry (the player carries it to each instance).
    const entries = rule.anims.map((a) => {
      const parts = [a.name, `${num(a.durationSec, 3)}s`, a.defaultEasing, "1"];
      if (Math.abs(a.delaySec) > 1e-6) parts.push(`${num(a.delaySec, 3)}s`);
      return parts.join(" ");
    });
    lines.push(`${ip}animation: ${entries.join(", ")};`);
    lines.push(`${ip}animation-fill-mode: both;`);
  }
  for (const c of rule.children) lines.push(serializeRule(c, depth + 1, false));
  lines.push(`${pad}}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate emitted CSS by running it through the real parser + scene builder. */
export function validate(css: string): string[] {
  const errors: string[] = [];
  try {
    const sheet = parse(css);
    buildSceneGraph(sheet);
  } catch (e: any) {
    errors.push(e.message);
  }
  return errors;
}
