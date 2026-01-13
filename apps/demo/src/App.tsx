import { useState, useEffect } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-css';
import 'prismjs/themes/prism-tomorrow.css';
import { MotionCanvas } from './components/MotionCanvas';

// Example scene definitions
const examples = {
  static: `/* Static shapes demo */
:canvas {
  width: 800px;
  height: 600px;
  background: #1a1a2e;
}

#redCircle {
  type: circle;
  cx: 200px;
  cy: 300px;
  r: 80px;
  fill: #e94560;
}

#blueRect {
  type: rect;
  x: 400px;
  y: 200px;
  width: 150px;
  height: 200px;
  rx: 20px;
  ry: 20px;
  fill: #4ecdc4;
}

#yellowEllipse {
  type: ellipse;
  cx: 650px;
  cy: 300px;
  rx: 60px;
  ry: 100px;
  fill: #ffe66d;
}`,

  animation: `/* Animation demo */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes bounce {
  0% {
    transform: translateY(0);
    animation-timing-function: ease-out;
  }
  50% {
    transform: translateY(-50px);
    animation-timing-function: ease-in;
  }
  100% { transform: translateY(0); }
}

#pulsingCircle {
  type: circle;
  cx: 200px;
  cy: 300px;
  r: 60px;
  fill: #e94560;
  transform-origin: center;
  animation: pulse 1.5s ease-in-out infinite;
}

#spinningRect {
  type: group;
  transform: translate(400px, 300px);

  > #rect {
    type: rect;
    x: -50px;
    y: -50px;
    width: 100px;
    height: 100px;
    fill: #4ecdc4;
    animation: spin 3s linear infinite;
  }
}

#bouncingEllipse {
  type: ellipse;
  cx: 650px;
  cy: 350px;
  rx: 40px;
  ry: 60px;
  fill: #ffe66d;
  animation: bounce 1s linear infinite;
}`,

  hierarchy: `/* Scene hierarchy demo */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

@keyframes orbit {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes float {
  0% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
  }
  50% {
    transform: translateY(-15px);
    animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
  }
  100% { transform: translateY(0); }
}

#solarSystem {
  type: group;
  transform: translate(400px, 300px);

  > #sun {
    type: circle;
    cx: 0;
    cy: 0;
    r: 50px;
    fill: #ffe66d;
  }

  > #earthOrbit {
    type: group;
    animation: orbit 8s linear infinite;

    > #earth {
      type: circle;
      cx: 150px;
      cy: 0;
      r: 20px;
      fill: #4ecdc4;
      animation: float 2s ease-in-out infinite;
    }

    > #moonOrbit {
      type: group;
      transform: translate(150px, 0);
      animation: orbit 2s linear infinite;

      > #moon {
        type: circle;
        cx: 35px;
        cy: 0;
        r: 8px;
        fill: #cccccc;
      }
    }
  }

  > #marsOrbit {
    type: group;
    animation: orbit 12s linear infinite;

    > #mars {
      type: circle;
      cx: 220px;
      cy: 0;
      r: 15px;
      fill: #e94560;
    }
  }
}`,

  interactive: `/* Interactive demo - cursor tracking */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

:root {
  --cursor-x: input(cursor.x);
  --cursor-y: input(cursor.y);
}

@keyframes pulse {
  0% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1); opacity: 0.8; }
}

#cursorFollower {
  type: circle;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
  r: 30px;
  fill: #e94560;
  transform-origin: center;
  animation: pulse 1s ease-in-out infinite;
}

#topLeftCorner {
  type: circle;
  cx: 100px;
  cy: 100px;
  r: 20px;
  fill: #4ecdc4;
  opacity: 0.5;
}

#bottomRightCorner {
  type: circle;
  cx: 700px;
  cy: 500px;
  r: 20px;
  fill: #ffe66d;
  opacity: 0.5;
}`,

  hoverActive: `/* Hover & Active States Demo */
:canvas {
  width: 800px;
  height: 600px;
  background: #1a1a2e;
}

/* Interactive button */
#button {
  type: rect;
  x: 300px;
  y: 250px;
  width: 200px;
  height: 60px;
  rx: 10px;
  fill: #3498db;

  &:hover {
    fill: #2980b9;
    transform: scale(1.05);
  }

  &:active {
    fill: #1a5276;
    transform: scale(0.95);
  }
}

/* Interactive circle */
#circle1 {
  type: circle;
  cx: 150px;
  cy: 300px;
  r: 50px;
  fill: #e94560;

  &:hover {
    fill: #ff6b8a;
    transform: scale(1.1);
  }

  &:active {
    fill: #c73e54;
    transform: scale(0.9);
  }
}

/* Another interactive circle */
#circle2 {
  type: circle;
  cx: 650px;
  cy: 300px;
  r: 50px;
  fill: #4ecdc4;

  &:hover {
    fill: #6ee6dd;
    transform: scale(1.15);
  }

  &:active {
    fill: #3ba89f;
    transform: scale(0.85);
  }
}

/* Interactive ellipse */
#ellipse1 {
  type: ellipse;
  cx: 400px;
  cy: 450px;
  rx: 80px;
  ry: 40px;
  fill: #ffe66d;

  &:hover {
    fill: #fff59d;
    transform: scale(1.08);
  }

  &:active {
    fill: #e6cf62;
    transform: scale(0.92);
  }
}`,

  bouncyBall: `/* Bouncy Ball - Per-keyframe easing demo */
:canvas {
  width: 800px;
  height: 600px;
  background: #1a1a2e;
}

/*
 * This animation demonstrates per-keyframe easing:
 * - ease-in when falling (gravity accelerates the ball)
 * - ease-out when rising (ball decelerates against gravity)
 * - Squash/stretch at impact for realistic physics
 */

@keyframes ballBounce {
  /* Start at top - begin falling with ease-in (acceleration) */
  0% {
    transform: translateY(0);
    animation-timing-function: ease-in;
  }
  /* Hit ground - squash effect, then ease-out for rise */
  45% {
    transform: translateY(280px) scaleX(1.3) scaleY(0.7);
    animation-timing-function: ease-out;
  }
  /* Rising - stretch slightly as ball leaves ground */
  50% {
    transform: translateY(260px) scaleX(0.9) scaleY(1.1);
    animation-timing-function: ease-out;
  }
  /* Peak of bounce - momentary pause before falling again */
  75% {
    transform: translateY(100px) scaleX(1) scaleY(1);
    animation-timing-function: ease-in;
  }
  /* Return to start position */
  100% {
    transform: translateY(0);
  }
}

@keyframes shadowPulse {
  0% {
    transform: scaleX(0.5) scaleY(1);
    opacity: 0.2;
    animation-timing-function: ease-in;
  }
  45% {
    transform: scaleX(1.4) scaleY(1);
    opacity: 0.5;
    animation-timing-function: ease-out;
  }
  75% {
    transform: scaleX(0.7) scaleY(1);
    opacity: 0.25;
    animation-timing-function: ease-in;
  }
  100% {
    transform: scaleX(0.5) scaleY(1);
    opacity: 0.2;
  }
}

/* Ground line */
#ground {
  type: rect;
  x: 100px;
  y: 480px;
  width: 600px;
  height: 4px;
  rx: 2px;
  fill: #4a4a6a;
}

/* Ball shadow - ellipse that grows as ball approaches */
#ballShadow {
  type: ellipse;
  cx: 400px;
  cy: 475px;
  rx: 50px;
  ry: 8px;
  fill: #000000;
  transform-origin: center;
  animation: shadowPulse 1.2s linear infinite;
}

/* The bouncing ball */
#ball {
  type: circle;
  cx: 400px;
  cy: 150px;
  r: 40px;
  fill: #ff6b6b;
  transform-origin: center bottom;
  animation: ballBounce 1.2s linear infinite;
}

/* Ball highlight for 3D effect */
#ballHighlight {
  type: circle;
  cx: 385px;
  cy: 135px;
  r: 12px;
  fill: #ffaaaa;
  transform-origin: 400px 190px;
  animation: ballBounce 1.2s linear infinite;
}`,
};

