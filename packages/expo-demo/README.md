# @popkorn/expo-demo

Minimal Expo app to test the `@popkorn/react-native` renderer on a real device. One
screen: a full-screen `PopkornView`, a floating **Edit CSS** button that opens
a bottom-sheet editor (syntax-highlighted CSS input + Load/Cancel), swapping
the scene on Load (parse errors show inline in the sheet, no crash).

The default scene is the Thanksgiving turkey
(`examples/lottie/thanksgiving-turkey.json`, converted to Popkorn CSS and
inlined in `turkey.ts`) — pure shapes and paths, so it renders fully on the
Skia PoC (which defers text/images).

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
- Safe areas use `react-native-safe-area-context` (adds native code — rebuild
  the dev client after pulling this in, same as above). The CSS editor uses
  `@rivascva/react-native-code-editor`, which is pure JS (a `TextInput`
  overlaid on `react-syntax-highlighter`) — no native module, no rebuild
  needed for that one.
