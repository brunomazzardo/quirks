// Base URL for the quirks daemon's HTTP API (the bun-era service; see
// ../../../../src/service/app.ts and ../../../../src/service/daemon.ts).
//
// The default is SAME-ORIGIN: an empty base, so callers request `/v1/goals`
// and `/shape/` on whatever origin served the page. That is not a stylistic
// preference — it is the only arrangement in which a browser page can READ
// these routes. The daemon sets no CORS headers (loopback-only tool, by
// design), so a cross-origin `fetch` in "cors" mode receives the bytes and
// then discards them for want of Access-Control-Allow-Origin. In dev, Vite's
// `server.proxy` (../../vite.config.ts) forwards `/v1` and `/shape` to the
// daemon, which it locates by re-deriving the daemon's hashed port from the
// absolute repo root — `portForRoot` in src/service/daemon.ts is the
// authority, and src/cli/client.ts re-derives it the same way:
//
//   45000 + (sha256(root).readUInt32BE(0) % 15000)
//
// So there is no single fixed port across machines or checkouts, and the
// daemon's advisory record (`daemon.json`, see src/paths.ts) lives under the
// OS state directory — outside this repo, and outside a browser page's reach.
// Deriving it in the Vite config (which has a filesystem and node:crypto) is
// what keeps the page itself from needing to know any of this.
//
// `VITE_QUIRKS_URL` still wins when set, and is what any build with no Vite
// dev server in front of it must use.
//
// PACKAGED-APP CAVEAT: `vp build` output (and apps/desktop, QK-WB-002) has no
// dev proxy. With VITE_QUIRKS_URL unset, requests go to the app's own origin
// and 404 unless the daemon is also what serves the built assets. A packaged
// build therefore has to either bake VITE_QUIRKS_URL (and then contend with
// the missing CORS headers — an Electron session can be told to ignore them, a
// plain browser cannot), or be served single-origin by the daemon. The latter
// is the intended endgame and is not this task's to build.

/**
 * Resolve the quirks service's base URL. Never has a trailing slash; `""`
 * (same origin) is the default and is a valid prefix — `${base}/v1/goals`.
 */
export function serviceBaseUrl(): string {
  const configured: unknown = import.meta.env.VITE_QUIRKS_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return trimTrailingSlash(configured.trim());
  }
  return "";
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
