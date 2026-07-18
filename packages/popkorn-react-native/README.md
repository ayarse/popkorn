# @popkorn/react-native

A React Native Skia renderer for [Popkorn](https://github.com/ayarse/popkorn#readme), a proof of concept.
It plays Popkorn scenes on `@shopify/react-native-skia`, so the same file runs on
React Native **and** the web (via `react-native-web` + CanvasKit).

It implements the `Renderer` contract from `@popkorn/player` on top of the
imperative `Skia.*` API and drives the renderer-agnostic `RenderLoop`, so scene
building, animation, timing, and viewport math are shared verbatim with the
Canvas2D player.

## Install

Install the library along with its other dependencies:

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

Text, images, track mattes, and touch input all render now: text goes through a
system font manager, images through a per-source decode cache (transparent until
the decode lands), track mattes composite via nested `saveLayer` blends, and
touch is wired through React Native's responder so taps fire state-machine
triggers.

## WIP

- **Custom fonts.** Text uses the platform's system fonts only — there is no
  custom-font/typeface loading yet.
- **Arcs.** SVG `A` commands are polyline-approximated (24 segments).
