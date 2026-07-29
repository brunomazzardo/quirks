// quirks daemon status | start | stop | restart (QK-SRV-006).
//
// A long-lived process compiles its files once at startup, so a daemon can
// answer with code that no longer exists in the working tree. This tells you
// when that has happened, and restarts on request. It never restarts on its
// own: one daemon serves every agent in this repo root, so acting on someone's
// mid-edit tree would turn a private syntax error into another agent's outage.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import {
  codeIdentity,
  daemonRecordPath,
  hasDrifted,
  serviceLogPath,
  UNKNOWN_FINGERPRINT,
} from "@quirks/shared";
import {
  awaitDaemon,
  baseFor,
  health,
  spawnDaemon,
  target,
  type DaemonHealth,
  type ServiceError,
} from "./Client.ts";
import { cliError, emitJson, emitRead, table, warn, type CliError } from "./Output.ts";

const OWN_SRC = fileURLToPath(new URL("..", import.meta.url));

export interface Status {
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

const readStatus: Effect.Effect<Status> = Effect.gen(function* () {
  const { root, port } = yield* target();
  const h = yield* health(baseFor(port));
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
      serving !== undefined && serving !== UNKNOWN_FINGERPRINT && tree !== UNKNOWN_FINGERPRINT,
    runsInFlight: h?.runsInFlight ?? [],
  };
});

export function verdict(s: Status): string {
  if (!s.comparable) {
    return "this daemon does not report which code it is running, so whether it matches\nyour tree cannot be determined. `quirks daemon restart` replaces it with one that does.";
  }
  if (s.drifted) {
    return "STALE — your tree has changed since this daemon loaded its code.\nrun `quirks daemon restart`.";
  }
  return "up to date — the daemon is running your current tree.";
}

