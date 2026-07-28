// pty sessions, owned by the daemon (QK-WB-004).
//
// This is the file the whole migration was for. The Native SDK could bind
// exactly ONE terminal — the index-0 engine key was the only pty binding a
// transpiled TS core could reach — and it had no scrollback at all, because the
// `scrollback` attribute was one of the refusals the binding threw
// (docs/upstream/native-terminal-gap/single-terminal-workaround.md). Both gaps
// were properties of that host, not of terminals: here a session is an entry in
// a Map, so "two at once" is arithmetic, and history is a byte ring plus
// xterm's own buffer.
//
// THREE THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. It must not break the other 274 tests by existing. node-pty is a native
//    binding with prebuilds for darwin and win32 only; on any machine where it
//    fails to load, an eager `import` at the top of this module would take down
//    every test that touches App.ts, because Routes.ts → App.ts → Daemon.ts is
//    the import path the whole suite walks. So the binding is loaded lazily, on
//    the first spawn, behind `backend()`.
//
// 2. No orphan shells. A pty child is a session leader (forkpty calls setsid),
//    so its pid IS its process-group id and `kill(-pid)` reaches the shell AND
//    everything the shell started. Three layers of guarantee, in order of how
//    gracefully they fire:
//      - `POST /shutdown` and Ctrl-C close the daemon's scope, which runs this
//        layer's finalizer (`killAll`);
//      - `process.on("exit")` is a synchronous backstop for `process.exit()`
//        and uncaught faults, which never reach an Effect finalizer;
//      - and if the daemon is SIGKILLed outright, the pty master fd closes with
//        it and the kernel hangs up the terminal, which is how an orphaned
//        shell has always died.
//
// 3. Output is bytes, end to end. node-pty hands back UTF-8 strings (its socket
//    runs through a StringDecoder, so a character split across two reads is
//    never torn); those are encoded once here and stay bytes through the replay
//    ring and the socket, because xterm decodes UTF-8 itself and statefully.
//    Output that is not valid UTF-8 is already lost inside node-pty's decoder —
//    a property of that library, not of this wire.

import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type { IPty } from "node-pty";
import { conflict, ConflictError, invalid, missing } from "../ops/Errors.ts";
import type { NotFoundError, ValidationError } from "../ops/Errors.ts";
import { Store } from "../store/Store.ts";
import { ByteRing } from "./Replay.ts";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_COLS,
  MAX_INPUT_BYTES,
  MAX_ROWS,
  MAX_SESSIONS,
  MIN_COLS,
  MIN_ROWS,
  REPLAY_LIMIT_BYTES,
  type PtyCreateRequest,
  type PtySessionInfo,
} from "./Wire.ts";

/** The pty could not be spawned. Not a validation failure and not a conflict —
 *  a real fault, so it falls through `respond`'s table to a logged 500. */
export class PtySpawnError extends Data.TaggedError("PtySpawnError")<{
  readonly shell: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `could not start a pty for ${this.shell}: ${detail}`;
  }
}

// ---------------------------------------------------------------------------
// the native binding, loaded late
// ---------------------------------------------------------------------------

const requireCjs = createRequire(import.meta.url);
let loaded: typeof import("node-pty") | undefined;

/**
 * Restore the +x bit on node-pty's `spawn-helper`.
 *
 * On unix node-pty does not exec the shell itself: it `posix_spawnp`s a small
 * helper binary that sets up the slave side of the pty first. That helper ships
 * inside the prebuild, and the executable bit does not reliably survive package
 * extraction — this checkout's `prebuilds/darwin-arm64/spawn-helper` arrived
 * `rw-r--r--`, and EVERY spawn failed with the same opaque line:
 *
 *     Error: posix_spawnp failed.
 *
 * which names neither the helper nor the permission. Repairing it here rather
 * than by hand keeps the fix in the repo: a `pnpm install` that re-extracts the
 * package cannot silently take the terminal away again.
 *
 * Idempotent, memoized, and never fatal — if the chmod fails we still try to
 * spawn, and the spawn's own error is the one worth reporting.
 */
