# @popkorn/expo-demo

Expo app to test the `@popkorn/react-native` renderer on a real device. One
screen: a full-screen `PopkornView` with

- an **example picker** — horizontal chips for the `examples/popkorn/*.css`
  gallery (plus the turkey), same scenes as the playground;
- **background swatches** to fill behind transparent scenes (like the
  playground's stage-background control);
- a floating **Edit CSS** button opening a bottom-sheet editor
  (syntax-highlighted input + Load/Cancel), swapping the scene on Load (parse
  errors show inline, no crash);
- a **Load URL** button — fetch a `.css` scene from a URL, or **Scan QR** to
  read the URL off a QR code (camera) and load it.

The default scene is the Thanksgiving turkey
(`examples/lottie/thanksgiving-turkey.json`, converted to Popkorn CSS and
inlined in `turkey.ts`) — pure shapes and paths, so it renders fully on the
Skia PoC (which defers text/images).

The gallery is inlined into `examples.gen.ts` because Metro can't glob or import
raw `.css` (same reason `turkey.ts` is a string). After editing
`examples/popkorn/*.css`, regenerate: `bun run gen`.

## Running on a physical device

`@shopify/react-native-skia` ships native code that **is not bundled in Expo
Go**, so a **development build is required** — Expo Go will error on the missing
native module. Use `expo run:*` (a local dev build):

```sh
bun install                       # once, from the repo root

cd packages/expo-demo
bunx expo run:ios      # builds + installs on a connected iPhone / simulator
# or
bunx expo run:android  # builds + installs on a connected Android device
```

`expo run:*` compiles the native project, installs the app, and starts Metro.
Reconnect later with `bunx expo start --dev-client` and open the installed app.

For a device build without Xcode/Android Studio locally, use EAS:
`bunx eas build --profile development --platform ios` (or `android`), install
the resulting build, then `bunx expo start --dev-client`.

> Expo Go (`bunx expo start`, scan the QR) will **not** work here because of the
> native Skia dependency.

## Notes

- Monorepo Metro resolution is set in `metro.config.js` (watch the repo root,
  resolve hoisted deps from both node_modules). `@popkorn/react-native` and
  `@popkorn/player` ship raw TS from `src/`; `babel-preset-expo` transpiles it.
- `@shopify/react-native-skia` 2.x requires `react-native-reanimated` (and its
  `react-native-worklets` peer) as native dependencies, even though this demo
  doesn't call Reanimated APIs directly. `babel-preset-expo` auto-detects
  `react-native-worklets` and wires its Babel plugin in — no `babel.config.js`
  changes needed. Adding/upgrading either package changes native code, so
  **rebuild the dev client**: `bunx expo run:ios` (or `run:android`).
- To sanity-check bundling without a device:
  `bunx expo export --platform ios`.
- QR scanning uses `expo-camera` (native code) with the camera-permission
  plugin wired in `app.json` — **rebuild the dev client** after pulling this in
  (`bunx expo run:ios`/`run:android`). The URL fetch itself is a plain
  `fetch()`; only the QR camera needs the rebuild.
- Safe areas use `react-native-safe-area-context` (adds native code — rebuild
  the dev client after pulling this in, same as above). The CSS editor uses
  `@rivascva/react-native-code-editor`, which is pure JS (a `TextInput`
  overlaid on `react-syntax-highlighter`) — no native module, no rebuild
  needed for that one.
