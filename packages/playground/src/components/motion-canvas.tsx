import { useEffect, useRef } from "react";
import "@popkorn/player"; // This registers the web component
import type { PopkornPlayer } from "@popkorn/player";

export interface MotionCanvasProps {
  /** CSS-like scene definition */
  source: string;
  /** Background color */
  backgroundColor?: string;
  /** Show the playback controls bar */
  controls?: boolean;
  /** Loop the timeline */
  loop?: boolean;
  /** How the scene fits the container */
  fit?: "contain" | "cover" | "fill" | "none";
  /** Rendering backend. Read once at component init — change via a key remount. */
  renderer?: "canvas" | "svg";
  /** Called when scene is ready */
  onSceneReady?: () => void;
  /** Exposes the underlying player instance (fired on ready, null on unmount). */
  onPlayerReady?: (player: PopkornPlayer | null) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Additional class name */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
}

/**
 * React wrapper for the <popkorn-player> web component
 */
export function MotionCanvas({
  source,
  backgroundColor,
  controls = true,
  loop = true,
  fit = "contain",
  renderer = "canvas",
  onSceneReady,
  onPlayerReady,
  onError,
  className,
  style,
}: MotionCanvasProps) {
  const playerRef = useRef<PopkornPlayer>(null);

  // Set source when it changes
  useEffect(() => {
    const player = playerRef.current;
    if (player) {
      player.source = source;
    }
  }, [source]);

  // Reflect playback options as attributes (robust across React's custom-element
  // prop handling).
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (controls) player.setAttribute("controls", "");
    else player.removeAttribute("controls");
    if (loop) player.setAttribute("loop", "");
    else player.removeAttribute("loop");
    player.setAttribute("fit", fit);
  }, [controls, loop, fit]);

  // Handle events
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const handleReady = () => {
      onSceneReady?.();
    };

    const handleError = (e: Event) => {
      const customEvent = e as CustomEvent<{ error: Error }>;
      onError?.(customEvent.detail.error);
    };

    player.addEventListener("popkorn:ready", handleReady);
    player.addEventListener("popkorn:error", handleError);

    return () => {
      player.removeEventListener("popkorn:ready", handleReady);
      player.removeEventListener("popkorn:error", handleError);
    };
  }, [onSceneReady, onError]);

  // Expose the player element upward for the mount's lifetime (the element is
  // stable across re-renders; kept in its own effect so unstable event-handler
  // props above don't tear the reference down).
  useEffect(() => {
    onPlayerReady?.(playerRef.current);
    return () => onPlayerReady?.(null);
  }, [onPlayerReady]);

  return (
    <popkorn-player
      ref={playerRef}
      renderer={renderer}
      background={backgroundColor}
      className={className}
      style={{ width: "100%", ...style }}
    />
  );
}

// TypeScript declarations for the custom element
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "popkorn-player": React.DetailedHTMLProps<
        React.HTMLAttributes<PopkornPlayer> & {
          src?: string;
          width?: number;
          height?: number;
          background?: string;
          renderer?: string;
        },
        PopkornPlayer
      >;
    }
  }
}
