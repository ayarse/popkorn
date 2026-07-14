import { useCallback, useState } from "react";

/**
 * Draggable split between two panels. Returns the first panel's size fraction
 * (0..1) and the handlers for the handle element to drop between the panels.
 * `vertical` = true stacks panels top/bottom (frac = top height); false is the
 * left/right layout (frac = left width).
 */
export function useSplit(
  vertical = false,
  initial = 0.5,
  min = 0.2,
  max = 0.8,
) {
  const [frac, setFrac] = useState(initial);
  const clamp = useCallback(
    (f: number) => Math.min(max, Math.max(min, f)),
    [min, max],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Measure against the panel pair (handle's two siblings), not the whole
      // container — otherwise a fixed sibling like the chat sidebar skews frac.
      const a = e.currentTarget.previousElementSibling?.getBoundingClientRect();
      const b = e.currentTarget.nextElementSibling?.getBoundingClientRect();
      if (!a || !b) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const origin = vertical ? a.top : a.left;
      const span = vertical ? b.bottom - a.top : b.right - a.left;
      const move = (ev: PointerEvent) => {
        const pos = vertical ? ev.clientY : ev.clientX;
        setFrac(clamp((pos - origin) / span));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [clamp, vertical],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const dec = vertical ? "ArrowUp" : "ArrowLeft";
      const inc = vertical ? "ArrowDown" : "ArrowRight";
      if (e.key === dec) setFrac((f) => clamp(f - 0.02));
      else if (e.key === inc) setFrac((f) => clamp(f + 0.02));
      else return;
      e.preventDefault();
    },
    [clamp, vertical],
  );

  return { frac, min, max, vertical, onPointerDown, onKeyDown };
}

export function ResizeHandle(props: {
  frac: number;
  min: number;
  max: number;
  vertical?: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const v = props.vertical;
  return (
    // biome-ignore lint/a11y/useSemanticElements: draggable resizer needs an interactive div, not <hr>
    <div
      role="separator"
      aria-orientation={v ? "horizontal" : "vertical"}
      aria-valuenow={Math.round(props.frac * 100)}
      aria-valuemin={Math.round(props.min * 100)}
      aria-valuemax={Math.round(props.max * 100)}
      aria-label="Resize panels"
      tabIndex={0}
      onPointerDown={props.onPointerDown}
      onKeyDown={props.onKeyDown}
      className={
        v
          ? "group relative h-px shrink-0 cursor-row-resize bg-border outline-none focus-visible:bg-primary"
          : "group relative w-px shrink-0 cursor-col-resize bg-border outline-none focus-visible:bg-primary"
      }
    >
      {/* Fat invisible hit area so the 1px line is easy to grab. */}
      <div
        className={
          v
            ? "absolute inset-x-0 -top-2.5 -bottom-2.5 z-10 transition-colors group-hover:bg-primary/20"
            : "absolute inset-y-0 left-0 -right-2.5 z-10 transition-colors group-hover:bg-primary/20"
        }
      />
    </div>
  );
}
