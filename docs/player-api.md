# Player API

To put a Popcorn scene in your own project, you render it with a player. On the
web that's the `<popcorn-player>` web component (with a lower-level API
underneath); on mobile it's a React Native component. All of them play the same
scene file.

## The web component

The simplest way to render a scene is the custom element from `@popcorn/player`.

```html
<script type="module">
  import "@popcorn/player";
</script>

<popcorn-player width="400" height="400"></popcorn-player>

<script>
  const player = document.querySelector("popcorn-player");
  player.source = `
    #dot { type: circle; cx: 200px; cy: 200px; r: 40px; fill: #e94560; }
  `;
</script>
```

Give it a scene two ways: set the `.source` property to scene text (as above), or
point the `src` attribute at a file to fetch.

### Attributes

| Attribute    | Type   | Description                                          |
| ------------ | ------ | --------------------------------------------------- |
| `width`      | number | Canvas width in pixels (default 400).               |
| `height`     | number | Canvas height in pixels (default 300).              |
| `background` | string | Background color (any CSS color value).             |
| `src`        | string | URL to fetch scene source from. For inline scene text, use the `.source` property instead. |

### Properties

| Property     | Type            | Description                                             |
| ------------ | --------------- | ------------------------------------------------------ |
| `source`     | string          | Get/set the scene source text directly (the inline channel, not a URL). |
| `src`        | string \| null  | Get/set the `src` URL (fetched into `source`).         |
| `width`      | number          | Get/set canvas width.                                  |
| `height`     | number          | Get/set canvas height.                                 |
| `background` | string \| null  | Get/set background color.                              |

### Methods

| Method    | Description                       |
| --------- | -------------------------------- |
| `play()`  | Start or resume playback.        |
| `stop()`  | Stop playback.                   |
| `reset()` | Reset animations to their start. |

### Events

| Event      | Detail                     | Fires when                                        |
| ---------- | -------------------------- | ------------------------------------------------- |
| `ready`    | `{ sceneRoot }`            | the scene is parsed and ready.                    |
| `complete` | none                       | a non-looping timeline reaches its end.           |
| `error`    | `{ error }`                | a parse, load, or initialization error occurs.    |

For interactive scenes, the player also dispatches `statechange` and
`machine-event` (see [State machines](state-machines.md)).

## In React

The web component works in React; wrap it so you can pass a scene as a prop.
React under-reflects custom-element properties, so set `.source` in an effect.

```tsx
import { useRef, useEffect } from "react";
import "@popcorn/player";
import type { PopcornPlayer } from "@popcorn/player";

function Scene({ source, width = 400, height = 400 }) {
  const ref = useRef<PopcornPlayer>(null);
  useEffect(() => {
    if (ref.current) ref.current.source = source;
  }, [source]);
  return <popcorn-player ref={ref} width={width} height={height} />;
}
```

## Driving the renderer yourself

For full control, skip the component and drive the pieces directly. This is the
path when you manage your own canvas or render loop.

```ts
import {
  parse,
  buildSceneGraph,
  Canvas2DRenderer,
  RenderLoop,
} from "@popcorn/player";

const scene = buildSceneGraph(parse(source));
const loop = new RenderLoop(new Canvas2DRenderer(canvas));
loop.setScene(scene);
loop.start();
```

The parser, scene builder, renderer, animation scheduler, and input tracker are
all exported. The full export list is in the
[`@popcorn/player` README](../packages/popcorn-player/README.md).

## On mobile (React Native)

The same scene runs natively through `@popcorn/react-native`, a Skia renderer.

```tsx
import { PopcornView } from "@popcorn/react-native";

<PopcornView source={scene} width={300} height={300} loop />;
```

It needs `@shopify/react-native-skia` and works on the web too via
`react-native-web` and CanvasKit. Setup and props are in the
[`@popcorn/react-native` README](../packages/popcorn-react-native/README.md).
This renderer is an early proof of concept and still marked work-in-progress.

## See also

- [Getting Started](getting-started.md) to write a scene first.
- [Format reference](reference.md) for the scene syntax itself.