let helperChecked = false;

function ensureSpawnHelperExecutable(): void {
  if (helperChecked || process.platform === "win32") return;
  helperChecked = true;
  try {
    const root = dirname(requireCjs.resolve("node-pty/package.json"));
    const candidates = [
      join(root, "build", "Release", "spawn-helper"),
      join(root, "build", "Debug", "spawn-helper"),
      join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    ];
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      // 0o111 is already set on a healthy install; chmod is a no-op then.
      if ((statSync(candidate).mode & 0o111) !== 0) continue;
      chmodSync(candidate, 0o755);
    }
  } catch {
    /* let the spawn itself report what is actually wrong */
  }
}

/** node-pty on first use, never at import time. See note 1 at the top. */
const backend = (): typeof import("node-pty") => {
  ensureSpawnHelperExecutable();
  loaded ??= requireCjs("node-pty") as typeof import("node-pty");
  return loaded;
};

// ---------------------------------------------------------------------------
// process-group signalling
// ---------------------------------------------------------------------------

/**
 * Signal a pty child AND everything it started.
 *
 * `kill(-pid)` addresses the process group. node-pty's own `IPty.kill` signals
 * only the leader (`process.kill(this.pid, …)`), which is usually enough — the
 * shell hangs up its children on the way out — but "usually" is not the
 * property this task's acceptance asks for. Falling back to the bare pid keeps
 * this honest on platforms without process groups.
 */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    /* no group, or already reaped — try the leader */
  }
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone: the outcome we wanted */
  }
}

/** How long a session gets to leave on its own after SIGHUP before SIGKILL. */
const GRACE_MS = 250;

// ---------------------------------------------------------------------------
// which shell
// ---------------------------------------------------------------------------

interface ShellCandidate {
  readonly shell: string;
  readonly args: readonly string[];
}

function candidateFor(command: string | undefined | null): ShellCandidate | null {
  const trimmed = command?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  const name = (trimmed.split("/").pop() ?? "").toLowerCase();
  // `nopromptsp` stops zsh printing an inverse-video `%` before each prompt
  // whenever the previous command left output without a trailing newline —
  // correct behavior in a bare tty, pure noise in a workbench pane.
  if (name === "zsh") return { shell: trimmed, args: ["-o", "nopromptsp"] };
  return { shell: trimmed, args: [] };
}

/**
 * Shells to try, best first, when the caller named none.
 *
 * `$SHELL` is what the user chose, so it leads; the rest exist because a daemon
 * can outlive the environment that started it, and a terminal that opens on
 * `/bin/sh` beats a terminal that does not open.
 */
function defaultShellCandidates(): ShellCandidate[] {
  const seen = new Set<string>();
  const out: ShellCandidate[] = [];
  for (const command of [process.env["SHELL"], "/bin/zsh", "/bin/bash", "/bin/sh"]) {
    const candidate = candidateFor(command);
    if (candidate === null || seen.has(candidate.shell)) continue;
    seen.add(candidate.shell);
    out.push(candidate);
  }
  return out.length > 0 ? out : [{ shell: "/bin/sh", args: [] }];
}

/** node-pty reports a missing or unrunnable binary as `posix_spawnp failed`,
 *  which names neither. Only those failures are worth another candidate — a
 *  pty that could not be allocated will fail identically for every shell. */
const RETRYABLE_SPAWN = /posix_spawnp failed|spawn-helper|enoent|not found|no such file/i;

function isRetryableSpawnFailure(cause: unknown): boolean {
  let current: unknown = cause;
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (RETRYABLE_SPAWN.test(message)) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// the process-wide backstop
// ---------------------------------------------------------------------------

/**
 * Every live session in THIS process, across every `PtySessions` instance.
 *
 * A registry instance is scoped to a layer; `process.on("exit")` is not. This
 * set is what that handler reads, and instances add and remove themselves from
 * it as they come and go — so a test that builds ten registries still leaves
 * nothing behind.
 */
const processWide = new Set<Session>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Synchronous on purpose: an "exit" handler may not defer, and SIGKILL to a
  // process group is one syscall.
  process.on("exit", () => {
    for (const session of processWide) {
      if (!session.exited) signalGroup(session.pid, "SIGKILL");
    }
  });
}

