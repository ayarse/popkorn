# @popkorn/expo-demo

An Expo app for trying the `@popkorn/react-native` renderer on a real device.
It is a single screen: a full-screen `PopkornView` with a row of chips for
picking a scene from the `examples/popkorn/*.css` gallery (the same scenes as
the playground, plus a Thanksgiving turkey), swatches for the color behind
transparent scenes, and two buttons. **Edit CSS** opens a bottom-sheet editor
with syntax highlighting; **Load** swaps the scene in, and parse errors show
inline. **Load URL** fetches a `.css` scene from a URL, or reads the URL off a
QR code with **Scan QR**.

The default scene is the turkey, converted from
`examples/lottie/thanksgiving-turkey.json` and inlined in `turkey.ts`. It is
made of plain shapes and paths. The Skia renderer also draws text (system
fonts), images, and track mattes. Custom fonts and CSS filters are not yet
supported on Skia; filtered scenes draw unfiltered. See the
`@popkorn/react-native` README for details.

Metro can't glob or import raw `.css` files, so the gallery is inlined into
`examples.gen.ts` (for the same reason, `turkey.ts` holds its scene as a
string). The file is generated; after editing `examples/popkorn/*.css`, run
`bun --filter @popkorn/expo-demo gen` from the repo root.

## Running on a device

`@shopify/react-native-skia` ships native code that Expo Go doesn't include,
so the app needs a development build. `expo run:*` compiles the native
project, installs the app, and starts Metro:

```sh
bun install                       # once, from the repo root

cd packages/expo-demo
bunx expo run:ios      # connected iPhone or simulator
# or
bunx expo run:android  # connected Android device
```

To reconnect later, run `bunx expo start --dev-client` and open the installed
app.

Without Xcode or Android Studio locally, build on EAS instead:
`bunx eas build --profile development --platform ios` (or `android`), install
the build, then run `bunx expo start --dev-client`.

Several dependencies carry native code: `@shopify/react-native-skia`,
`react-native-reanimated` with its `react-native-worklets` peer (required by
Skia 2.x even though the demo doesn't call Reanimated directly), `expo-camera`
for QR scanning, and `react-native-safe-area-context`. Adding or upgrading any
of them means rebuilding the dev client with `bunx expo run:ios` (or
`run:android`).

## Notes

Metro's monorepo resolution lives in `metro.config.js`: it watches the repo
root and resolves hoisted dependencies from both `node_modules` folders.
`@popkorn/react-native` and `@popkorn/player` ship raw TypeScript from `src/`,
which `babel-preset-expo` transpiles. The preset also detects
`react-native-worklets` and adds its Babel plugin, so `babel.config.js` needs
no worklets entry.

To check that the app bundles without a device, run
`bunx expo export --platform ios`.

The camera permission for QR scanning is configured through the `expo-camera`
plugin in `app.json`. The URL fetch is a plain `fetch()`.

The CSS editor is `@rivascva/react-native-code-editor`, a pure-JS `TextInput`
over `react-syntax-highlighter`. The highlighter re-parses the whole source on
every render, so above `HIGHLIGHT_LINE_CAP` (300 lines, in `App.tsx`) the
editor switches to a plain `TextInput`. The turkey scene is well over that
limit.
