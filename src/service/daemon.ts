// Daemon lifecycle (QK-SRV-002): bind-or-attach, socket-not-pid liveness,
// an advisory record, rotated logs. Bind success means you ARE the daemon;
// EADDRINUSE means one is already up and you attach. Liveness is the socket,
// never a pid file — a stale pid can belong to an unrelated process.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createApp } from "./app.ts";
import { saveJsonFile, StoreCorruptError } from "../store/json-file.ts";
import type { Store } from "../store/store.ts";

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

export function serviceDir(store: Store): string {
  return join(store.dir, "service");
}

export interface DaemonRecord {
  port: number;
  instanceId: string;
  version: string;
  root: string;
  pid: number;
  startedAt: string;
}

/** The advisory record — never used for liveness (the socket is), only so
 *  humans and cleanup can see what believes it is running. Corrupt is
 *  distinguished from absent and reported, never treated as empty. */
export function loadDaemonRecord(store: Store): DaemonRecord | null {
  const path = join(serviceDir(store), "daemon.json");
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
  const dir = serviceDir(store);
  const log = join(dir, "service.log");
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
  return join(serviceDir(store), "service.log");
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

  // /health confirms an attach reached the right daemon: id, version, and the
  // ROOT it serves — attaching to another repo's daemon must be detectable.
  app.get("/health", (c) =>
    c.json({ id: instanceId, version: VERSION, root: store.root }),
  );

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });
  // Port 0 asks the OS for an ephemeral port — report the one actually bound.
  const boundPort = server.port ?? port;

  mkdirSync(serviceDir(store), { recursive: true });
  rotateLogs(store);
  const record: DaemonRecord = {
    port: boundPort,
    instanceId,
    version: VERSION,
    root: store.root,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  saveJsonFile(join(serviceDir(store), "daemon.json"), record);

  return { port: boundPort, instanceId, stop: () => server.stop(true) };
}
