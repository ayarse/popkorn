import { useState, useEffect, useRef } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-css';
import 'prismjs/themes/prism-tomorrow.css';
import { MotionCanvas } from './components/MotionCanvas';
import { convertLottie } from '../../../tools/lottie2popcorn';

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

  vector: `/* Gradients + clip-path demo */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

/* Linear gradient fill (0deg = up, 90deg = right) */
#panel {
  type: rect;
  x: 80px;
  y: 180px;
  width: 260px;
  height: 240px;
  rx: 24px;
  fill: linear-gradient(120deg, #e94560 0%, #533483 100%);
}

/* Radial gradient fill + gradient stroke */
#orb {
  type: circle;
  cx: 560px;
  cy: 300px;
  r: 120px;
  fill: radial-gradient(#ffe66d 0%, #ff6b6b 100%);
  stroke: linear-gradient(90deg, #4ecdc4 0%, #ffffff 100%);
  stroke-width: 6px;
}

/* Clip a group to a circle: only the slice inside the circle shows */
#masked {
  type: group;
  clip-path: circle(90px at 560px 300px);

  > #stripe {
    type: rect;
    x: 440px;
    y: 290px;
    width: 240px;
    height: 24px;
    fill: #0f0f23;
  }
}`,

  trimPaths: `/* Trim paths - progressive line drawing + marching dash */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

/* Reveal the stroke from 0% to 100% of its length */
@keyframes draw {
  0% { trim-end: 0%; }
  100% { trim-end: 100%; }
}

/* Rotate a fixed trim window around a closed outline */
@keyframes march {
  0% { trim-offset: 0%; }
  100% { trim-offset: 100%; }
}

/* A wave that draws itself, over and over. Fill stays off; trim is stroke-only.
   Round caps keep the growing tip looking clean. */
#wave {
  type: path;
  d: 'M100 280 C200 100 300 460 400 280 C500 100 600 460 700 280';
  fill: none;
  stroke: #4ecdc4;
  stroke-width: 8px;
  stroke-linecap: round;
  animation: draw 2.5s ease-in-out infinite;
}

/* A marching dashed circle: a 25% window slides around via animated trim-offset */
#marchingCircle {
  type: circle;
  cx: 400px;
  cy: 470px;
  r: 70px;
  fill: none;
  stroke: #e94560;
  stroke-width: 6px;
  stroke-linecap: round;
  trim-start: 0%;
  trim-end: 25%;
  animation: march 3s linear infinite;
}`,

  symbols: `/* Text nodes + reusable symbols (@define / use) */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f23;
}

@keyframes twinkle {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.6); opacity: 0.5; }
}

/* A pulsing star symbol; each instance animates independently */
@define star {
  type: circle;
  r: 12px;
  fill: #fbbf24;
  transform-origin: center;
  animation: twinkle 2s ease-in-out infinite;
}

#title {
  type: text;
  content: "Symbols + Text";
  x: 400px;
  y: 120px;
  font-size: 44px;
  font-family: sans-serif;
  font-weight: bold;
  text-anchor: middle;
  fill: #e2e8f0;
}

/* Three instances: positioned and recoloured at the use-site */
#star1 { use: star; cx: 260px; cy: 340px; }
#star2 { use: star; cx: 400px; cy: 340px; fill: #60a5fa; }
#star3 { use: star; cx: 540px; cy: 340px; fill: #f472b6; }`,

  motion: `/* Motion paths + hold keyframes + negative delay */
:canvas {
  width: 800px;
  height: 600px;
  background: #0b1021;
}

/* Travel the path by arc length; offset-rotate: auto faces the tangent. */
@keyframes fly {
  0%   { offset-distance: 0%; }
  100% { offset-distance: 100%; }
}

/* step-end holds each value for half the cycle -> a crisp on/off blink. */
@keyframes blink {
  0%   { opacity: 1;    animation-timing-function: step-end; }
  50%  { opacity: 0.15; animation-timing-function: step-end; }
  100% { opacity: 1; }
}

/* A little paper plane, drawn pointing along +x so the tangent aims it. */
@define plane {
  type: path;
  d: "M -12 -8 L 14 0 L -12 8 L -5 0 Z";
  stroke: #0b1021;
  stroke-width: 1px;
  offset-path: path("M 110 470 C 210 120, 590 120, 690 470 S 210 700, 110 470");
  offset-rotate: auto;
}

/* Three planes on one loop, staggered by negative delay (already in flight). */
#plane1 { use: plane; fill: #ffe66d; animation: fly 6s linear infinite; }
#plane2 { use: plane; fill: #4ecdc4; animation: fly 6s linear infinite -2s; }
#plane3 { use: plane; fill: #f472b6; animation: fly 6s linear infinite -4s; }

/* A blinking beacon driven by the step-end keyframes above. */
#beacon {
  type: circle;
  cx: 400px;
  cy: 120px;
  r: 14px;
  fill: #e94560;
  transform-origin: center;
  animation: blink 1.2s linear infinite;
}`,
  star: `/* Star & polygon shapes: pure geometry synthesized into the path pipeline */
:canvas {
  width: 800px;
  height: 600px;
  background: #0b1021;
}

/* Spin the star while pulsing its inner radius — both are animatable geometry. */
@keyframes starmove {
  0%   { rotation: 0deg;   inner-radius: 45px; }
  50%  { rotation: 180deg; inner-radius: 95px; }
  100% { rotation: 360deg; inner-radius: 45px; }
}

#star {
  type: star;
  points: 5;
  outer-radius: 130px;
  inner-radius: 45px;
  cx: 400px;
  cy: 300px;
  fill: #ffe66d;
  stroke: #e94560;
  stroke-width: 4px;
  animation: starmove 5s ease-in-out infinite;
}

/* A rounded hexagon (outer-roundness bends each edge into a bezier). */
#hex {
  type: polygon;
  points: 6;
  outer-radius: 70px;
  outer-roundness: 60%;
  cx: 160px;
  cy: 150px;
  fill: #4ecdc4;
}

/* A dashed triangle (stroke-dasharray + evenodd have their own examples too). */
#tri {
  type: polygon;
  points: 3;
  outer-radius: 70px;
  cx: 640px;
  cy: 150px;
  fill: none;
  stroke: #f472b6;
  stroke-width: 5px;
  stroke-dasharray: 16px 10px;
}`,

  matte: `/* Track matte: big text revealed through a sweeping bar (luma matte) */
:canvas {
  width: 800px;
  height: 600px;
  background: #0b1021;
}

/* The matte source: a white bar that sweeps left-to-right and back. Because it
   drives a luma matte it is never drawn itself — only its brightness shows the
   content through. */
@keyframes sweep {
  0%   { transform: translateX(-700px); }
  100% { transform: translateX(700px); }
}

#reveal {
  type: text;
  content: "POPCORN";
  x: 400px;
  y: 360px;
  font-size: 150px;
  font-weight: 700;
  text-anchor: middle;
  fill: #ffe66d;
  matte: #wipe luma;
}

#wipe {
  type: rect;
  x: 100px;
  y: 180px;
  width: 240px;
  height: 260px;
  fill: #ffffff;
  animation: sweep 3s ease-in-out infinite alternate;
}`,

  morph: `/* Path morphing + animated gradient stops.
   Both @keyframes share the same command sequence (M C C C C Z) and the same
   gradient stop count, so 'd' and 'fill' interpolate. Change either shape's
   command letters or the stop count and it steps (holds) instead. */
:canvas {
  width: 800px;
  height: 600px;
  background: #0f0f1e;
}

@keyframes blob {
  0% {
    d: 'M 400 150 C 483 150 550 217 550 300 C 550 383 483 450 400 450 C 317 450 250 383 250 300 C 250 217 317 150 400 150 Z';
    fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%);
  }
  100% {
    d: 'M 400 130 C 520 180 580 240 560 320 C 540 400 460 470 380 460 C 300 450 230 380 250 290 C 270 200 300 90 400 130 Z';
    fill: linear-gradient(45deg, #ffe66d 0%, #a855f7 100%);
  }
}

#blob {
  type: path;
  d: 'M 400 150 C 483 150 550 217 550 300 C 550 383 483 450 400 450 C 317 450 250 383 250 300 C 250 217 317 150 400 150 Z';
  fill: linear-gradient(45deg, #ff6b6b 0%, #4ecdc4 100%);
  animation: blob 3s ease-in-out infinite alternate;
}`,
};

