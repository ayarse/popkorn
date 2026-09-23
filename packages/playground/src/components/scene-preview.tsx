import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { loadExampleSource } from "@/examples";
import { sceneAspect } from "@/lib/scene-aspect";
import { getScene } from "@/lib/scenes";
import { cn } from "@/lib/utils";

// <popkorn-player> extends HTMLElement at module scope — never import it eagerly
// from a route that server-renders.
const MotionCanvas = lazy(() =>
  import("@/components/motion-canvas").then((m) => ({
    default: m.MotionCanvas,
  })),
);

type PreviewProps = {
  source?: string;
  sceneId?: string;
  exampleKey?: string;
  aspect?: number;
  onError?: (error: Error) => void;
};

/**
 * A gallery thumbnail that plays for real. Docs pass their `source` inline;
 * built-in examples pass an `exampleKey` and community scenes a `sceneId`, and
 * that CSS is fetched on first sight. The player is mounted only while the card
 * is near the viewport, so a long gallery isn't 60 render loops.
 *
 * The card is sized by the scene's own aspect ratio, which is what makes the
 * masonry layout work: same column width, whatever height the scene wants.
 */
export function ScenePreview(props: PreviewProps) {
  return (
    <ClientOnly fallback={<Box loading aspect={placeholderAspect(props)} />}>
      <Preview {...props} />
    </ClientOnly>
  );
}

function Box({
  aspect,
  loading,
  children,
  boxRef,
}: {
  aspect: number;
  loading?: boolean;
  children?: React.ReactNode;
  boxRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={boxRef}
      style={{ aspectRatio: aspect }}
      className={cn(
        "w-full overflow-hidden",
        loading && "animate-pulse bg-secondary/30",
      )}
    >
      {children}
    </div>
  );
}

/** What to reserve before the scene's own CSS is in hand. */
function placeholderAspect({
  source,
  aspect,
}: {
  source?: string;
  aspect?: number;
}): number {
  return source ? sceneAspect(source) : (aspect ?? 4 / 3);
}

function Preview({
  source,
  sceneId,
  exampleKey,
  aspect,
  onError,
}: PreviewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [fetched, setCss] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // An inline `source` stays live (docs edit it in place); a fetched one loads once.
  const css = source ?? fetched;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || css || failed) return;
    const load = sceneId
      ? getScene({ data: sceneId }).then((s) => s?.css)
      : exampleKey
        ? loadExampleSource(exampleKey)
        : undefined;
    if (!load) return;
    let ignore = false;
    load
      .then((next) => {
        if (ignore) return;
        if (next) setCss(next);
        else setFailed(true);
      })
      .catch(() => {
        if (!ignore) setFailed(true);
      });
    return () => {
      ignore = true;
    };
  }, [visible, css, failed, sceneId, exampleKey]);

  return (
    <Box
      boxRef={ref}
      loading={!css && !failed}
      aspect={css ? sceneAspect(css) : placeholderAspect({ source, aspect })}
    >
      {failed ? (
        <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
          Couldn't load this scene.
        </div>
      ) : (
        visible &&
        css && (
          <Suspense fallback={null}>
            <MotionCanvas
              source={css}
              onError={onError}
              controls={false}
              loop
              fit="contain"
              style={{ height: "100%" }}
            />
          </Suspense>
        )
      )}
    </Box>
  );
}
