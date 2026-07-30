import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The playground is a canvas/worker/custom-element app end to end — it has no
// server-renderable form. Loading it lazily inside ClientOnly keeps the module
// (and `HTMLElement` at class-definition time) off the server entirely.
const App = lazy(() => import("@/app"));

/** Shared by `/`, `/examples/$key` and `/s/$id`; which scene loads comes from
 *  the route params. */
export function Playground() {
  return (
    <ClientOnly fallback={null}>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </ClientOnly>
  );
}