// ---------------------------------------------------------------------------
// a session
// ---------------------------------------------------------------------------

export interface PtyListener {
  readonly onData: (bytes: Uint8Array) => void;
  readonly onExit: (exit: { readonly exitCode: number; readonly signal: number }) => void;
}

interface Session {
  readonly id: string;
  readonly pty: IPty;
  readonly pid: number;
  readonly shell: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly startedAt: string;
  readonly replay: ByteRing;
  readonly listeners: Set<PtyListener>;
  cols: number;
  rows: number;
  exited: boolean;
  exitedAt: string | null;
  exitCode: number | null;
  signal: number | null;
  /** Set while a graceful kill is waiting out its grace period. */
  killTimer: ReturnType<typeof setTimeout> | null;
}

const encoder = new TextEncoder();

function infoOf(session: Session): PtySessionInfo {
  return {
    id: session.id,
    shell: session.shell,
    args: [...session.args],
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    pid: session.pid,
    startedAt: session.startedAt,
    exited: session.exited,
    exitedAt: session.exitedAt,
    exitCode: session.exitCode,
    signal: session.signal,
    replayBytes: session.replay.bytes,
    droppedBytes: session.replay.dropped,
  };
}

// ---------------------------------------------------------------------------
// the service
// ---------------------------------------------------------------------------

/** What a client learns the moment it attaches. `replay` is the history the
 *  socket is about to hand over — captured in the same synchronous breath as
 *  the subscription, so no byte is duplicated and none is missed. */
export interface PtyAttachment {
  readonly session: PtySessionInfo;
  readonly replay: Uint8Array;
}

export interface PtySessionsShape {
  readonly create: (
    request: PtyCreateRequest,
  ) => Effect.Effect<PtySessionInfo, ValidationError | ConflictError | PtySpawnError>;
  readonly list: Effect.Effect<readonly PtySessionInfo[]>;
  readonly get: (id: string) => Effect.Effect<PtySessionInfo, NotFoundError>;
  readonly write: (
    id: string,
    data: string,
  ) => Effect.Effect<void, NotFoundError | ValidationError>;
  readonly resize: (
    id: string,
    cols: number,
    rows: number,
  ) => Effect.Effect<PtySessionInfo, NotFoundError | ValidationError>;
  /** SIGHUP, then SIGKILL to the process group if the shell is still there. */
  readonly kill: (id: string) => Effect.Effect<PtySessionInfo, NotFoundError>;
  /** Subscribe to live output. Scoped: leaving the scope unsubscribes. */
  readonly attach: (
    id: string,
    listener: PtyListener,
  ) => Effect.Effect<PtyAttachment, NotFoundError, Scope.Scope>;
  /** Stop everything, now. The layer finalizer, exposed so a test can prove it. */
  readonly killAll: Effect.Effect<void>;
}

export class PtySessions extends Context.Service<PtySessions, PtySessionsShape>()(
  "quirks/PtySessions",
) {}

function checkGeometry(
  cols: number,
  rows: number,
): Effect.Effect<{ cols: number; rows: number }, ValidationError> {
  if (!Number.isInteger(cols) || cols < MIN_COLS || cols > MAX_COLS) {
    return invalid(`cols must be an integer in ${MIN_COLS}..${MAX_COLS}, got ${cols}`);
  }
  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    return invalid(`rows must be an integer in ${MIN_ROWS}..${MAX_ROWS}, got ${rows}`);
  }
  return Effect.succeed({ cols, rows });
}

