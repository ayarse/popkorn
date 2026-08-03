---
"@popkorn/parser": patch
"@popkorn/player": patch
"@popkorn/converters": patch
"@popkorn/react-native": patch
---

Fix published packages for strict ESM consumers: explicit `.js` extensions in all relative imports (plain Node and Webpack 5 could not resolve the dist output), and fix the publish script so `@popkorn/converters` gets its `workspace:*` deps resolved and dist-pointing entry fields applied (it was uninstallable via npm).
