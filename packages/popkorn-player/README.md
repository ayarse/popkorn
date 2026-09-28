# @popkorn/player

The web runtime for Popkorn, a format for portable motion graphics written in a close CSS dialect. It provides the `<popkorn-player>` web component and the player underneath it, which draws scenes to a canvas. See the [main README](https://github.com/ayarse/popkorn#readme) for what Popkorn is and why.

## Installation

```bash
bun add @popkorn/player
```

## Quick start

### The web component

Load the package and give a `<popkorn-player>` element a scene:

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

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `width` | number | Canvas width in pixels (default: 400) |
| `height` | number | Canvas height in pixels (default: 300) |
| `background` | string | Background color (CSS color value) |
| `src` | string | URL to fetch scene source from (http(s), relative, `data:`, `blob:`). For inline scene *text*, use the `.source` property instead. |
| `loop` | boolean | Whether the timeline loops |
| `controls` | boolean | Show the built-in play/pause/scrub bar |
| `autoplay` | boolean | Whether playback auto-starts (default true; set `autoplay="false"` to opt out) |
| `fit` | string | How the scene fits the host: `contain` (default), `cover`, `fill`, or `none` |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `source` | string | Get/set the scene source *text* directly (the inline channel, not a URL) |
| `src` | string \| null | Get/set the `src` URL attribute (fetched into `source`) |
| `width` | number | Get/set canvas width |
| `height` | number | Get/set canvas height |
| `background` | string \| null | Get/set background color |
| `loop` | boolean | Get/set whether the timeline loops |
| `controls` | boolean | Get/set whether the controls bar is shown |
| `autoplay` | boolean | Get/set whether playback auto-starts |
| `fit` | string | Get/set the fit mode |
| `currentTime` | number (read-only) | Current timeline position in milliseconds |
| `duration` | number (read-only) | Scene duration in milliseconds: 0 with no animations, `Infinity` for an unbounded scene (infinite loops or a state machine) |
| `paused` | boolean (read-only) | Whether the timeline is currently frozen |

### Methods

| Method | Description |
|--------|-------------|
| `play()` | Start or resume playback |
| `stop()` | Stop playback |
| `reset()` | Reset animations to initial state |
| `pause()` | Freeze the timeline (interaction stays live) |
| `resume()` | Resume the timeline from where it was paused |
| `seek(ms)` | Jump to a timeline position in milliseconds and render it, even while paused |
| `setVariable(name, value)` | Set an author-declared `--variable` from the host |
| `getVariable(name)` | Read an author-declared `--variable`'s current value |
| `fire(name)` | Fire a trigger variable or a machine event into the scene |
| `getTimelineTracks()` | A serializable snapshot of every animated node's timing and keyframes, for an external timeline UI |

### Events

All events are namespaced under `popkorn:`.

| Event | Detail | Description |
|-------|--------|-------------|
| `popkorn:ready` | `{ sceneRoot: SceneNode, duration: number }` | Fired when the scene is parsed and ready to play; `duration` matches the `duration` property |
| `popkorn:complete` | none | Fired once when a non-looping timeline reaches its end |
| `popkorn:error` | `{ error: Error }` | Fired on parse or `src` load / initialization error |
| `popkorn:timeupdate` | `{ time: number, duration: number }` | Fired every rendered frame (drives external scrubbers) |
| `popkorn:click` | `{ id: string, path: string[], x: number, y: number }` | Fired (no opt-in) when a press+release land on the same shape; `id`/`path` credit the nearest `cursor: pointer`/interactive ancestor, `x`/`y` are scene coordinates |

For interactive scenes the player also dispatches `popkorn:statechange` and
`popkorn:machine-event`; see the
[state machines guide](https://github.com/ayarse/popkorn/blob/main/docs/state-machines.md).

## React

In React, a small wrapper sets `source` through a ref:

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

## Driving the player directly

The web component is a thin layer over the parser, scene builder and render loop, which can be used on their own:

```ts
import {
  parse,
  buildSceneGraph,
  Canvas2DRenderer,
  RenderLoop,
  AnimationScheduler,
} from '@popkorn/player';

const scene = buildSceneGraph(parse(source));
const renderer = new Canvas2DRenderer(document.querySelector('canvas'));

const loop = new RenderLoop(renderer, new AnimationScheduler());
loop.setScene(scene);
loop.setBackgroundColor('#1a1a2e');
loop.start();
// ...
loop.stop();
```

## Module exports

The package index also exports the pieces the web component is built from, for
hosts that drive playback themselves and for authors of new rendering backends.

The parser is re-exported as `parse`, with its AST types (`StyleSheet`, `Rule`,
`Declaration`, `KeyframeRule`, `Value`, `VariableDefinition`). The web
component is `PopkornPlayer`, with `registerPopkornPlayer()` for manual
registration; `TimelineTrack`, `TimelineAnimation` and
`TimelineAnimationProperty` type what `getTimelineTracks()` returns.

| Area | Exports |
|------|---------|
| Scene | `buildSceneGraph`, `resetNodeToBase`, `resolveClip`; types `SceneNode`, `Transform`, `ShapeData`, `MaskMode`, `TextAnchor`, `TimingFunction` |
| Transforms and matrices | `computeLocalMatrix`, `computeWorldMatrix`, `resolveTransformOrigin`, `multiplyMatrices`, `transformPoint`, `lerp`, `IDENTITY_MATRIX` |
| Paths and geometry | `parsePath`, `applyCommandsToPath`, `computePathBounds`, `computePathLength`, `roundedRectPath`, `polystarToCommands`, `anchorX`, `setTextMeasurer` |
| Animation | `AnimationScheduler`, `computeSceneDuration`, `applyEasing` |
| Runtime | `RenderLoop`, `hitTest`, `InputTracker`, `InteractionManager`, `VariableResolver`, `readsInput`, `sceneExportLength` |
| Viewport | `computeViewport`, `viewportMatrix`, `deviceToScene`; types `FitMode`, `Viewport` |
| Rendering | `Canvas2DRenderer`, the `Renderer` interface type, `PaintStateRenderer`, `maskModeParts`, `resolveGradient`, `ellipseBox`, `resolveStrokeDash`, `paintOrderSequence`, `PendingImages`, `newImageDest`, `resolveImageDest`, `parseColor`, `tryParseColor`, `LUMA_COEFFICIENTS` |

For backend authors, `registerConformance(runner, harness)` registers the
cross-backend conformance cases (`CONFORMANCE_CASES`, `MASK_MODES`) with a test
runner against a harness for a new `Renderer`. The Canvas2D, SVG and Skia
backends are held to the same table.

## Scene syntax

See [docs/reference.md](https://github.com/ayarse/popkorn/blob/main/docs/reference.md) for the full format reference.

### Shapes

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
