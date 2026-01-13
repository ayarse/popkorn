import { useState, useEffect } from 'react';
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
  shape: circle;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
  r: 30px;
  fill: #e94560;
  animation: pulse 1s ease-in-out infinite;
}

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
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #333',
        }}>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              backgroundColor: '#0f0f1a',
              color: '#e0e0e0',
              border: 'none',
              padding: '16px',
              fontSize: '13px',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              lineHeight: '1.6',
              resize: 'none',
              outline: 'none',
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
