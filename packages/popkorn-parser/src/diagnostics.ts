// Diagnostic shape, check vocabularies and "did you mean"; parser.ts decides where each fires.

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  hint?: string;
  /** Character offset into the source where the flagged span begins. */
  start: number;
  /** Character offset one past the end of the flagged span. */
  end: number;
}

/** Map a character offset to a 1-based line/column (for editor gutters). */
export function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; column: number } {
  const lines = source.slice(0, Math.max(0, offset)).split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// NOTE: hand-synced mirror of the builder's vocabulary (it reads props ad hoc); add new props here.
export const KNOWN_PROPERTIES = new Set<string>([
  // shape geometry
  "type",
  "use",
  "repeat",
  "content",
  "object-view-box",
  "d",
  "x",
  "y",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "sides",
  "inner-radius",
  "outer-radius",
  "inner-roundness",
  "outer-roundness",
  // paint
  "fill",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "paint-order",
  "filter",
  "box-shadow",
  "mix-blend-mode",
  // text
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "text-align",
  "letter-spacing",
  "line-height",
  // transform
  "transform",
  "transform-origin",
  "translate",
  "rotate",
  "rotation",
  "scale",
  "skew",
  // layout / visibility
  "z-index",
  "display",
  "visible-from",
  "visible-until",
  "overflow",
  "pointer-events",
  "cursor",
  "clip-path",
  "mask",
  // motion path
  "offset-path",
  "offset-distance",
  "offset-rotate",
  // trim
  "trim-start",
  "trim-end",
  "trim-offset",
  // time scoping
  "time-offset",
  "time-scale",
  "time-remap",
  // animation
  "animation",
  "animation-name",
  "animation-duration",
  "animation-delay",
  "animation-timing-function",
  "animation-iteration-count",
  "animation-direction",
  "animation-fill-mode",
  "animation-composition",
  "animation-timeline",
  // transition
  "transition",
  "transition-property",
  "transition-duration",
  "transition-delay",
  "transition-timing-function",
  // write-in CSS aliases (rewritten in expandAliases)
  "left",
  "top",
  "right",
  "bottom",
  "background",
  "color",
  "border",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "padding",
  "margin",
  "position",
]);

/** Properties whose value is a paint color (keyword must name a color). */
export const COLOR_PROPERTIES = new Set<string>([
  "fill",
  "stroke",
  "background",
  "color",
]);

/** Non-color keywords legal in a color slot — skip the color check for these. */
export const COLOR_KEYWORDS = new Set<string>([
  "none",
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
]);

// Hand-synced mirror of the player's NAMED_COLORS; only feeds hints, so drift is harmless.
export const NAMED_COLORS = new Set<string>([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "cyan",
  "magenta",
  "gray",
  "grey",
  "silver",
  "maroon",
  "olive",
  "lime",
  "aqua",
  "teal",
  "navy",
  "fuchsia",
  "purple",
  "orange",
  "pink",
  "brown",
  "gold",
  "indigo",
  "violet",
  "crimson",
  "coral",
  "salmon",
  "khaki",
  "orchid",
  "plum",
  "tan",
  "turquoise",
  "darkgray",
  "darkgrey",
  "lightgray",
  "lightgrey",
  "darkblue",
  "darkgreen",
  "darkred",
  "steelblue",
  "slategray",
  "skyblue",
  "tomato",
  "seagreen",
  "royalblue",
  "dodgerblue",
]);

/** `animation` shorthand keywords; any other ident is the @keyframes name. */
const ANIMATION_KEYWORDS = new Set<string>([
  "infinite",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "none",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
]);

export function isReservedAnimationKeyword(kw: string): boolean {
  return ANIMATION_KEYWORDS.has(kw);
}

// An `animation` token that can name @keyframes: not a reserved keyword, `#id` or `a.b` member.
export function isKeyframeNameToken(k: string): boolean {
  return !ANIMATION_KEYWORDS.has(k) && !k.startsWith("#") && !k.includes(".");
}

// Optimal string alignment distance: Levenshtein + adjacent transposition (`rde`→`red` = 1).
function editDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  const d: number[][] = Array.from({ length: al + 1 }, () =>
    new Array<number>(bl + 1).fill(0),
  );
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[al][bl];
}

/** Nearest candidate within a length-scaled edit distance, or undefined. */
export function suggest(
  word: string,
  candidates: Iterable<string>,
): string | undefined {
  const max = word.length <= 4 ? 1 : 2;
  let best: string | undefined;
  let bestDist = max + 1;
  for (const cand of candidates) {
    const dist = editDistance(word, cand);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
      if (dist === 0) break;
    }
  }
  return bestDist <= max ? best : undefined;
}
