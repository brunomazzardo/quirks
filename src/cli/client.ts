// The CLI's only path to data (QK-SRV-004): HTTP to the daemon, with
// bind-or-attach autostart. There is NO direct-store fallback — an unreachable
// service is reported as an unreachable service, because a CLI that silently
// reopens the store reintroduces multi-writer concurrency exactly when it is
// hardest to observe. Structurally enforced: src/cli imports nothing from
// src/store or src/ops.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

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

async function health(base: string): Promise<{ id: string; root: string } | null> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return null;
    return (await res.json()) as { id: string; root: string };
  } catch {
    return null;
  }
}

/** Bind-or-attach from the client side: try the socket; if nothing answers,
 *  spawn a detached daemon and wait for /health. A daemon that answers for a
 *  DIFFERENT root is a loud error, never silently used. */
async function ensureDaemon(root: string, port: number): Promise<string> {
  const base = `http://127.0.0.1:${port}`;
  const first = await health(base);
  if (first) {
    if (first.root !== root) {
      throw new ServiceError(
        `port ${port} is serving ${first.root}, not ${root} — refusing to talk to another repo's daemon`,
      );
    }
    return base;
  }

  // Nothing answering — autostart, detached, logs to the service dir.
  const logDir = join(root, ".quirks", "service");
  try {
    execFileSync("mkdir", ["-p", logDir]);
  } catch {
    /* the daemon creates it too */
  }
  const proc = Bun.spawn([process.execPath, "run", MAIN, "serve"], {
    cwd: root,
    stdin: "ignore",
    stdout: Bun.file(join(logDir, "service.log")),
    stderr: Bun.file(join(logDir, "service.log")),
  });
  proc.unref();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const h = await health(base);
    if (h) {
      if (h.root !== root) {
        throw new ServiceError(
          `port ${port} is serving ${h.root}, not ${root} — refusing to talk to another repo's daemon`,
        );
      }
      return base;
    }
  }
  throw new ServiceError(
    `the quirks service is unreachable at 127.0.0.1:${port} and could not be started — check ${join(logDir, "service.log")}`,
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
