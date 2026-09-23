import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { LABEL_W } from "./geometry";
import { fmtSeconds } from "./scale";
import type { Clock } from "./use-player-timeline";

// The only per-frame subscribers: each writes the DOM through a ref on every
// clock tick instead of re-rendering.

function useClockEffect(clock: Clock, apply: (ms: number) => void) {
  const applyRef = useRef(apply);
  useLayoutEffect(() => {
    applyRef.current = apply;
    apply(clock.get());
  });
  useEffect(
    () => clock.subscribe(() => applyRef.current(clock.get())),
    [clock],
  );
}

/** Triangle on the ruler; pointer input falls through to the ruler lane. */
export const PlayheadGrabber = memo(function PlayheadGrabber({
  clock,
  ppm,
}: {
  clock: Clock;
  ppm: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClockEffect(clock, (ms) => {
    if (ref.current)
      ref.current.style.transform = `translateX(calc(${ms * ppm}px - 50%))`;
  });
  return (
    <div ref={ref} className="absolute top-0 left-0 z-10">
      <div className="size-0 border-x-4 border-t-[6px] border-x-transparent border-t-primary" />
    </div>
  );
});

/** Vertical line spanning the rows. */
export const PlayheadLine = memo(function PlayheadLine({
  clock,
  ppm,
}: {
  clock: Clock;
  ppm: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClockEffect(clock, (ms) => {
    if (ref.current)
      ref.current.style.transform = `translateX(${LABEL_W + ms * ppm}px)`;
  });
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-px bg-primary"
    />
  );
});

/** `1.24s / 3.00s` readout. */
export const TimeReadout = memo(function TimeReadout({
  clock,
  displayEnd,
}: {
  clock: Clock;
  displayEnd: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useClockEffect(clock, (ms) => {
    if (ref.current)
      ref.current.textContent = `${fmtSeconds(ms)} / ${fmtSeconds(displayEnd)}`;
  });
  return <span ref={ref} className="ml-1 text-muted-foreground/60" />;
});

/** Editable current time (ms); follows the clock unless focused. */
export const TimeInput = memo(function TimeInput({
  clock,
  disabled,
  onSeek,
}: {
  clock: Clock;
  disabled: boolean;
  onSeek: (ms: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const show = (ms: number) => {
    if (ref.current && !editing.current)
      ref.current.value = String(Math.round(ms));
  };
  useClockEffect(clock, show);
  return (
    <input
      ref={ref}
      aria-label="Current time (ms)"
      defaultValue="0"
      disabled={disabled}
      onFocus={() => {
        editing.current = true;
      }}
      onBlur={(e) => {
        if (!editing.current) return;
        editing.current = false;
        const ms = Number.parseFloat(e.currentTarget.value);
        if (Number.isFinite(ms)) onSeek(ms);
        show(clock.get());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          editing.current = false;
          show(clock.get());
          e.currentTarget.blur();
        }
      }}
      className="w-14 rounded border border-border/60 bg-secondary/30 px-1 py-0.5 text-right focus:border-primary focus:outline-none"
    />
  );
});
