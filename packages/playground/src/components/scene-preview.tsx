import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { sceneAspect } from "@/lib/scene-aspect";
import { getScene } from "@/lib/scenes";

// <popkorn-player> extends HTMLElement at module scope — never import it eagerly
// from a route that server-renders.
const MotionCanvas = lazy(() =>
  import("@/components/motion-canvas").then((m) => ({
    default: m.MotionCanvas,
  })),
);

/**
 * A gallery thumbnail that plays for real. Built-in examples carry their `source`
 * inline (already bundled); community scenes pass a `sceneId` and their CSS is
 * fetched on demand — 60 scenes × up to 100KB is not a payload worth shipping up
 * front. Either way nothing mounts until the card scrolls into view, so a long
 * gallery isn't 60 render loops.
 *
 * The card is sized by the scene's own aspect ratio, which is what makes the
 * masonry layout work: same column width, whatever height the scene wants.
 */
export function ScenePreview(props: { source?: string; sceneId?: string }) {
  return (
    <ClientOnly
      fallback={
        <Box aspect={props.source ? sceneAspect(props.source) : 4 / 3} />
      }
    >
      <Preview {...props} />
    </ClientOnly>
  );
}

function Box({
  aspect,
  children,
  boxRef,
}: {
  aspect: number;
  children?: React.ReactNode;
  boxRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={boxRef}
      style={{ aspectRatio: aspect }}
      className="w-full overflow-hidden"
    >
      {children}
    </div>
  );
}

function Preview({ source, sceneId }: { source?: string; sceneId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [css, setCss] = useState<string | null>(source ?? null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || css || !sceneId) return;
    void getScene({ data: sceneId }).then((s) => setCss(s?.css ?? null));
  }, [visible, css, sceneId]);

  return (
    <Box boxRef={ref} aspect={css ? sceneAspect(css) : 4 / 3}>
      {visible && css && (
        <Suspense fallback={null}>
          <MotionCanvas
            source={css}
            controls={false}
            loop
            fit="contain"
            style={{ height: "100%" }}
          />
        </Suspense>
      )}
    </Box>
  );
}
