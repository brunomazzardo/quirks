// Per-machine facts about the local service: where it listens, and where it
// logs. Ported from the bun-era src/service/daemon.ts + src/cli/client.ts, which
// carried two hand-synchronised copies of the port derivation — one in the
// daemon that binds and one in the CLI that dials. They are one function here,
// because the derivation IS the address: two copies can disagree, and the
// failure mode is a CLI that autostarts a daemon it will never find.
//
// Dependency-free on purpose (node builtins + @quirks/shared path math only).
// The CLI imports this, and must not acquire a path into the store through it —
// D4 says the CLI's only path to data is HTTP.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { serviceLogPath, stateDir } from "@quirks/shared";

/** Interim per-repo port: a stable hash of the repo root into the dynamic
 *  range, so two repos' services never collide without a registry. The global
 *  multi-repo registry is QK-SRV-005 (future). */
export function portForRoot(root: string): number {
  const override = process.env.QUIRKS_PORT;
  if (override) {
    const p = Number.parseInt(override, 10);
    if (Number.isInteger(p) && p > 1023 && p < 65536) return p;
  }
  const h = createHash("sha256").update(root).digest();
  return 45000 + (h.readUInt32BE(0) % 15000);
}

export function baseFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Rotate the service log past a size cap: service.log → .1 → .2, oldest dropped.
 *
 * Called by whoever is about to *open* the log — the CLI, immediately before it
 * spawns a detached daemon onto that file descriptor. The bun-era daemon rotated
 * itself at startup instead, which renamed the file its own inherited stdout was
 * already pointed at: every line it then logged landed in `service.log.1` while
 * the error text told you to read `service.log`.
 *
 * Synchronous node fs on purpose. This runs before there is a runtime to speak
 * of, it is bookkeeping rather than data, and a rotation that cannot happen is
 * not a reason to refuse to start.
 */
export function rotateLogs(root: string, capBytes = 1024 * 1024): void {
  const log = serviceLogPath(root);
  try {
    if (statSync(log).size < capBytes) return;
  } catch {
    return; // absent — nothing to rotate
  }
  const one = `${log}.1`;
  const two = `${log}.2`;
  try {
    if (existsSync(one)) renameSync(one, two);
    renameSync(log, one);
  } catch {
    /* a log we cannot rotate is still a log we can append to */
  }
}

/** The per-root state directory, created. Advisory: the daemon creates it too. */
export function ensureStateDir(root: string): string {
  const dir = stateDir(root);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* the daemon creates it too */
  }
  return dir;
}
