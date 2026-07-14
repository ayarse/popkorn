// Fire an event to both analytics backends (Umami + GA gtag). Both scripts are
// loaded globally in index.html; either may be absent (blocked, still loading),
// so both calls are optional. ponytail: no wrapper lib, these two are the whole API.
type Gtag = (
  command: "event",
  name: string,
  params?: Record<string, unknown>,
) => void;
type Umami = { track: (name: string, data?: Record<string, unknown>) => void };

export function track(event: string, data?: Record<string, string | number>) {
  (window as unknown as { umami?: Umami }).umami?.track(event, data);
  (window as unknown as { gtag?: Gtag }).gtag?.("event", event, data);
}
