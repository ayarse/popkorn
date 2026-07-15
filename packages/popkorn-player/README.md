# @popkorn/player

The `<popkorn-player>` web component and Canvas2D engine that plays the Popkorn format, a small, CSS-like format for interactive motion graphics. See the [main README](https://github.com/ayarse/popkorn#readme) for what Popkorn is and why.

## Installation

```bash
bun add @popkorn/player
```

## Quick Start

### Using the Web Component

The simplest way to use the player is via the `<popkorn-player>` custom element:

```html
<script type="module">
  import '@popkorn/player';
</script>

<popkorn-player
  width="800"
  height="600"
  background="#1a1a2e"
></popkorn-player>

<script>
  const player = document.querySelector('popkorn-player');
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
| `src` | string | URL to fetch scene source from (http(s), relative, `data:`, `blob:`). For inline scene *text*, use the `.source` property instead. |

### Web Component Properties

| Property | Type | Description |
|----------|------|-------------|
| `source` | string | Get/set the scene source *text* directly (the inline channel, not a URL) |
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

All events are namespaced under `popkorn:`.

| Event | Detail | Description |
|-------|--------|-------------|
| `popkorn:ready` | `{ sceneRoot: SceneNode, duration: number }` | Fired when scene is parsed and ready (`duration` in ms, 0 when the scene has no animations) |
| `popkorn:complete` | — | Fired once when a non-looping timeline reaches its end |
| `popkorn:error` | `{ error: Error }` | Fired on parse or `src` load / initialization error |
| `popkorn:timeupdate` | `{ time: number, duration: number }` | Fired every rendered frame (drives external scrubbers) |
| `popkorn:click` | `{ id: string, path: string[], x: number, y: number }` | Fired (no opt-in) when a press+release land on the same shape; `id`/`path` credit the nearest `cursor: pointer`/interactive ancestor, `x`/`y` are scene coordinates |

For interactive scenes the player also dispatches `popkorn:statechange` and
`popkorn:machine-event` — see the
[state machines guide](https://github.com/ayarse/popkorn/blob/main/docs/state-machines.md).

## React Integration

For React apps, you can create a simple wrapper:

```tsx
import { useRef, useEffect } from 'react';
import '@popkorn/player';
import type { PopkornPlayer } from '@popkorn/player';

function MotionCanvas({ source, width = 800, height = 600, background }) {
  const playerRef = useRef<PopkornPlayer>(null);

  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.source = source;
    }
  }, [source]);

  return (
    <popkorn-player
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
} from '@popkorn/player';

// Parse the scene source
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
- `PopkornPlayer` - The custom element class
- `registerPopkornPlayer()` - Manual registration function

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
- `interpolateKeyframes` - Keyframe interpolation

### Runtime
- `RenderLoop` - Main render loop orchestrator
- `InputTracker` - Mouse/scroll input tracking
- `VariableResolver` - CSS variable resolution

## Scene syntax

See [docs/reference.md](https://github.com/ayarse/popkorn/blob/main/docs/reference.md) for the full format reference.

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
