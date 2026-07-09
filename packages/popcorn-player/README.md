# @popcorn/player

A web component and rendering engine for the Popcorn DSL - a CSS-like declarative language for interactive motion graphics.

## Installation

```bash
bun add @popcorn/player
```

## Quick Start

### Using the Web Component

The simplest way to use the player is via the `<popcorn-player>` custom element:

```html
<script type="module">
  import '@popcorn/player';
</script>

<popcorn-player
  width="800"
  height="600"
  background="#1a1a2e"
></popcorn-player>

<script>
  const player = document.querySelector('popcorn-player');
  player.source = `
    #circle {
      type: circle;
      cx: 400px;
      cy: 300px;
      r: 50px;
      fill: #e94560;
    }
  `;
</script>
```

### Web Component Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `width` | number | Canvas width in pixels (default: 400) |
| `height` | number | Canvas height in pixels (default: 300) |
| `background` | string | Background color (CSS color value) |
| `src` | string | URL to fetch DSL source from (http(s), relative, `data:`, `blob:`). For inline DSL *text*, use the `.source` property instead. |

### Web Component Properties

| Property | Type | Description |
|----------|------|-------------|
| `source` | string | Get/set the DSL source *text* directly (the inline channel — not a URL) |
| `src` | string \| null | Get/set the `src` URL attribute (fetched into `source`) |
| `width` | number | Get/set canvas width |
| `height` | number | Get/set canvas height |
| `background` | string \| null | Get/set background color |

### Web Component Methods

| Method | Description |
|--------|-------------|
| `play()` | Start or resume playback |
| `stop()` | Stop playback |
| `reset()` | Reset animations to initial state |

### Web Component Events

| Event | Detail | Description |
|-------|--------|-------------|
| `ready` | `{ sceneRoot: SceneNode }` | Fired when scene is parsed and ready |
| `complete` | — | Fired once when a non-looping timeline reaches its end |
| `error` | `{ error: Error }` | Fired on parse or `src` load / initialization error |

## React Integration

For React apps, you can create a simple wrapper:

```tsx
import { useRef, useEffect } from 'react';
import '@popcorn/player';
import type { PopcornPlayer } from '@popcorn/player';

function MotionCanvas({ source, width = 800, height = 600, background }) {
  const playerRef = useRef<PopcornPlayer>(null);

  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.source = source;
    }
  }, [source]);

  return (
    <popcorn-player
      ref={playerRef}
      width={width}
      height={height}
      background={background}
    />
  );
}
```

## Advanced Usage

For more control, you can use the lower-level APIs directly:

```ts
import {
  parse,
  buildSceneGraph,
  Canvas2DRenderer,
  RenderLoop,
  AnimationScheduler,
} from '@popcorn/player';

// Parse DSL
const ast = parse(source);

// Build scene graph
const scene = buildSceneGraph(ast);

// Set up renderer
const canvas = document.querySelector('canvas');
const renderer = new Canvas2DRenderer(canvas);

// Create animation scheduler
const scheduler = new AnimationScheduler();

// Create and start render loop
const loop = new RenderLoop(renderer, scheduler);
loop.setScene(scene);
loop.setBackgroundColor('#1a1a2e');
loop.start();

// Later: stop playback
loop.stop();
```

## Module Exports

### Web Component
- `PopcornPlayer` - The custom element class
- `registerPopcornPlayer()` - Manual registration function

### Renderer
- `Canvas2DRenderer` - Canvas 2D implementation
- `Renderer` (type) - Abstract renderer interface
- Matrix utilities: `multiplyMatrices`, `translationMatrix`, `rotationMatrix`, `scaleMatrix`
- Color utilities: `colorToCSS`, `parseColor`

### Scene
- `SceneBuilder`, `buildSceneGraph` - Build scene from AST
- `SceneNode`, `Transform`, `ShapeData` (types) - Scene graph types
- `createSceneNode`, `createDefaultTransform`, `cloneTransform` - Factory functions
- `parsePath` - SVG path parser
- Transform utilities: `computeLocalMatrix`, `computeWorldMatrix`

### Animation
- `AnimationScheduler` - Animation timing controller
- `applyEasing` - Apply easing functions
- `EasingFunctions` - Collection of easing functions
- `interpolateKeyframes` - Keyframe interpolation

### Runtime
- `RenderLoop` - Main render loop orchestrator
- `InputTracker` - Mouse/scroll input tracking
- `VariableResolver` - CSS variable resolution

## DSL Syntax

See the main project README for full DSL documentation.

### Basic Shapes

```css
#rect {
  type: rect;
  x: 100px;
  y: 100px;
  width: 200px;
  height: 150px;
  fill: #4ecdc4;
}

#circle {
  type: circle;
  cx: 300px;
  cy: 200px;
  r: 50px;
  fill: #e94560;
}
```

### Animations

```css
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

#spinner {
  type: rect;
  animation: spin 2s linear infinite;
}
```

### Interactivity

```css
:root {
  --cursor-x: input(cursor.x);
  --cursor-y: input(cursor.y);
}

#follower {
  type: circle;
  cx: var(--cursor-x);
  cy: var(--cursor-y);
  r: 20px;
  fill: #ffe66d;
}
```

## License

MIT
