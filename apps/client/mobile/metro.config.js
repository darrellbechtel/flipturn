const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

// Find the project and workspace directories
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];
// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// NOTE: do NOT set `disableHierarchicalLookup = true` — that breaks
// Expo's `expo/metro-runtime` alias under pnpm's symlinked layout
// (the alias is set up by `expo/metro-config` and relies on Metro
// walking up node_modules ancestors to resolve `@expo/metro-runtime`).
// 3. Use Metro's package.json `exports` field support so subpath
//    imports like `expo/metro-runtime` resolve correctly.
config.resolver.unstable_enablePackageExports = true;

// 4. Bridge TypeScript's "Bundler" moduleResolution to Metro's resolver:
//    our packages share `moduleResolution: "Bundler"` and import sibling TS
//    files with `.js` extensions (the Node ESM convention used in every
//    server package). Metro's resolver tries `.js` literally and never
//    falls back to `.tsx` / `.ts`. This wrapper retries without `.js` so
//    Metro's standard extension list (`.tsx`, `.ts`, `.jsx`, `.js`) kicks in.
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  try {
    return resolve(context, moduleName, platform);
  } catch (err) {
    if (
      moduleName.endsWith('.js') &&
      (moduleName.startsWith('./') || moduleName.startsWith('../'))
    ) {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
    throw err;
  }
};

module.exports = config;
