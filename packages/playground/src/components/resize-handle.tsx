import { useCallback, useState } from "react";

/**
 * Draggable vertical split between two horizontal panels. Returns the left
 * panel's width fraction (0..1), a ref for the flex container, and the handlers
 * for the handle element to drop between the panels.
 */
export function useHorizontalSplit(initial = 0.5, min = 0.2, max = 0.8) {
  const [frac, setFrac] = useState(initial);
  const clamp = useCallback(
    (f: number) => Math.min(max, Math.max(min, f)),
    [min, max],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Measure against the panel pair (handle's two siblings), not the whole
      // container — otherwise a fixed sibling like the chat sidebar skews frac.
      const left =
        e.currentTarget.previousElementSibling?.getBoundingClientRect();
      const right = e.currentTarget.nextElementSibling?.getBoundingClientRect();
      if (!left || !right) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const origin = left.left;
      const span = right.right - left.left;
      const move = (ev: PointerEvent) => {
        setFrac(clamp((ev.clientX - origin) / span));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [clamp],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") setFrac((f) => clamp(f - 0.02));
      else if (e.key === "ArrowRight") setFrac((f) => clamp(f + 0.02));
      else return;
      e.preventDefault();
    },
    [clamp],
  );

  return { frac, min, max, onPointerDown, onKeyDown };
}

export function ResizeHandle(props: {
  frac: number;
  min: number;
  max: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: draggable resizer needs an interactive div, not <hr>
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(props.frac * 100)}
      aria-valuemin={Math.round(props.min * 100)}
      aria-valuemax={Math.round(props.max * 100)}
      aria-label="Resize panels"
      tabIndex={0}
      onPointerDown={props.onPointerDown}
      onKeyDown={props.onKeyDown}
      className="group relative w-px shrink-0 cursor-col-resize bg-border outline-none focus-visible:bg-primary"
    >
      {/* Fat invisible hit area so the 1px line is easy to grab */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-10 transition-colors group-hover:bg-primary/20" />
    </div>
  );
}
