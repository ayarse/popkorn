// Fire an event to both analytics backends (Umami + GA gtag). Both scripts are
// injected by the root route's head (`routes/__root.tsx`); either may be absent
// (blocked, still loading), so both calls are optional.
// NOTE: no wrapper lib, these two calls are the whole API.
type Gtag = (
  command: "event",
  name: string,
  params?: Record<string, unknown>,
) => void;
type Umami = { track: (name: string, data?: Record<string, unknown>) => void };

export function track(event: string, data?: Record<string, string | number>) {
  if (import.meta.env.DEV) return;
  (window as unknown as { umami?: Umami }).umami?.track(event, data);
  (window as unknown as { gtag?: Gtag }).gtag?.("event", event, data);
}
