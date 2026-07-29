import path from "node:path";
import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import "vite-plus/test/config";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import { serviceOriginFor } from "@quirks/shared";

// Quirks is a loopback single-user tool: no auth, no relay, no remote access
// (docs/FOUNDING.md "do NOT build"). So the t3code web config is mirrored
// without its Clerk / OTLP / msw / single-origin env plumbing — there is
// nothing to authenticate against. Its *dev proxy* is kept, and is load
// bearing: see below.

// ---------------------------------------------------------------------------
// Dev proxy — the only way this page can READ the daemon (QK-WB-003)
//
// The quirks daemon is a loopback tool that sets no CORS headers at all
// (apps/server/src/http/Routes.ts). A cross-origin `fetch` from
// http://localhost:5733 to the daemon therefore cannot READ a single byte of
// /v1/goals: the response arrives and the browser discards it for want of
// Access-Control-Allow-Origin. (Reading is the whole of that claim — a write
// happens whether or not its response is legible, which is why the daemon
// refuses cross-origin writes in `originGuard`, apps/server/src/http/Wire.ts.)
// Adding CORS to the daemon would widen a deliberately closed surface, so the
// fix belongs on this side — mirror t3code's apps/web `server.proxy` over
// shared path prefixes and make dev single-origin. The page then requests
// `/v1/...` on its own origin (see src/lib/service.ts, whose base URL is now
// "") and Vite forwards it.
//
// Target port: the daemon binds a port derived from the ABSOLUTE repo root, and
// `serviceOriginFor` (@quirks/shared) is the one definition of that derivation —
// imported rather than re-implemented, because the derivation IS the address and
// a second copy is a proxy that forwards to a daemon nobody is running. This
// file used to carry its own transcription of the hash.
//
// `root` is this file's directory less `apps/web`, with no trailing slash — the
// daemon hashes `store.root` in that same form, and a stray slash hashes to a
// different port.
//
// Overrides, in precedence order (both honored by the daemon itself, so a moved
// daemon and this proxy cannot disagree):
//   QUIRKS_URL   full origin, e.g. http://127.0.0.1:47301
//   QUIRKS_PORT  port only
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const daemonUrl = serviceOriginFor(repoRoot);

/**
 * Path prefixes the daemon owns. `/v1` is the ledger API; `/shape` is the
 * companion (QK-WB-005) — proxied so its SSE stream, probe, and iframe are
 * same-origin. /shape/ answers `X-Frame-Options: SAMEORIGIN` (QK-WB-009), so
 * the framed companion paints through this proxy.
 *
 * `ws` marks a prefix that must also forward the HTTP Upgrade handshake.
 * `/v1/pty` carries the terminal socket (QK-WB-004): without `ws: true` Vite
 * proxies the ordinary requests underneath it and then answers the upgrade
 * itself, so the terminal would look exactly like a daemon that is down. It is
 * listed BEFORE `/v1` because the proxy table is matched in insertion order and
 * the broader prefix would otherwise swallow it.
 */
const DAEMON_PATH_PREFIXES = [
  { prefix: "/v1/pty", ws: true },
  { prefix: "/v1", ws: false },
  { prefix: "/shape", ws: false },
] as const;

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
      DAEMON_PATH_PREFIXES.map(({ prefix, ws }) => [
        prefix,
        { target: daemonUrl, changeOrigin: true, ...(ws ? { ws: true } : {}) },
      ]),
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
