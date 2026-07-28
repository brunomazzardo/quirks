// The CLI's only path to data (QK-SRV-004): HTTP to the daemon, with
// bind-or-attach autostart. There is NO direct-store fallback — an unreachable
// service is reported as an unreachable service, because a CLI that silently
// reopens the store reintroduces multi-writer concurrency exactly when it is
// hardest to observe. Structurally enforced: src/cli imports nothing from
// src/store or src/ops.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { codeIdentity, hasDrifted, type CodeIdentity } from "../fingerprint.ts";
import { serviceLogPath, stateDir } from "../paths.ts";

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Repo root resolution, duplicated from the store on purpose — the CLI may
 *  not import store modules, and this is path math, not data access. */
export function resolveRoot(cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

/** Must mirror service/daemon.ts portForRoot — the derivation IS the address. */
export function portForRoot(root: string): number {
  if (process.env.QUIRKS_PORT) {
    const p = Number.parseInt(process.env.QUIRKS_PORT, 10);
    if (Number.isInteger(p) && p > 1023 && p < 65536) return p;
  }
  const h = createHash("sha256").update(root).digest();
  return 45000 + (h.readUInt32BE(0) % 15000);
}

const MAIN = fileURLToPath(new URL("../main.ts", import.meta.url));
const OWN_SRC = fileURLToPath(new URL("..", import.meta.url));

export interface DaemonHealth {
  id: string;
  root: string;
  version?: string;
  startedAt?: string;
  /** Absent from a daemon that predates QK-SRV-006 — then drift is unknowable. */
  code?: CodeIdentity;
  runsInFlight?: string[];
}

export async function health(base: string, timeoutMs = 1000): Promise<DaemonHealth | null> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as DaemonHealth;
  } catch {
    return null;
  }
}

export function baseFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function assertSameRoot(h: DaemonHealth, root: string, port: number): void {
  if (h.root !== root) {
    throw new ServiceError(
      `port ${port} is serving ${h.root}, not ${root} — refusing to talk to another repo's daemon`,
    );
  }
}

/**
 * Warn — once per invocation, on stderr — when the daemon's code no longer
 * matches the working tree. This is the whole point of QK-SRV-006: a Bun process
 * compiles its files once at startup, so a daemon can answer with code that no
 * longer exists on disk. Silence there means the CLI misreports which code
 * produced a result.
 *
 * It warns and stops. It does NOT restart: one daemon serves every agent in this
 * root, so restarting on someone's mid-edit tree would turn a private syntax
 * error into another agent's outage.
 */
let warnedAboutDrift = false;
export function warnOnCodeDrift(h: DaemonHealth): void {
  if (warnedAboutDrift) return;
  const tree = codeIdentity(OWN_SRC);
  if (!hasDrifted(tree.fingerprint, h.code?.fingerprint)) return;
  warnedAboutDrift = true;
  const since = h.startedAt ? ` (loaded ${h.startedAt})` : "";
  console.error(
    `quirks: the service is running older code than your working tree${since}.\n` +
      `        what you see may not come from the code you are reading.\n` +
      `        run \`quirks daemon restart\` to pick it up.`,
  );
}

/** Spawn a detached daemon, logging to the per-root state dir. */
export function spawnDaemon(root: string, port: number): void {
  try {
    execFileSync("mkdir", ["-p", stateDir(root)]);
  } catch {
    /* the daemon creates it too */
  }
  const log = Bun.file(serviceLogPath(root));
  const proc = Bun.spawn([process.execPath, "run", MAIN, "serve", "--port", String(port)], {
    cwd: root,
    stdin: "ignore",
    stdout: log,
    stderr: log,
  });
  proc.unref();
}

/** Poll /health until the daemon answers, or give up. */
export async function awaitDaemon(
  root: string,
  port: number,
  attempts = 40,
): Promise<DaemonHealth | null> {
  const base = baseFor(port);
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const h = await health(base);
    if (h) {
      assertSameRoot(h, root, port);
      return h;
    }
  }
  return null;
}

/** Bind-or-attach from the client side: try the socket; if nothing answers,
 *  spawn a detached daemon and wait for /health. A daemon that answers for a
 *  DIFFERENT root is a loud error, never silently used. */
async function ensureDaemon(root: string, port: number): Promise<string> {
  const base = baseFor(port);
  const first = await health(base);
  if (first) {
    assertSameRoot(first, root, port);
    warnOnCodeDrift(first);
    return base;
  }

  spawnDaemon(root, port);
  const started = await awaitDaemon(root, port);
  if (started) return base;

  throw new ServiceError(
    `the quirks service is unreachable at 127.0.0.1:${port} and could not be started — check ${serviceLogPath(root)}`,
  );
}

export async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const root = resolveRoot();
  const port = portForRoot(root);
  const base = await ensureDaemon(root, port);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
  } catch (err) {
    throw new ServiceError(
      `the quirks service at 127.0.0.1:${port} stopped answering mid-request (${(err as Error).message})`,
    );
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ServiceError(data?.error ?? `${res.status} from the service`);
  }
  return data;
}
