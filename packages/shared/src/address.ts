// Where the local service listens.
//
// THE DERIVATION IS THE ADDRESS, so there may only be one of it. The bun era
// kept two hand-synchronised copies — one in the daemon that binds, one in the
// CLI that dials — and the failure mode is a CLI that autostarts a daemon it
// will never find. QK-MONO-004 collapsed those two into
// apps/server/src/service/Machine.ts, and then apps/web/vite.config.ts wrote a
// third by hand for its dev proxy; the Electron shell would have been a fourth.
//
// It lives in @quirks/shared because every side of the monorepo needs it and
// none of them should own it: the server binds here, the CLI dials here, the
// dev proxy forwards here, and the desktop shell loads its window from here.
// Dependency-free (one node builtin), which is this package's whole contract.

import { createHash } from "node:crypto";

/**
 * Interim per-repo port: a stable hash of the repo root into the dynamic range,
 * so two repos' services never collide without a registry. The global multi-repo
 * registry is QK-SRV-005 (future).
 *
 * `QUIRKS_PORT` wins when it names a usable port — the same override the dev
 * proxy and the CLI both honour.
 */
export function portForRoot(root: string): number {
  const override = process.env["QUIRKS_PORT"];
  if (override) {
    const port = Number.parseInt(override, 10);
    if (Number.isInteger(port) && port > 1023 && port < 65536) return port;
  }
  const hash = createHash("sha256").update(root).digest();
  return 45000 + (hash.readUInt32BE(0) % 15000);
}

/** Loopback only — the service binds 127.0.0.1 and is not reachable off-box. */
export function baseFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** The service's origin for a repo root. `QUIRKS_URL` wins outright, which is
 *  how a launcher points a client at a service it did not derive. */
export function serviceOriginFor(root: string): string {
  const override = process.env["QUIRKS_URL"]?.trim();
  return override !== undefined && override.length > 0 ? override : baseFor(portForRoot(root));
}
