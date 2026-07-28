// The CLI's only path to data (D4, QK-SRV-004): HTTP to the daemon, with
// bind-or-attach autostart. There is NO direct-store fallback — an unreachable
// service is reported as an unreachable service, because a CLI that silently
// reopens the store reintroduces multi-writer concurrency exactly when it is
// hardest to observe.
//
// Structurally enforced: nothing under src/cli imports src/store, src/ops,
// src/run, src/runner, src/harness or src/App.ts. `src/service/Machine.ts` is
// the one exception and is dependency-free by construction — see Cli.test.ts,
// which asserts the boundary rather than trusting this comment.

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { codeIdentity, hasDrifted, serviceLogPath, type CodeIdentity } from "@quirks/shared";
import { baseFor, ensureStateDir, portForRoot, rotateLogs } from "../service/Machine.ts";

export { baseFor, portForRoot } from "../service/Machine.ts";

/** The service could not be reached, or refused. Printed as `quirks: …`. */
export class ServiceError extends Data.TaggedError("ServiceError")<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export const serviceError = (detail: string): ServiceError => new ServiceError({ detail });

/** Repo root resolution, duplicated from the store on purpose — the CLI may
 *  not import store modules, and this is path math, not data access. */
export function resolveRoot(cwd: string = process.cwd()): string {
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

/** This package's own `src/`, and the entry the autostart re-invokes. */
const OWN_SRC = fileURLToPath(new URL("..", import.meta.url));
const BIN = fileURLToPath(new URL("../bin.ts", import.meta.url));

export interface DaemonHealth {
  id: string;
  root: string;
  version?: string;
  startedAt?: string;
  /** Absent from a daemon that predates QK-SRV-006 — then drift is unknowable. */
  code?: CodeIdentity;
  runsInFlight?: string[];
}

/** null means "nothing usable answered" — never a guess about why. */
export const health = (base: string, timeoutMs = 1000): Effect.Effect<DaemonHealth | null> =>
  Effect.promise(async () => {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      return (await res.json()) as DaemonHealth;
    } catch {
      return null;
    }
  });

const assertSameRoot = (
  h: DaemonHealth,
  root: string,
  port: number,
): Effect.Effect<void, ServiceError> =>
  h.root === root
    ? Effect.void
    : Effect.fail(
        serviceError(
          `port ${port} is serving ${h.root}, not ${root} — refusing to talk to another repo's daemon`,
        ),
      );

/**
 * Warn — once per invocation, on stderr — when the daemon's code no longer
 * matches the working tree. A long-lived process compiles its files once at
 * startup, so a daemon can answer with code that no longer exists on disk.
 * Silence there means the CLI misreports which code produced a result.
 *
 * It warns and stops. It does NOT restart: one daemon serves every agent in this
 * root, so restarting on someone's mid-edit tree would turn a private syntax
 * error into another agent's outage.
 */
let warnedAboutDrift = false;
export const warnOnCodeDrift = (h: DaemonHealth): Effect.Effect<void> =>
  Effect.sync(() => {
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
  });

/** Spawn a detached daemon, logging to the per-root state dir. Rotation happens
 *  here, before the log is opened, so the file the daemon writes to is the file
 *  the error messages name. */
export const spawnDaemon = (root: string, port: number): Effect.Effect<void> =>
  Effect.sync(() => {
    ensureStateDir(root);
    rotateLogs(root);
    const fd = openSync(serviceLogPath(root), "a");
    try {
      const child = spawn(process.execPath, [BIN, "serve", "--port", String(port)], {
        cwd: root,
        detached: true,
        stdio: ["ignore", fd, fd],
      });
      child.unref();
    } finally {
      closeSync(fd);
    }
  });

/** Poll /health until the daemon answers, or give up. */
export const awaitDaemon = (
  root: string,
  port: number,
  attempts = 40,
): Effect.Effect<DaemonHealth | null, ServiceError> =>
  Effect.gen(function* () {
    const base = baseFor(port);
    for (let i = 0; i < attempts; i++) {
      yield* Effect.sleep("150 millis");
      const h = yield* health(base);
      if (h) {
        yield* assertSameRoot(h, root, port);
        return h;
      }
    }
    return null;
  });

/** Bind-or-attach from the client side: try the socket; if nothing answers,
 *  spawn a detached daemon and wait for /health. A daemon that answers for a
 *  DIFFERENT root is a loud error, never silently used. */
export const ensureDaemon = (root: string, port: number): Effect.Effect<string, ServiceError> =>
  Effect.gen(function* () {
    const base = baseFor(port);
    const first = yield* health(base);
    if (first) {
      yield* assertSameRoot(first, root, port);
      yield* warnOnCodeDrift(first);
      return base;
    }

    yield* spawnDaemon(root, port);
    const started = yield* awaitDaemon(root, port);
    if (started) return base;

    return yield* Effect.fail(
      serviceError(
        `the quirks service is unreachable at 127.0.0.1:${port} and could not be started — check ${serviceLogPath(root)}`,
      ),
    );
  });

/** Where this invocation will talk, resolved once. */
export const target = (): Effect.Effect<{ root: string; port: number }> =>
  Effect.sync(() => {
    const root = resolveRoot();
    return { root, port: portForRoot(root) };
  });

export const request = (
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Effect.Effect<any, ServiceError> =>
  Effect.gen(function* () {
    const { root, port } = yield* target();
    const base = yield* ensureDaemon(root, port);
    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(`${base}${path}`, {
          method,
          ...(body === undefined
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }),
        }),
      catch: (err) =>
        serviceError(
          `the quirks service at 127.0.0.1:${port} stopped answering mid-request (${(err as Error).message})`,
        ),
    });
    const text = yield* Effect.promise(() => res.text());
    const data = yield* Effect.try({
      try: () => (text ? (JSON.parse(text) as { error?: string } | null) : null),
      catch: () =>
        serviceError(
          `the quirks service at 127.0.0.1:${port} answered ${res.status} with a body that is not JSON`,
        ),
    });
    if (!res.ok) {
      return yield* Effect.fail(serviceError(data?.error ?? `${res.status} from the service`));
    }
    return data;
  });
