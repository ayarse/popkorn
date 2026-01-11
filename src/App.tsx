import { useState } from 'react';
import { MotionCanvas } from './components/MotionCanvas';

// Example scene definitions
const examples = {
  static: `
/* Static shapes demo */
:canvas {
  width: 800px;
  height: 600px;
  background: #1a1a2e;
}

#background {
  shape: rect;
  x: 0;
  y: 0;
  width: 800px;
  height: 600px;
  fill: #1a1a2e;
}

#redCircle {
  shape: circle;
  cx: 200px;
  cy: 300px;
  r: 80px;
  fill: #e94560;
}

#blueRect {
  shape: rect;
  x: 400px;
  y: 200px;
  width: 150px;
  height: 200px;
  rx: 20px;
  ry: 20px;
  fill: #4ecdc4;
}

#yellowEllipse {
  shape: ellipse;
  cx: 650px;
  cy: 300px;
  rx: 60px;
  ry: 100px;
  fill: #ffe66d;
}
`,

  animation: `
/* Animation demo */
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
  0% { transform: translateY(0); }
  50% { transform: translateY(-50px); }
  100% { transform: translateY(0); }
}

#pulsingCircle {
  shape: circle;
  cx: 200px;
  cy: 300px;
  r: 60px;
  fill: #e94560;
  animation: pulse 1.5s ease-in-out infinite;
}

#spinningRect {
  shape: group;
  transform: translate(400px, 300px);

  > #rect {
    shape: rect;
    x: -50px;
    y: -50px;
    width: 100px;
    height: 100px;
    fill: #4ecdc4;
    animation: spin 3s linear infinite;
  }
}

#bouncingEllipse {
  shape: ellipse;
  cx: 650px;
  cy: 350px;
  rx: 40px;
  ry: 60px;
  fill: #ffe66d;
  animation: bounce 1s ease-in-out infinite;
}
`,

  hierarchy: `
/* Scene hierarchy demo */
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
  0% { transform: translateY(0); }
  50% { transform: translateY(-15px); }
  100% { transform: translateY(0); }
}

#solarSystem {
  shape: group;
  transform: translate(400px, 300px);

  > #sun {
    shape: circle;
    cx: 0;
    cy: 0;
    r: 50px;
    fill: #ffe66d;
  }

  > #earthOrbit {
    shape: group;
    animation: orbit 8s linear infinite;

    > #earth {
      shape: circle;
      cx: 150px;
      cy: 0;
      r: 20px;
      fill: #4ecdc4;
      animation: float 2s ease-in-out infinite;
    }

    > #moonOrbit {
      shape: group;
      transform: translate(150px, 0);
      animation: orbit 2s linear infinite;

      > #moon {
        shape: circle;
        cx: 35px;
        cy: 0;
        r: 8px;
        fill: #cccccc;
      }
    }
  }

  > #marsOrbit {
    shape: group;
    animation: orbit 12s linear infinite;

    > #mars {
      shape: circle;
      cx: 220px;
      cy: 0;
      r: 15px;
      fill: #e94560;
    }
  }
}
`,

  interactive: `
/* Interactive demo - cursor tracking */
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

/* Cursor follower - a circle that tracks the mouse */
#cursorFollower {
  shape: circle;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
  r: 30px;
  fill: #e94560;
  animation: pulse 1s ease-in-out infinite;
}

/* Static reference shapes */
#topLeftCorner {
  shape: circle;
  cx: 100px;
  cy: 100px;
  r: 20px;
  fill: #4ecdc4;
  opacity: 0.5;
}

#bottomRightCorner {
  shape: circle;
  cx: 700px;
  cy: 500px;
  r: 20px;
  fill: #ffe66d;
  opacity: 0.5;
}

#centerMarker {
  shape: rect;
  x: 380px;
  y: 280px;
  width: 40px;
  height: 40px;
  rx: 5px;
  ry: 5px;
  fill: #888888;
  opacity: 0.3;
}

/* Instructions text would go here in a real app */
`,
};

function App() {
  const [currentExample, setCurrentExample] = useState<keyof typeof examples>('animation');
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0a1a',
      color: '#ffffff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '20px',
    }}>
      <h1 style={{ marginBottom: '10px', color: '#4ecdc4' }}>
        Motion Scene Graph PoC
      </h1>
      <p style={{ marginBottom: '20px', color: '#888' }}>
        CSS-like declarative language for interactive motion graphics
      </p>

      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={() => setCurrentExample('static')}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            backgroundColor: currentExample === 'static' ? '#4ecdc4' : '#333',
            color: currentExample === 'static' ? '#000' : '#fff',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
          Static Shapes
        </button>
        <button
          onClick={() => setCurrentExample('animation')}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            backgroundColor: currentExample === 'animation' ? '#4ecdc4' : '#333',
            color: currentExample === 'animation' ? '#000' : '#fff',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
          Animations
        </button>
        <button
          onClick={() => setCurrentExample('hierarchy')}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            backgroundColor: currentExample === 'hierarchy' ? '#4ecdc4' : '#333',
            color: currentExample === 'hierarchy' ? '#000' : '#fff',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
          Scene Hierarchy
        </button>
        <button
          onClick={() => setCurrentExample('interactive')}
          style={{
            padding: '10px 20px',
            backgroundColor: currentExample === 'interactive' ? '#4ecdc4' : '#333',
            color: currentExample === 'interactive' ? '#000' : '#fff',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
          Interactive (Cursor)
        </button>
      </div>

      {error && (
        <div style={{
          backgroundColor: '#ff4444',
          color: '#fff',
          padding: '10px',
          marginBottom: '20px',
          borderRadius: '5px',
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'flex',
        gap: '20px',
        flexWrap: 'wrap',
      }}>
        <div style={{
          border: '2px solid #333',
          borderRadius: '10px',
          overflow: 'hidden',
        }}>
          <MotionCanvas
            source={examples[currentExample]}
            onError={(err) => setError(err.message)}
            onSceneReady={() => setError(null)}
          />
        </div>

        <div style={{
          flex: 1,
          minWidth: '300px',
          maxWidth: '500px',
        }}>
          <h3 style={{ color: '#4ecdc4', marginBottom: '10px' }}>Source</h3>
          <pre style={{
            backgroundColor: '#1a1a2e',
            padding: '15px',
            borderRadius: '10px',
            overflow: 'auto',
            maxHeight: '500px',
            fontSize: '12px',
            lineHeight: '1.5',
          }}>
            {examples[currentExample]}
          </pre>
        </div>
      </div>

      <div style={{
        marginTop: '40px',
        padding: '20px',
        backgroundColor: '#1a1a2e',
        borderRadius: '10px',
      }}>
        <h3 style={{ color: '#4ecdc4', marginBottom: '15px' }}>Features Demonstrated</h3>
        <ul style={{ color: '#888', lineHeight: '2' }}>
          <li>CSS-like syntax for scene definition</li>
          <li>Shape types: rect, circle, ellipse, group</li>
          <li>Transform properties: translate, rotate, scale</li>
          <li>Appearance: fill, stroke, opacity</li>
          <li>@keyframes animations with easing</li>
          <li>Scene hierarchy with parent-child transforms</li>
          <li>CSS variables with var() and input() for interactivity</li>
          <li>Cursor tracking with input(cursor.x), input(cursor.y)</li>
          <li>Canvas 2D rendering (ThorVG-compatible interface)</li>
        </ul>
      </div>
    </div>
  );
}

export default App;
