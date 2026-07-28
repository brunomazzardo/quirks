// Thin client behind stop-server.sh: end the shape session on the quirks
// daemon. Never kills the daemon — only clears the companion session.
//
// Lives with the skill (QK-MONO-007); run under node (>=24.13, type stripping).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function resolveRoot(cwd: string): string {
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

function portForRoot(root: string): number {
  if (process.env.QUIRKS_PORT) {
    const p = Number.parseInt(process.env.QUIRKS_PORT, 10);
    if (Number.isInteger(p) && p > 1023 && p < 65536) return p;
  }
  const h = createHash("sha256").update(root).digest();
  return 45000 + (h.readUInt32BE(0) % 15000);
}

function rootFromSessionDir(sessionDir: string): string | null {
  // …/.quirks/shape-sessions/current → repo root
  const quirks = dirname(dirname(sessionDir));
  if (!quirks.endsWith(".quirks")) return null;
  return dirname(quirks);
}

function markStoppedLocally(sessionDir: string, root: string): void {
  const stateDir = existsSync(join(sessionDir, "state"))
    ? join(sessionDir, "state")
    : join(root, ".quirks", "shape-sessions", "current", "state");
  mkdirSync(stateDir, { recursive: true });
  try {
    unlinkSync(join(stateDir, "server-info"));
  } catch {
    /* absent */
  }
  writeFileSync(
    join(stateDir, "server-stopped"),
    JSON.stringify({ reason: "stop-server.sh", timestamp: Math.floor(Date.now() / 1000) }) + "\n",
  );
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.log(JSON.stringify({ error: "Usage: stop-server.sh <session_dir>" }));
    process.exit(1);
  }

  let root = rootFromSessionDir(arg);
  if (!root) root = resolveRoot(arg);
  const port = portForRoot(root);
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/v1/shape/end`, {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      console.log(JSON.stringify({ status: "failed", error: `HTTP ${res.status}` }));
      process.exit(1);
    }
    console.log(JSON.stringify({ status: "stopped" }));
  } catch {
    markStoppedLocally(arg, root);
    console.log(JSON.stringify({ status: "not_running" }));
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ status: "failed", error: (err as Error).message }));
  process.exit(1);
});
