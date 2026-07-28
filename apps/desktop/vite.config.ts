import { defineConfig } from "vite-plus";

// Mirrors t3code's apps/desktop/vite.config.ts: `vp pack` emits one CJS bundle
// per Electron entry into dist-electron/, because Electron's main process and
// sandboxed preloads both load CommonJS and package.json "main" points at
// dist-electron/main.cjs.
//
// Trimmed: no Clerk publishable-key define, no react-grab/preview preloads, no
// preview annotation CSS step. Bundling is total — the main process imports
// only `electron` and node builtins — which is why the packaged app can drop
// node_modules entirely (see electron-builder.yml).

const packEntry = (entry: string) => ({
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: true,
  outExtensions: () => ({ js: ".cjs" }),
  entry: [entry],
  deps: {
    // `electron` is a devDependency (electron-builder refuses to package it as
    // a runtime one), and tsdown bundles devDependencies by default. Bundling
    // it inlines the npm shim that reads node_modules/electron/path.txt, which
    // then throws "Electron failed to install correctly" inside the packaged
    // app. Every entry must resolve it to Electron's own built-in module.
    neverBundle: ["electron"],
  },
});

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        cache: false,
      },
      // Assumes `pnpm --filter @quirks/web dev` is already running; the launcher
      // waits for port 5733 and says so if it is not.
      dev: {
        command: "vp pack && node scripts/dev-electron.mjs",
        cache: false,
      },
      // Unpacked .app bundle — enough to prove the packaging works without
      // paying for DMG creation.
      "dist:dir": {
        command: "vp pack && electron-builder --mac --dir --config electron-builder.yml",
        dependsOn: ["@quirks/web#build"],
        cache: false,
      },
      dist: {
        command: "vp pack && electron-builder --mac --config electron-builder.yml",
        dependsOn: ["@quirks/web#build"],
        cache: false,
      },
    },
  },
  pack: [
    // clean only on the first entry, or each pack would wipe the previous one.
    { ...packEntry("src/main.ts"), clean: true },
    { ...packEntry("src/preload.ts") },
  ],
});
