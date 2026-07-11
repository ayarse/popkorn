// Metro config for the bun-workspace monorepo. @popkorn/react-native and @popkorn/player
// ship raw TS from their `src/`; watching the repo root lets babel-preset-expo
// transpile them, and nodeModulesPaths resolves the hoisted deps.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// The @popkorn/react-native workspace package declares react / react-native /
// @shopify/react-native-skia as `*` peers, so its own node_modules can hold a
// DIFFERENT version than this app. Force these singletons to the app's copy so
// @popkorn/react-native/src resolves the exact react-native + Skia the app links.
const forced = ['react', 'react-native', '@shopify/react-native-skia'];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const match = forced.find((n) => moduleName === n || moduleName.startsWith(n + '/'));
  if (match) {
    return context.resolveRequest(
      context,
      path.join(projectRoot, 'node_modules', moduleName),
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
