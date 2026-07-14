import { useSyncExternalStore } from "react";

// Matches Tailwind's `sm` breakpoint — below it we treat the layout as mobile
// (mobile-only nav, no timeline). useSyncExternalStore keeps it SSR/tearing-safe
// and needs no effect.
const query = "(max-width: 639px)";

function subscribe(cb: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