type ExampleKey = keyof typeof examples;

function App() {
  const [currentExample, setCurrentExample] = useState<ExampleKey>('animation');
  const [source, setSource] = useState(examples.animation);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSource(examples[currentExample]);
  }, [currentExample]);

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0a0a1a',
      color: '#ffffff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <header style={{
        padding: '12px 20px',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        flexShrink: 0,
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', color: '#4ecdc4' }}>
          Popcorn
        </h1>
        <span style={{ color: '#666', fontSize: '13px' }}>
          CSS-like DSL for interactive motion graphics
        </span>

        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          {(Object.keys(examples) as ExampleKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setCurrentExample(key)}
              style={{
                padding: '6px 14px',
                backgroundColor: currentExample === key ? '#4ecdc4' : '#252530',
                color: currentExample === key ? '#000' : '#888',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: currentExample === key ? 600 : 400,
              }}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>

        {error && (
          <div style={{
            backgroundColor: '#ff4444',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            maxWidth: '400px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {error}
          </div>
        )}
      </header>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* Source panel */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          borderRight: '1px solid #333',
          backgroundColor: '#0f0f1a',
        }}>
          <Editor
            value={source}
            onValueChange={setSource}
            highlight={(code) => Prism.highlight(code, Prism.languages.css, 'css')}
            padding={16}
            style={{
              minHeight: '100%',
              fontSize: '13px',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              lineHeight: '1.6',
              backgroundColor: 'transparent',
            }}
          />
        </div>

        {/* Animation panel */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a12',
        }}>
          <MotionCanvas
            source={source}
            onError={(err) => setError(err.message)}
            onSceneReady={() => setError(null)}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
