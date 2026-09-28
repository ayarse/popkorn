# @popkorn/react-native

A React Native renderer for [Popkorn](https://github.com/ayarse/popkorn#readme),
built on `@shopify/react-native-skia`. The same scene file plays in a React
Native app and on the web through `react-native-web` and CanvasKit. It is in
very early proof-of-concept stages, with the supported surface still growing.

The package implements the `Renderer` interface from `@popkorn/player` on top of
Skia's imperative API and drives the player's `RenderLoop`. Scene building,
animation, timing, and viewport math all come from `@popkorn/player`, so a scene
behaves the same here as it does in the browser.

## Install

```sh
bun add @popkorn/react-native @shopify/react-native-skia react react-native
```

## React Native usage

```tsx
import { PopkornView } from "@popkorn/react-native";

const scene = `
  :root { width: 300px; height: 300px; background: #0f0f23 }
  #dot {
    type: circle; cx: 150px; cy: 150px; r: 40px; fill: #4ecdc4;
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse { from { r: 40px } to { r: 60px } }
`;

export default function App() {
  return <PopkornView source={scene} width={300} height={300} loop />;
}
```

Props: `source` (scene string), `width`, `height`, `autoplay` (default `true`),
`loop` (default `false`), `paused` (freeze the timeline without tearing down
the loop), `onStateChange` (`(e: {machine, from, to}) => void`, fires per
`@machine` transition), `onMachineEvent` (`(e: {machine, name}) => void`,
fires on `emit: name`).

## Web usage

Use `react-native-web` and load CanvasKit before rendering:

```tsx
import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

LoadSkiaWeb().then(async () => {
  const App = (await import("./App")).default;
  // ...render App (react-native-web resolves `react-native` to the web shim)
});
```

## Imperative ref

`PopkornView` forwards a `PopkornViewRef` (exported from `interop.ts`) for
host-driven state:

```ts
setVariable(name: string, value: number | boolean): void;
getVariable(name: string): number | boolean | string | undefined;
fire(name: string): void;
```

`setVariable`/`getVariable` read and write a declared `--variable`; `fire`
triggers a declared `trigger` var for one frame, or enqueues a machine
`on event(name)` if `name` isn't a declared variable.

## Direct renderer use

`SkiaRenderer` is injectable: construct it with the `Skia` API object and bind a
canvas per frame, then feed it to a `RenderLoop`:

```ts
import { Skia } from "@shopify/react-native-skia";
import { SkiaRenderer } from "@popkorn/react-native";

const renderer = new SkiaRenderer(Skia, { width, height });
renderer.setCanvas(recorder.beginRecording(bounds));
```

## Rendering support

Shapes, paths, gradients, text, images, track mattes, and touch input are
supported. Text is drawn with the platform's system fonts. Images decode once
per source and draw transparent until the decode finishes. Track mattes
composite through nested `saveLayer` blends. Touch goes through React Native's
responder system, so taps fire state-machine triggers.

Still in progress:

- **Custom fonts.** Text uses system fonts only; loading custom typefaces is
  not yet supported.
- **Filters.** CSS `filter` is skipped on Skia, and filtered elements draw
  unfiltered (with a one-time warning).
- **Arcs.** SVG `A` path commands are approximated with 24-segment polylines.