export function renderStatus(s: Status): string {
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

export const daemonStatus = (opts: { json: boolean }): Effect.Effect<void> =>
  Effect.gen(function* () {
    const status = yield* readStatus;
    yield* emitRead(status, opts.json, () => renderStatus(status));
  });

/** The recorded pid. Liveness is still the socket — that rule is about deciding
 *  whether a daemon is *up*. Stopping one that no longer answers HTTP is a
 *  different job, and the pid is the only handle left. The legacy path is read
 *  too so a daemon started before `/shutdown` existed can still be replaced. */
function recordedPid(root: string): number | null {
  // Spelled out rather than imported from store/LedgerPaths.ts: D4 makes the
  // CLI's only path to data HTTP, and Cli.test.ts checks that structurally — a
  // store import here would fail that test for a good reason. This is a stale
  // FILE LOCATION, read so an old daemon can still be found and stopped.
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

const socketFree = (port: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    for (let i = 0; i < 20; i++) {
      yield* Effect.sleep("100 millis");
      if ((yield* health(baseFor(port), 300)) === null) return true;
    }
    return false;
  });

/** The socket releasing is the only proof it stopped. Escalates to the recorded
 *  pid for a daemon that predates `/shutdown` or has wedged. */
const stopAndWait = (root: string, port: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    yield* Effect.promise(async () => {
      try {
        await fetch(`${baseFor(port)}/shutdown`, {
          method: "POST",
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        // A daemon that dies mid-response is a successful stop, not an error.
      }
    });
    if (yield* socketFree(port)) return true;

    const pid = recordedPid(root);
    if (pid === null) return false;
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      yield* Effect.sync(() => {
        try {
          process.kill(pid, signal);
        } catch {
          // ESRCH means already gone; EPERM means not ours to signal and is NOT
          // evidence it died — the socket check decides either way.
        }
      });
      if (yield* socketFree(port)) return true;
    }
    return false;
  });

/** Runs execute INSIDE the daemon process, so stopping it kills them. Refuse
 *  rather than silently costing someone a night's work. */
const refuseWhileRunning = (
  s: Status,
  force: boolean,
  verb: string,
): Effect.Effect<void, CliError> =>
  s.runsInFlight.length === 0 || force
    ? Effect.void
    : Effect.fail(
        cliError(
          `refusing to ${verb}: run(s) ${s.runsInFlight.join(", ")} are executing inside this daemon and would be killed.\n` +
            `       wait for them, or pass --force (they can be picked up with quirks run --resume).`,
        ),
      );

export const daemonRestart = (opts: {
  force: boolean;
}): Effect.Effect<void, CliError | ServiceError> =>
  Effect.gen(function* () {
    const status = yield* readStatus;
    yield* refuseWhileRunning(status, opts.force, "restart");

    if (status.running && !(yield* stopAndWait(status.root, status.port))) {
      return yield* Effect.fail(
        cliError(
          `the daemon on port ${status.port} did not release the socket — refusing to start a second one`,
        ),
      );
    }

    yield* spawnDaemon(status.root, status.port);
    const started = yield* awaitDaemon(status.root, status.port);
    if (!started) {
      return yield* Effect.fail(
        cliError(
          `the daemon did not come up on port ${status.port} — your working tree may not boot. ` +
            `check the service log.`,
        ),
      );
    }

    // One restart per invocation. If it still does not match, say so and stop —
    // retrying here is how a restart loop starts.
    const tree = codeIdentity(OWN_SRC).fingerprint;
    const stillDrifted = hasDrifted(tree, started.code?.fingerprint);
    if (stillDrifted) {
      yield* warn(
        "quirks: the restarted daemon still reports different code than your tree — not retrying.",
      );
    }
    yield* emitJson({
      restarted: true,
      port: status.port,
      servingCode: started.code?.fingerprint ?? "unknown",
      tree,
      stillDrifted,
    });
  });

/**
 * Beyond the bun-era surface (which had status and restart only): the two verbs
 * an operator reaches for when they want the daemon up or down *without* a verb
 * that also does something else. `start` is the autostart on its own; `stop`
 * is `restart` without the start.
 */
export const daemonStart: Effect.Effect<void, CliError | ServiceError> = Effect.gen(function* () {
  const before = yield* readStatus;
  if (before.running) {
    yield* emitJson({ started: false, alreadyRunning: true, port: before.port });
    return;
  }
  yield* spawnDaemon(before.root, before.port);
  const started = yield* awaitDaemon(before.root, before.port);
  if (!started) {
    return yield* Effect.fail(
      cliError(
        `the quirks service is unreachable at 127.0.0.1:${before.port} and could not be started — check ${serviceLogPath(before.root)}`,
      ),
    );
  }
  yield* emitJson({
    started: true,
    alreadyRunning: false,
    port: before.port,
    servingCode: started.code?.fingerprint ?? "unknown",
  });
});

export const daemonStop = (opts: { force: boolean }): Effect.Effect<void, CliError> =>
  Effect.gen(function* () {
    const status = yield* readStatus;
    if (!status.running) {
      yield* emitJson({ stopped: false, wasRunning: false, port: status.port });
      return;
    }
    yield* refuseWhileRunning(status, opts.force, "stop");
    if (!(yield* stopAndWait(status.root, status.port))) {
      return yield* Effect.fail(
        cliError(`the daemon on port ${status.port} did not release the socket`),
      );
    }
    yield* emitJson({ stopped: true, wasRunning: true, port: status.port });
  });

export const daemonServe = (opts: {
  port?: string;
}): Effect.Effect<void, CliError | ServiceError> =>
  Effect.gen(function* () {
    // Kept as a hidden verb, and deliberately the last import in the CLI's
    // graph: `serve` is the one path that loads the service into this process,
    // so the import is dynamic and every other verb pays nothing for it.
    const { runServe } = yield* Effect.promise(() => import("../service/Serve.ts"));
    yield* runServe(opts.port);
  });

export const notBuilt = (verb: string): Effect.Effect<never, CliError> =>
  Effect.fail(cliError(`quirks ${verb} is not built yet`));
