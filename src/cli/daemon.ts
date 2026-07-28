// quirks daemon status | restart (QK-SRV-006).
//
// A Bun process compiles its files once at startup, so a long-lived daemon can
// answer with code that no longer exists in the working tree. This tells you when
// that has happened, and restarts on request. It never restarts on its own: one
// daemon serves every agent in this repo root, so acting on someone's mid-edit
// tree would turn a private syntax error into another agent's outage.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  awaitDaemon,
  baseFor,
  health,
  portForRoot,
  resolveRoot,
  spawnDaemon,
  type DaemonHealth,
} from "./client.ts";
import { CliError, emitJson, emitRead, table } from "./output.ts";
import { UNKNOWN_FINGERPRINT, codeIdentity, hasDrifted } from "../fingerprint.ts";
import { daemonRecordPath } from "../paths.ts";

const OWN_SRC = fileURLToPath(new URL("..", import.meta.url));

interface Status {
  running: boolean;
  root: string;
  port: number;
  health: DaemonHealth | null;
  tree: string;
  drifted: boolean;
  /** False when either side is unknown — then `drifted` proves nothing. A daemon
   *  predating this check reports no identity, and calling that "up to date"
   *  would be the same silent lie the check exists to remove. */
  comparable: boolean;
  runsInFlight: string[];
}

async function readStatus(): Promise<Status> {
  const root = resolveRoot();
  const port = portForRoot(root);
  const h = await health(baseFor(port));
  const tree = codeIdentity(OWN_SRC).fingerprint;
  const serving = h?.code?.fingerprint;
  return {
    running: h !== null,
    root,
    port,
    health: h,
    tree,
    drifted: hasDrifted(tree, serving),
    comparable:
      serving !== undefined &&
      serving !== UNKNOWN_FINGERPRINT &&
      tree !== UNKNOWN_FINGERPRINT,
    runsInFlight: h?.runsInFlight ?? [],
  };
}

function verdict(s: Status): string {
  if (!s.comparable) {
    return "this daemon does not report which code it is running, so whether it matches\nyour tree cannot be determined. `quirks daemon restart` replaces it with one that does.";
  }
  if (s.drifted) {
    return "STALE — your tree has changed since this daemon loaded its code.\nrun `quirks daemon restart`.";
  }
  return "up to date — the daemon is running your current tree.";
}

function renderStatus(s: Status): string {
  if (!s.running) {
    return `not running (port ${s.port}) — any quirks command starts one.`;
  }
  const h = s.health!;
  return [
    table(
      ["field", "value"],
      [
        ["port", String(s.port)],
        ["started", h.startedAt ?? "unknown"],
        ["serving code", h.code?.fingerprint ?? "unknown"],
        ["your tree", s.tree],
        ["runs in flight", s.runsInFlight.length === 0 ? "none" : s.runsInFlight.join(", ")],
      ],
    ),
    "",
    verdict(s),
  ].join("\n");
}

export async function daemonStatus(opts: { json: boolean }): Promise<void> {
  const status = await readStatus();
  emitRead(status, opts.json, () => renderStatus(status));
}

/** The recorded pid. Liveness is still the socket — that rule is about deciding
 *  whether a daemon is *up*. Stopping one that no longer answers HTTP is a
 *  different job, and the pid is the only handle left. The legacy path is read too
 *  so a daemon started before `/shutdown` existed can still be replaced. */
function recordedPid(root: string): number | null {
  for (const path of [daemonRecordPath(root), join(root, ".quirks", "service", "daemon.json")]) {
    try {
      const record = JSON.parse(readFileSync(path, "utf8")) as { pid?: number; root?: string };
      if (typeof record.pid === "number" && record.root === root) return record.pid;
    } catch {
      /* absent or unreadable — try the next */
    }
  }
  return null;
}

async function socketFree(port: number): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if ((await health(baseFor(port), 300)) === null) return true;
  }
  return false;
}

/** The socket releasing is the only proof it stopped. Escalates to the recorded
 *  pid for a daemon that predates `/shutdown` or has wedged. */
async function stopAndWait(root: string, port: number): Promise<boolean> {
  try {
    await fetch(`${baseFor(port)}/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) });
  } catch {
    // A daemon that dies mid-response is a successful stop, not an error.
  }
  if (await socketFree(port)) return true;

  const pid = recordedPid(root);
  if (pid === null) return false;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(pid, signal);
    } catch {
      // ESRCH means already gone; EPERM means not ours to signal and is NOT
      // evidence it died — the socket check decides either way.
    }
    if (await socketFree(port)) return true;
  }
  return false;
}

export async function daemonRestart(opts: { force: boolean }): Promise<void> {
  const status = await readStatus();

  // Runs execute INSIDE the daemon process, so a restart kills them. Refuse
  // rather than silently costing someone a night's work.
  if (status.runsInFlight.length > 0 && !opts.force) {
    throw new CliError(
      `refusing to restart: run(s) ${status.runsInFlight.join(", ")} are executing inside this daemon and would be killed.\n` +
        `       wait for them, or pass --force (they can be picked up with quirks run --resume).`,
    );
  }

  if (status.running && !(await stopAndWait(status.root, status.port))) {
    throw new CliError(
      `the daemon on port ${status.port} did not release the socket — refusing to start a second one`,
    );
  }

  spawnDaemon(status.root, status.port);
  const started = await awaitDaemon(status.root, status.port);
  if (!started) {
    throw new CliError(
      `the daemon did not come up on port ${status.port} — your working tree may not boot. ` +
        `check the service log.`,
    );
  }

  // One restart per invocation. If it still does not match, say so and stop —
  // retrying here is how a restart loop starts.
  const tree = codeIdentity(OWN_SRC).fingerprint;
  const stillDrifted = hasDrifted(tree, started.code?.fingerprint);
  if (stillDrifted) {
    console.error(
      "quirks: the restarted daemon still reports different code than your tree — not retrying.",
    );
  }
  emitJson({
    restarted: true,
    port: status.port,
    servingCode: started.code?.fingerprint ?? "unknown",
    tree,
    stillDrifted,
  });
}