function newId(): string {
  return `pty_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * The registry.
 *
 * `replayLimit` is a parameter rather than a constant read so the bound itself
 * is testable without writing a quarter of a megabyte through a shell.
 */
export const make = (
  options: { readonly replayLimit?: number | undefined } = {},
): Effect.Effect<PtySessionsShape, never, Store | Scope.Scope> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const replayLimit = options.replayLimit ?? REPLAY_LIMIT_BYTES;
    const sessions = new Map<string, Session>();

    /** Forget an exited session's process-wide registration. Called from the
     *  exit path and from `kill`, so the backstop set never grows. */
    const retire = (session: Session): void => {
      processWide.delete(session);
      if (session.killTimer !== null) {
        clearTimeout(session.killTimer);
        session.killTimer = null;
      }
    };

    /** Exited sessions are kept so a client can still read the last screen and
     *  the exit code — but not forever. */
    const pruneExited = (): void => {
      const dead = [...sessions.values()].filter((s) => s.exited);
      if (dead.length <= MAX_SESSIONS) return;
      dead
        .sort((a, b) => (a.exitedAt ?? "").localeCompare(b.exitedAt ?? ""))
        .slice(0, dead.length - MAX_SESSIONS)
        .forEach((s) => sessions.delete(s.id));
    };

    const find = (id: string): Effect.Effect<Session, NotFoundError> => {
      const session = sessions.get(id);
      return session === undefined ? missing(`no pty session ${id}`) : Effect.succeed(session);
    };

    const create: PtySessionsShape["create"] = (request) =>
      Effect.gen(function* () {
        const liveCount = [...sessions.values()].filter((s) => !s.exited).length;
        if (liveCount >= MAX_SESSIONS) {
          return yield* conflict(
            `already running ${liveCount} pty sessions (max ${MAX_SESSIONS}) — close one first`,
          );
        }

        const { cols, rows } = yield* checkGeometry(
          request.cols ?? DEFAULT_COLS,
          request.rows ?? DEFAULT_ROWS,
        );

        // The store root is the default cwd: a workbench terminal opens where
        // the ledger it is sitting next to lives.
        const cwd = request.cwd ?? store.root;
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
          return yield* invalid(`cwd is not a directory: ${cwd}`);
        }

        // A caller that named a shell or arguments gets EXACTLY that: falling
        // back would quietly run something else, and `sh -c '<script>'` turning
        // into a bare login shell is the difference between a test that asserts
        // and a test that hangs. Only the default (nothing requested) cascades.
        const candidates =
          request.shell === undefined && request.args === undefined
            ? defaultShellCandidates()
            : [
                {
                  shell: request.shell ?? process.env["SHELL"] ?? "/bin/sh",
                  args: [...(request.args ?? [])],
                },
              ];

        const id = newId();
        const replay = new ByteRing(replayLimit);
        const listeners = new Set<PtyListener>();
        const env = {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          ...request.env,
        };

        const { pty, shell, args } = yield* Effect.suspend(() => {
          const tried: string[] = [];
          let last: unknown = new Error("no shell candidate was runnable");
          for (const candidate of candidates) {
            tried.push(candidate.shell);
            try {
              return Effect.succeed({
                pty: backend().spawn(candidate.shell, [...candidate.args], {
                  name: "xterm-256color",
                  cols,
                  rows,
                  cwd,
                  env,
                }),
                shell: candidate.shell,
                args: candidate.args,
              });
            } catch (cause) {
              last = cause;
              if (!isRetryableSpawnFailure(cause)) break;
            }
          }
          return Effect.fail(new PtySpawnError({ shell: tried.join(" → "), cause: last }));
        });

        const session: Session = {
          id,
          pty,
          pid: pty.pid,
          shell,
          args,
          cwd,
          startedAt: new Date().toISOString(),
          replay,
          listeners,
          cols,
          rows,
          exited: false,
          exitedAt: null,
          exitCode: null,
          signal: null,
          killTimer: null,
        };

        pty.onData((chunk) => {
          const bytes = encoder.encode(chunk);
          replay.push(bytes);
          for (const listener of listeners) listener.onData(bytes);
        });

        pty.onExit(({ exitCode, signal }) => {
          session.exited = true;
          session.exitedAt = new Date().toISOString();
          session.exitCode = exitCode;
          session.signal = signal ?? 0;
          retire(session);
          for (const listener of listeners) {
            listener.onExit({ exitCode, signal: signal ?? 0 });
          }
          pruneExited();
        });

        sessions.set(id, session);
        processWide.add(session);
        installExitHook();
        return infoOf(session);
      });

    const write: PtySessionsShape["write"] = (id, data) =>
      Effect.gen(function* () {
        const session = yield* find(id);
        // A write to a shell that has already gone is not an error worth
        // failing a keystroke over — the client will see the exit frame.
        if (session.exited) return;
        if (data.length > MAX_INPUT_BYTES) {
          return yield* invalid(`input of ${data.length} bytes exceeds ${MAX_INPUT_BYTES}`);
        }
        session.pty.write(data);
      });

    const resize: PtySessionsShape["resize"] = (id, cols, rows) =>
      Effect.gen(function* () {
        const session = yield* find(id);
        const checked = yield* checkGeometry(cols, rows);
        if (!session.exited) {
          // A resize can race the shell's own exit; losing that race is not a
          // failure the caller can act on.
          try {
            session.pty.resize(checked.cols, checked.rows);
          } catch {
            /* the pty went away between the check and the ioctl */
          }
        }
        session.cols = checked.cols;
        session.rows = checked.rows;
        return infoOf(session);
      });

    const kill: PtySessionsShape["kill"] = (id) =>
      Effect.gen(function* () {
        const session = yield* find(id);
        if (!session.exited) {
          signalGroup(session.pid, "SIGHUP");
          // A shell that ignores SIGHUP, or a child of it that does, gets the
          // signal it cannot ignore a moment later.
          const timer = setTimeout(() => {
            if (!session.exited) signalGroup(session.pid, "SIGKILL");
          }, GRACE_MS);
          if (typeof timer.unref === "function") timer.unref();
          session.killTimer = timer;
        }
        sessions.delete(id);
        processWide.delete(session);
        return infoOf(session);
      });

    const attach: PtySessionsShape["attach"] = (id, listener) =>
      Effect.gen(function* () {
        const session = yield* find(id);
        return yield* Effect.acquireRelease(
          // Snapshot and subscribe in ONE synchronous block. Node cannot run
          // the pty's data callback in the middle of it, so there is no window
          // in which a byte lands in neither the replay nor the listener, and
          // none in which it lands in both.
          Effect.sync(() => {
            const replay = session.replay.drain();
            session.listeners.add(listener);
            return { session: infoOf(session), replay } satisfies PtyAttachment;
          }),
          () => Effect.sync(() => session.listeners.delete(listener)),
        );
      });

    const killAll = Effect.sync(() => {
      for (const session of sessions.values()) {
        if (!session.exited) signalGroup(session.pid, "SIGKILL");
        retire(session);
      }
      sessions.clear();
    });

    // The daemon's scope owns this. `/shutdown` opens the latch, `serveDaemon`
    // returns, the scope closes, and every shell this process started dies with
    // it — which is the whole of "sessions die with the daemon".
    yield* Effect.addFinalizer(() => killAll);

    return {
      create,
      list: Effect.sync(() => [...sessions.values()].map(infoOf)),
      get: (id) => Effect.map(find(id), infoOf),
      write,
      resize,
      kill,
      attach,
      killAll,
    } satisfies PtySessionsShape;
  });

export const layer: Layer.Layer<PtySessions, never, Store> = Layer.effect(PtySessions, make());

/** The registry with a small replay bound, so the ring's ceiling can be proven
 *  with a handful of bytes instead of a quarter megabyte. */
export const layerWithReplayLimit = (limit: number): Layer.Layer<PtySessions, never, Store> =>
  Layer.effect(PtySessions, make({ replayLimit: limit }));
