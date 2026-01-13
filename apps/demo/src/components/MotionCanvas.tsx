import { useRef, useEffect } from 'react';
import '@popcorn/player'; // This registers the web component
import type { PopcornPlayer } from '@popcorn/player';

export interface MotionCanvasProps {
  /** CSS-like scene definition */
  source: string;
  /** Canvas width */
  width?: number;
  /** Canvas height */
  height?: number;
  /** Background color */
  backgroundColor?: string;
  /** Called when scene is ready */
  onSceneReady?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Additional class name */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
}

/**
 * React wrapper for the <popcorn-player> web component
 */
export function MotionCanvas({
  source,
  width = 800,
  height = 600,
  backgroundColor,
  onSceneReady,
  onError,
  className,
  style,
}: MotionCanvasProps) {
  const playerRef = useRef<PopcornPlayer>(null);

  // Set source when it changes
  useEffect(() => {
    const player = playerRef.current;
    if (player) {
      player.source = source;
    }
  }, [source]);

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

    player.addEventListener('ready', handleReady);
    player.addEventListener('error', handleError);

    return () => {
      player.removeEventListener('ready', handleReady);
      player.removeEventListener('error', handleError);
    };
  }, [onSceneReady, onError]);

  return (
    <popcorn-player
      ref={playerRef}
      width={width}
      height={height}
      background={backgroundColor}
      className={className}
      style={style}
    />
  );
}

// TypeScript declarations for the custom element
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'popcorn-player': React.DetailedHTMLProps<
        React.HTMLAttributes<PopcornPlayer> & {
          src?: string;
          width?: number;
          height?: number;
          background?: string;
        },
        PopcornPlayer
      >;
    }
  }
}