type ExampleKey = keyof typeof examples;

function App() {
  const [currentExample, setCurrentExample] = useState<ExampleKey | null>('animation');
  const [source, setSource] = useState(examples.animation);
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentExample) setSource(examples[currentExample]);
  }, [currentExample]);

  function handleLottieFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setImportStatus(null);
      let lottie: any;
      try {
        lottie = JSON.parse(reader.result as string);
      } catch (e: any) {
        setError(`Invalid JSON: ${e.message}`);
        return;
      }
      try {
        const { css, warnings, blocked } = convertLottie(lottie);
        setCurrentExample(null);
        setSource(css);
        const parts: string[] = [];
        if (warnings.length) parts.push(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings.join('; ')}`);
        if (blocked.length) parts.push(`blocked: ${blocked.join('; ')}`);
        setImportStatus(parts.length ? `Imported "${file.name}" — ${parts.join(' | ')}` : `Imported "${file.name}"`);
      } catch (e: any) {
        setError(`Lottie conversion failed: ${e.message}`);
      }
    };
    reader.onerror = () => setError(`Could not read file: ${file.name}`);
    reader.readAsText(file);
  }

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
              onClick={() => { setCurrentExample(key); setImportStatus(null); setError(null); }}
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
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '6px 14px',
              backgroundColor: '#252530',
              color: '#888',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 400,
            }}
          >
            Import Lottie
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLottieFile(file);
              e.target.value = '';
            }}
          />
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

        {!error && importStatus && (
          <div style={{
            backgroundColor: '#4ecdc4',
            color: '#000',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            maxWidth: '400px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {importStatus}
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
