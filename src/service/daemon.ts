// Daemon lifecycle (QK-SRV-002): bind-or-attach, socket-not-pid liveness,
// an advisory record, rotated logs. Bind success means you ARE the daemon;
// EADDRINUSE means one is already up and you attach. Liveness is the socket,
// never a pid file — a stale pid can belong to an unrelated process.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createApp } from "./app.ts";
import { saveJsonFile, StoreCorruptError } from "../store/json-file.ts";
import { loadRuns, type Store } from "../store/store.ts";
import { codeIdentity, type CodeIdentity } from "../fingerprint.ts";
import { daemonRecordPath, serviceLogPath, stateDir } from "../paths.ts";

export const VERSION = "0.1.0";

/** Interim per-repo port: a stable hash of the repo root into the dynamic
 *  range, so two repos' daemons never collide without a registry. The global
 *  multi-repo registry is QK-SRV-005 (future). */
export function portForRoot(root: string): number {
  if (process.env.QUIRKS_PORT) {
    const p = Number.parseInt(process.env.QUIRKS_PORT, 10);
    if (Number.isInteger(p) && p > 1023 && p < 65536) return p;
  }
  const h = createHash("sha256").update(root).digest();
  return 45000 + (h.readUInt32BE(0) % 15000);
}

/** Per-root machine state. NOT `.quirks/` — that is the committed ledger, and a
 *  port/pid record belongs to one laptop (QK-SRV-006). */
export function serviceDir(store: Store): string {
  return stateDir(store.root);
}

export interface DaemonRecord {
  port: number;
  instanceId: string;
  version: string;
  root: string;
  pid: number;
  startedAt: string;
  /** Identity of the code this process compiled at startup. */
  code?: CodeIdentity;
}

/** The advisory record — never used for liveness (the socket is), only so
 *  humans and cleanup can see what believes it is running. Corrupt is
 *  distinguished from absent and reported, never treated as empty. */
export function loadDaemonRecord(store: Store): DaemonRecord | null {
  const path = daemonRecordPath(store.root);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new StoreCorruptError(path, `unreadable: ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new StoreCorruptError(path, `invalid JSON: ${(err as Error).message}`);
  }
  const record = data as DaemonRecord;
  if (typeof record?.port !== "number" || typeof record?.instanceId !== "string") {
    throw new StoreCorruptError(path, "not a daemon record");
  }
  return record;
}

/** A permission failure is not evidence of death — EPERM means the process
 *  exists but is not ours (v1's QK-RUN-012 defect class, carried as code).
 *  Advisory only: nothing derives liveness from pids; the socket does that. */
export function processAlive(
  pid: number,
  kill: (pid: number, signal: number) => unknown = process.kill,
): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Rotate the service log at startup when it has grown past the cap.
 *  service.log → service.log.1 → service.log.2, oldest dropped. */
export function rotateLogs(store: Store, capBytes = 1024 * 1024): void {
  const log = serviceLogPath(store.root);
  try {
    if (statSync(log).size < capBytes) return;
  } catch {
    return; // absent — nothing to rotate
  }
  const one = `${log}.1`;
  const two = `${log}.2`;
  if (existsSync(one)) renameSync(one, two);
  renameSync(log, one);
}

export function logPath(store: Store): string {
  return serviceLogPath(store.root);
}

/** Runs the ledger believes are executing. A restart would kill them, so an
 *  explicit `quirks daemon restart` refuses while any exists (QK-SRV-006). */
export function runsInFlight(store: Store): string[] {
  try {
    return loadRuns(store)
      .filter((run) => run.status === "running")
      .map((run) => run.id);
  } catch {
    // A corrupt runs file is not evidence that nothing is running — refuse to
    // claim the coast is clear.
    return ["<unreadable runs record>"];
  }
}

export interface StartedDaemon {
  port: number;
  instanceId: string;
  stop: () => void;
}

/** Bind or throw. The caller decides what EADDRINUSE means: for `quirks
 *  serve` it is "one is already up"; for CLI autostart it is "attach". */
export function startDaemon(store: Store, port = portForRoot(store.root)): StartedDaemon {
  const instanceId = randomUUID();
  const app = createApp(store);

  // The code THIS process compiled at startup, captured now — after this point
  // edits to src/ cannot change what this process runs, which is the whole
  // problem QK-SRV-006 exists to make visible.
  const code = codeIdentity();
  const startedAt = new Date().toISOString();

  // /health confirms an attach reached the right daemon: id, version, and the
  // ROOT it serves — attaching to another repo's daemon must be detectable. It
  // also reports code identity, so a client can tell whether what it is about to
  // read was produced by the code it is reading (QK-SRV-006).
  app.get("/health", (c) =>
    c.json({
      id: instanceId,
      version: VERSION,
      root: store.root,
      startedAt,
      code,
      runsInFlight: runsInFlight(store),
    }),
  );

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });
  // Port 0 asks the OS for an ephemeral port — report the one actually bound.
  const boundPort = server.port ?? port;

  // Shut down on request. Loopback-only, and the spec's posture for this tool is
  // explicitly "no adversarial hardening" (docs/specs/daemon-lifecycle.md).
  // Stopping via the socket rather than a pid keeps liveness the socket's job.
  app.post("/shutdown", (c) => {
    setTimeout(() => {
      server.stop(true);
      process.exit(0);
    }, 20);
    return c.json({ stopping: true, instanceId, pid: process.pid });
  });

  mkdirSync(serviceDir(store), { recursive: true });
  rotateLogs(store);
  const record: DaemonRecord = {
    port: boundPort,
    instanceId,
    version: VERSION,
    root: store.root,
    pid: process.pid,
    startedAt,
    code,
  };
  saveJsonFile(daemonRecordPath(store.root), record);

  return { port: boundPort, instanceId, stop: () => server.stop(true) };
}
