import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { LABEL_W } from "./geometry";
import { pxPerMs, ZOOM_MAX, ZOOM_MIN } from "./scale";

/**
 * Timeline zoom + the scroll viewport it acts on. `scrollRef` is a callback ref
 * because the viewport only mounts while the timeline is expanded; it tracks
 * the viewport width and installs ctrl/cmd-wheel zoom around the cursor.
 */
export function useTimelineZoom() {
  const [zoom, setZoom] = useState(1);
  const [viewportW, setViewportW] = useState(0);
  const elRef = useRef<HTMLDivElement | null>(null);
  const pendingScroll = useRef<number | null>(null);

  // Apply a zoom-around-cursor scroll target once the new width is laid out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `zoom` is the trigger — its content width must be laid out before scrollLeft is set.
  useLayoutEffect(() => {
    if (pendingScroll.current !== null && elRef.current) {
      elRef.current.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [zoom]);

  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    elRef.current = el;
    setViewportW(el.clientWidth);
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => setViewportW(el.clientWidth));
    ro?.observe(el);
    // Non-passive so the browser's page zoom can be prevented.
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const cursorX = e.clientX - el.getBoundingClientRect().left;
      const laneX = cursorX + el.scrollLeft - LABEL_W;
      setZoom((z) => {
        const next = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)),
        );
        pendingScroll.current =
          (laneX / pxPerMs(z)) * pxPerMs(next) + LABEL_W - cursorX;
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro?.disconnect();
      el.removeEventListener("wheel", onWheel);
      elRef.current = null;
    };
  }, []);

  return { zoom, setZoom, ppm: pxPerMs(zoom), viewportW, scrollRef };
}
