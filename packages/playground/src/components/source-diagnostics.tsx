import {
  type Diagnostic,
  offsetToLineCol,
  type Severity,
  validate,
} from "@popkorn/parser";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SEVERITY_RANK: Record<Severity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

/** Debounced parser validation. Empty until the first idle-window fires. */
export function useDiagnostics(source: string, delay = 300): Diagnostic[] {
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        setDiags(validate(source));
      } catch {
        setDiags([]);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [source, delay]);
  return diags;
}

type Part = { text: string; start: number; diag: Diagnostic | null };

/**
 * Slice `code` at every diagnostic boundary so each run is covered by a single
 * (highest-severity) diagnostic or none. The overlay renders these transparent —
 * only the diagnostic runs get a wavy underline + hover target — so it composes
 * with the Prism highlight layer underneath without touching its markup.
 */
function splitByDiagnostics(code: string, diags: Diagnostic[]): Part[] {
  if (diags.length === 0) return [{ text: code, start: 0, diag: null }];
  const clamp = (n: number) => Math.max(0, Math.min(code.length, n));
  const points = new Set<number>([0, code.length]);
  for (const d of diags) {
    points.add(clamp(d.start));
    points.add(clamp(d.end));
  }
  const cuts = [...points].sort((a, b) => a - b);
  const parts: Part[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i];
    const e = cuts[i + 1];
    if (s === e) continue;
    let diag: Diagnostic | null = null;
    for (const d of diags) {
      if (d.start <= s && d.end >= e) {
        if (!diag || SEVERITY_RANK[d.severity] > SEVERITY_RANK[diag.severity])
          diag = d;
      }
    }
    parts.push({ text: code.slice(s, e), start: s, diag });
  }
  return parts;
}

/**
 * The character offset in `ta`'s value under the viewport point (x, y), or null
 * if the point isn't over the textarea's text. Prefers the standard
 * caretPositionFromPoint; falls back to WebKit's caretRangeFromPoint.
 */
function caretOffset(
  ta: HTMLTextAreaElement,
  x: number,
  y: number,
): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p && p.offsetNode === ta) return p.offset;
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r && r.startContainer === ta) return r.startOffset;
  }
  return null;
}

const UNDERLINE: Record<Severity, React.CSSProperties> = {
  error: {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--destructive, #ef4444)",
  },
  warning: {
    textDecoration: "underline wavy",
    textDecorationColor: "#f59e0b",
  },
  info: {
    textDecoration: "underline dotted",
    textDecorationColor: "var(--muted-foreground, #71717a)",
  },
};

/**
 * Transparent text mirror laid over the editor, aligned to the same type
 * layout. The whole layer is pointer-events: none so the textarea underneath
 * keeps every click and selection — even on a squiggled word. The tooltip is
 * driven by a mousemove listener on `containerRef` that maps the cursor to a
 * character offset in the textarea (caretPositionFromPoint / caretRangeFromPoint
 * read through to its text) and looks up the diagnostic whose range covers it —
 * the inert overlay itself can't be hit-tested.
 */
export function DiagnosticsOverlay({
  source,
  diags,
  containerRef,
  padding = 16,
}: {
  source: string;
  diags: Diagnostic[];
  containerRef: React.RefObject<HTMLElement | null>;
  padding?: number;
}) {
  const [tip, setTip] = useState<{
    diag: Diagnostic;
    x: number;
    y: number;
  } | null>(null);
  const parts = splitByDiagnostics(source, diags);
  const diagsRef = useRef(diags);
  diagsRef.current = diags;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const ta = el.querySelector("textarea");
      const offset = ta ? caretOffset(ta, e.clientX, e.clientY) : null;
      let hit: Diagnostic | null = null;
      if (offset != null) {
        for (const d of diagsRef.current) {
          if (d.start <= offset && offset < d.end) {
            if (!hit || SEVERITY_RANK[d.severity] > SEVERITY_RANK[hit.severity])
              hit = d;
          }
        }
      }
      setTip((prev) =>
        hit
          ? prev?.diag === hit
            ? prev
            : { diag: hit, x: e.clientX, y: e.clientY }
          : prev
            ? null
            : prev,
      );
    };
    const onLeave = () => setTip(null);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [containerRef]);

  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 select-none"
        style={{
          padding,
          fontSize: "13px",
          fontFamily: "var(--font-mono)",
          lineHeight: "1.6",
          color: "transparent",
          whiteSpace: "pre-wrap",
          wordBreak: "keep-all",
          overflowWrap: "break-word",
          pointerEvents: "none",
        }}
      >
        {parts.map((p) =>
          p.diag ? (
            <span key={p.start} style={UNDERLINE[p.diag.severity]}>
              {p.text}
            </span>
          ) : (
            <span key={p.start}>{p.text}</span>
          ),
        )}
      </div>
      {tip && (
        <div
          className="fixed z-50 max-w-xs rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{ left: tip.x + 12, top: tip.y + 16, pointerEvents: "none" }}
        >
          <div>{tip.diag.message}</div>
          {tip.diag.hint && (
            <div className="mt-1 text-muted-foreground">{tip.diag.hint}</div>
          )}
        </div>
      )}
    </>
  );
}

const DOT: Record<Severity, string> = {
  error: "bg-destructive",
  warning: "bg-amber-500",
  info: "bg-muted-foreground",
};

/** Compact strip under the editor; click a row to jump the caret to it. */
export function ProblemsStrip({
  source,
  diags,
  onJump,
}: {
  source: string;
  diags: Diagnostic[];
  onJump: (d: Diagnostic) => void;
}) {
  const [open, setOpen] = useState(true);
  if (diags.length === 0) return null;

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  let worst: Severity = "info";
  for (const d of diags) {
    counts[d.severity]++;
    if (SEVERITY_RANK[d.severity] > SEVERITY_RANK[worst]) worst = d.severity;
  }
  const summary = (Object.keys(counts) as Severity[])
    .filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}${counts[s] > 1 ? "s" : ""}`)
    .join(", ");

  return (
    <div className="shrink-0 border-t border-border bg-card/40 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-muted-foreground hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <span className={`size-1.5 shrink-0 rounded-full ${DOT[worst]}`} />
        <span>
          {diags.length} problem{diags.length > 1 ? "s" : ""} ({summary})
        </span>
      </button>
      {open && (
        <div className="max-h-32 overflow-auto">
          {diags.map((d) => {
            const { line, column } = offsetToLineCol(source, d.start);
            return (
              <button
                key={`${d.start}:${d.end}:${d.code}`}
                type="button"
                onClick={() => onJump(d)}
                className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-muted/40"
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${DOT[d.severity]}`}
                />
                <span className="shrink-0 font-mono text-muted-foreground">
                  {line}:{column}
                </span>
                <span className="truncate">{d.message}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
