import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import "vite-plus/test/config";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";

// Quirks is a loopback single-user tool: no auth, no relay, no remote access
// (docs/FOUNDING.md "do NOT build"). So the t3code web config is mirrored
// without its Clerk / OTLP / msw / single-origin env plumbing — there is
// nothing to authenticate against. Its *dev proxy* is kept, and is load
// bearing: see below.

// ---------------------------------------------------------------------------
// Dev proxy — the only way this page can READ the daemon (QK-WB-003)
//
// The quirks daemon is a loopback tool that sets no CORS headers at all
// (src/service/app.ts). A cross-origin `fetch` from http://localhost:5733 to
// the daemon therefore cannot read a single byte of /v1/goals: the response
// arrives and the browser discards it for want of Access-Control-Allow-Origin.
// Adding CORS to the daemon would widen a deliberately closed surface, so the
// fix belongs on this side — mirror t3code's apps/web `server.proxy` over
// shared path prefixes and make dev single-origin. The page then requests
// `/v1/...` on its own origin (see src/lib/service.ts, whose base URL is now
// "") and Vite forwards it.
//
// Target port: the daemon binds a port derived from the ABSOLUTE repo root
// (`portForRoot` in src/service/daemon.ts) —
//
//   45000 + (sha256(root).readUInt32BE(0) % 15000)
//
// re-derived here rather than read from the daemon's advisory record, exactly
// as src/cli/client.ts re-derives it. `root` is this file's directory less
// `apps/web`, with no trailing slash — the daemon hashes `store.root` in that
// same form, and a stray slash hashes to a different port.
//
// Overrides, in precedence order (the first two mirror what the daemon itself
// honors, so a moved daemon and this proxy cannot disagree):
//   QUIRKS_URL   full origin, e.g. http://127.0.0.1:47301
//   QUIRKS_PORT  port only — the same env var portForRoot() checks first
//   derived      45000 + sha256(repo root)
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

/** Verbatim port math from src/service/daemon.ts — that file is the authority. */
function portForRoot(root: string): number {
  const configured = Number.parseInt(process.env.QUIRKS_PORT ?? "", 10);
  if (Number.isInteger(configured) && configured > 1023 && configured < 65536) {
    return configured;
  }
  return 45000 + (createHash("sha256").update(root).digest().readUInt32BE(0) % 15000);
}

const daemonUrl = process.env.QUIRKS_URL?.trim() || `http://127.0.0.1:${portForRoot(repoRoot)}`;

/**
 * Path prefixes the daemon owns. `/v1` is the ledger API; `/shape` is the
 * companion (QK-WB-005) — proxied so its SSE stream and probe are same-origin
 * too. NOTE: /shape/ still answers `X-Frame-Options: DENY`, which the proxy
 * faithfully forwards, so the Shape iframe stays blank until the server lane
 * relaxes that header. Proxying it is still worth it: the probe and the
 * events stream become readable.
 */
const DAEMON_PATH_PREFIXES = ["/v1", "/shape"] as const;

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
    proxy: Object.fromEntries(
      DAEMON_PATH_PREFIXES.map((prefix) => [prefix, { target: daemonUrl, changeOrigin: true }]),
    ),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    projects: [defineProject(unitTestProject)],
  },
});
