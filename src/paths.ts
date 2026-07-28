// Where machine-specific runtime state lives (QK-SRV-006).
//
// NOT `.quirks/` — that is the ledger and it is committed. A record carrying a
// port, a pid, and an instance id describes one laptop at one moment; committing
// it means every machine fights over the same file. `.quirks/service/daemon.json`
// was tracked in git before this module existed.
//
// Dependency-free path math, so both src/cli and src/service may import it
// without breaching the rule that the CLI imports nothing from store or ops.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** A short, stable directory name for a repo root. */
export function rootKey(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

/** Per-root state: the daemon record and the service log. Outside the repo. */
export function stateDir(root: string): string {
  const override = process.env.QUIRKS_STATE_DIR;
  if (override) return join(override, rootKey(root));
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "quirks", rootKey(root));
}

export function daemonRecordPath(root: string): string {
  return join(stateDir(root), "daemon.json");
}

export function serviceLogPath(root: string): string {
  return join(stateDir(root), "service.log");
}
