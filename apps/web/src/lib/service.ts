// Base URL for the quirks daemon's HTTP API (the bun-era service; see
// ../../../../src/service/app.ts and ../../../../src/service/daemon.ts).
//
// The daemon binds a port derived deterministically from the repo root path
// — `portForRoot` in src/service/daemon.ts, re-derived (not read from a
// record) by the CLI client in src/cli/client.ts:
//
//   45000 + (sha256(root).readUInt32BE(0) % 15000)
//
// So there is no single fixed port across machines or checkouts. The
// daemon's advisory record (`daemon.json`, see src/paths.ts) lives under the
// OS state directory — outside this repo, and outside a browser page's
// reach; a page served by Vite has no filesystem access to read it.
//
// Precedence: `VITE_QUIRKS_URL` when set (point it at whatever the daemon
// actually bound — `quirks daemon status` reports it). Absent that, fall
// back to the port `portForRoot` resolves to *for this checkout* today:
// 47301. That is not a generic default — it is what
// `portForRoot("/Users/brunomazzardo/code/quirks-v2")` computes right now,
// and not by coincidence: it is also what the old native workbench
// (apps/workbench/src/core.ts, PREVIEW_URL/GOALS_URL/TASKS_URL) hardcoded
// before the hashed-port scheme existed. Right for local dev against this
// exact path; wrong once the repo is cloned somewhere else or the hash
// changes — set VITE_QUIRKS_URL there.
const FALLBACK_PORT = 47301;

/** Resolve the quirks service's base URL. Never has a trailing slash. */
export function serviceBaseUrl(): string {
  const configured: unknown = import.meta.env.VITE_QUIRKS_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return trimTrailingSlash(configured.trim());
  }
  return `http://127.0.0.1:${FALLBACK_PORT}`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
