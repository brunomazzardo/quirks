import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import "vite-plus/test/config";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";

// Quirks is a loopback single-user tool: no auth, no relay, no remote access
// (docs/FOUNDING.md "do NOT build"). So the t3code web config is mirrored
// without its Clerk / OTLP / msw / dev-proxy / single-origin env plumbing —
// there is no second origin to reach and nothing to authenticate against.

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
  },
} satisfies TestProjectInlineConfiguration;

export default defineConfig({
  plugins: [
    // Generates src/routeTree.gen.ts from src/routes/** on dev and build, so
    // the route tree is never hand-maintained. It is lint/fmt-ignored at root.
    tanstackRouter(),
    react(),
    babel({
      // @vitejs/plugin-react v6 only infers the TS/JSX parsers from paths
      // relative to the CWD; being explicit keeps workspace packages parsable.
      parserOpts: { plugins: ["typescript", "jsx"] },
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
  ],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "localhost",
    port: 5733,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    projects: [defineProject(unitTestProject)],
  },
});
