// Daemon lifecycle (QK-SRV-002, ported for QK-MONO-004): bind-or-attach,
// socket-not-pid liveness, an advisory record, and the `/shutdown` door
// `quirks daemon restart` knocks on.
//
// Bind success means you ARE the daemon; EADDRINUSE means one is already up and
// you attach. Liveness is the socket, never a pid file — a stale pid can belong
// to an unrelated process, and the same stale pid can belong to a process that
// is very much alive and simply not ours (see `processAlive`).

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import type { HttpServerError } from "effect/unstable/http";
import { daemonRecordPath, stateDir, type CodeIdentity } from "@quirks/shared";
import { appLayer, PROCESS_CODE, PROCESS_STARTED_AT, VERSION } from "../App.ts";
import { loadJsonFile, saveJsonFile, StoreCorruptError } from "../store/JsonFile.ts";
import { json } from "../http/Wire.ts";
import { portForRoot } from "./Machine.ts";

export { VERSION } from "../App.ts";

/** Per-root machine state. NOT `.quirks/` — that is the committed ledger, and a
 *  port/pid record belongs to one laptop (QK-SRV-006). */
export function serviceDir(root: string): string {
  return stateDir(root);
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
export const loadDaemonRecord = (
  root: string,
): Effect.Effect<DaemonRecord | null, StoreCorruptError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const path = daemonRecordPath(root);
    const data = yield* loadJsonFile(path);
    if (Option.isNone(data)) return null;
    const record = data.value as DaemonRecord | null;
    if (typeof record?.port !== "number" || typeof record?.instanceId !== "string") {
      return yield* Effect.fail(new StoreCorruptError({ path, detail: "not a daemon record" }));
    }
    return record;
  });

export const saveDaemonRecord = (
  record: DaemonRecord,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  saveJsonFile(daemonRecordPath(record.root), record);

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

/** True when a bind failed because someone already holds the port — the one
 *  `ServeError` the caller must tell apart, because it means "attach". */
export function isAddressInUse(error: HttpServerError.ServeError): boolean {
  return (error.cause as NodeJS.ErrnoException | null)?.code === "EADDRINUSE";
}

/**
 * Stop on request. Loopback-only, and the spec's posture for this tool is
 * explicitly "no adversarial hardening" (docs/specs/daemon-lifecycle.md).
 * Stopping via the socket rather than a pid keeps liveness the socket's job.
 *
 * The bun-era route called `process.exit(0)` on a timer. Here it opens a latch
 * the serve loop is waiting on, so the same door closes an in-process daemon in
 * the test suite without taking the test runner down with it.
 */
const shutdownRoute = (stopRequested: Latch.Latch, instanceId: string) =>
  HttpRouter.add(
    "POST",
    "/shutdown",
    Effect.gen(function* () {
      // Answer first, stop a beat later. A daemon that dies mid-response is a
      // successful stop as far as the client is concerned, but a client that
      // gets its answer can stop guessing.
      yield* Effect.forkDetach(Effect.andThen(Effect.sleep("20 millis"), stopRequested.open));
      return json({ stopping: true, instanceId, pid: process.pid });
    }),
  );

export interface StartedDaemon {
  /** The port actually bound — port 0 asks the OS for an ephemeral one. */
  readonly port: number;
  readonly instanceId: string;
  readonly root: string;
  /** Completes once `POST /shutdown` has asked this daemon to stop. */
  readonly stopRequested: Effect.Effect<void>;
}

export interface DaemonOptions {
  readonly root: string;
  /** Omitted derives from the root; 0 asks the OS for an ephemeral port. */
  readonly port?: number | undefined;
  readonly instanceId?: string | undefined;
}

/**
 * Bind, or fail. The caller decides what EADDRINUSE means: for `quirks serve` it
 * is "one is already up"; for CLI autostart it is "attach".
 *
 * Scoped — the socket is released when the scope closes, which is what makes a
 * daemon safe to start inside a test.
 */
export const startDaemon = (
  options: DaemonOptions,
): Effect.Effect<StartedDaemon, HttpServerError.ServeError, Scope.Scope> =>
  Effect.gen(function* () {
    const instanceId = options.instanceId ?? randomUUID();
    const requested = options.port ?? portForRoot(options.root);
    const stopRequested = yield* Latch.make();
    const context = yield* Layer.build(
      HttpRouter.serve(
        Layer.mergeAll(
          appLayer({ root: options.root, instanceId }),
          shutdownRoute(stopRequested, instanceId),
        ),
        { disableListenLog: true },
      ).pipe(
        Layer.provideMerge(
          NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: requested }),
        ),
      ),
    );
    const address = Context.get(context, HttpServer.HttpServer).address;
    return {
      port: address._tag === "TcpAddress" ? address.port : requested,
      instanceId,
      root: options.root,
      stopRequested: stopRequested.await,
    };
  });

/** What the daemon believes about itself, written where cleanup can find it. */
export const recordFor = (daemon: StartedDaemon): DaemonRecord => ({
  port: daemon.port,
  instanceId: daemon.instanceId,
  version: VERSION,
  root: daemon.root,
  pid: process.pid,
  startedAt: PROCESS_STARTED_AT,
  code: PROCESS_CODE,
});

/**
 * The foreground daemon: bind, record, and stay up until `/shutdown`.
 *
 * `quirks serve` and `pnpm dev` are the same path, so the daemon the CLI
 * autostarts is provably the service this package serves — not a second
 * assembly that could drift from it.
 */
export const serveDaemon = (
  options: DaemonOptions,
): Effect.Effect<
  StartedDaemon,
  HttpServerError.ServeError | PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const daemon = yield* startDaemon(options);
      yield* saveDaemonRecord(recordFor(daemon));
      yield* Effect.sync(() => {
        console.log(
          JSON.stringify({
            type: "daemon-started",
            port: daemon.port,
            instanceId: daemon.instanceId,
            root: daemon.root,
          }),
        );
      });
      yield* daemon.stopRequested;
      return daemon;
    }),
  );
