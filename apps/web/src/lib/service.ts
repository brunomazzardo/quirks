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
// PACKAGED / NO-PROXY BUILDS: the daemon serves the built assets itself
// (QK-WB-009), so a page loaded from the daemon origin needs no proxy and no
// VITE_QUIRKS_URL — same-origin just works. The remaining consumer of
// VITE_QUIRKS_URL is a renderer served from some OTHER origin (apps/desktop's
// quirks:// scheme today, until the shell loads the daemon origin directly —
// tracked as a goal-less ledger chore).

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
