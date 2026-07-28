// Is each harness present, usable, and answering (QK-HARN-001, D7).
// Ported from the bun-era src/harness/probe.ts (QK-MONO-005).
//
// v1's probe lived in src/smoke/host-runner.ts and ended in
// `catch { return "unknown"; }` — not-on-PATH, EACCES, and a hung binary all
// collapsed into one benign-looking string. That is the carried defect class in
// docs/DECISIONS.md:114-115 ("a permission failure is not evidence of death";
// "corrupt is distinguished from absent, and reported"). Every failure mode here
// stays distinguishable, and none of them is spelled "unknown".
//
// Two halves, and the split is load-bearing (QK-HARN-002):
//   - presence is `accessSync` on a handful of paths, so it stays a plain
//     synchronous function the run path may call while assembling a plan; and
//   - version and auth execute something, so they are Effects that require
//     `ChildProcessSpawner`. The requirement IS the guarantee: an effect without
//     it in `R` provably spawned nothing.

import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ALL_RUNNERS, type RunnerKind } from "../runner/Types.ts";

export { ALL_RUNNERS };

/** What each runner is called on disk (runner-boundary-probe.md:52 for cursor). */
export const DEFAULT_EXECUTABLES: Readonly<Record<RunnerKind, string>> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor-agent",
};

/** v1 searched these beyond PATH; agent CLIs commonly install here. */
const EXTRA_SEARCH_DIRS: readonly string[] = [
  join(homedir(), ".local", "bin"),
  join(homedir(), "bin"),
];

const VERSION_TIMEOUT_MS = 5_000;
/** Auth checks are slower: `codex doctor` also probes network reachability. */
const AUTH_TIMEOUT_MS = 20_000;
const VERSION_MAX_CHARS = 64;
const STDERR_TAIL_CHARS = 200;
const MAX_STDOUT_BYTES = 65_536;
const MAX_STDERR_BYTES = 4_096;

export type Presence =
  /** On disk and executable. */
  | { state: "present"; executable: string }
  /** Nothing by that name anywhere we looked. */
  | { state: "absent"; reason: string }
  /** Found, but we may not execute it. NOT the same as absent. */
  | { state: "denied"; executable: string; reason: string };

function isExecutable(path: string): Presence | null {
  try {
    accessSync(path, constants.F_OK);
  } catch {
    return null; // genuinely not here — keep looking
  }
  // It exists. From here on, a failure is a permission fact, not an absence.
  try {
    accessSync(path, constants.X_OK);
    return { state: "present", executable: path };
  } catch (err) {
    return {
      state: "denied",
      executable: path,
      reason: `found but not executable (${(err as { code?: string }).code ?? "EACCES"})`,
    };
  }
}

/** Resolve a command name against PATH plus the extra dirs. */
export function resolveExecutable(candidate: string): Presence {
  if (isAbsolute(candidate)) {
    return (
      isExecutable(candidate) ?? {
        state: "absent",
        reason: `no file at ${candidate}`,
      }
    );
  }

  const dirs = new Set<string>();
  for (const dir of process.env["PATH"]?.split(delimiter) ?? []) {
    if (dir.length > 0) dirs.add(dir);
  }
  for (const dir of EXTRA_SEARCH_DIRS) dirs.add(dir);

  // A found-but-denied hit outranks "keep looking" only if nothing else works,
  // so remember it and continue.
  let denied: Presence | null = null;
  for (const dir of dirs) {
    const found = isExecutable(join(dir, candidate));
    if (found?.state === "present") return found;
    if (found?.state === "denied" && denied === null) denied = found;
  }
  if (denied) return denied;
  return {
    state: "absent",
    reason: `${candidate} is not on PATH or in ~/.local/bin, ~/bin`,
  };
}

export type VersionProbe =
  | { state: "ok"; version: string }
  /** Ran and exited non-zero — the binary is there but unhappy. */
  | { state: "error"; reason: string; exitCode: number | null }
  /** Did not finish in time. Says nothing about whether it works. */
  | { state: "timeout"; reason: string }
  /** Could not be started at all. */
  | { state: "spawn-failed"; reason: string; code: string | null }
  /** We deliberately did not run it (no --probe, or not present). */
  | { state: "not-probed"; reason: string };

type RunOutcome =
  | { state: "ran"; exitCode: number | null; stdout: string; stderr: string }
  | { state: "timeout" }
  | { state: "spawn-failed"; message: string; code: string | null };

/** The errno a platform failure was built from. `NotFound` is the normalized tag
 *  for ENOENT, so an unstartable binary still reports the code the operator will
 *  recognise rather than an Effect-shaped abstraction. */
const errnoOf = (error: PlatformError.PlatformError): string | null => {
  const cause = (error.reason as { cause?: unknown }).cause;
  const code = (cause as { code?: unknown } | undefined)?.code;
  if (typeof code === "string") return code;
  return error.reason._tag === "NotFound" ? "ENOENT" : null;
};

const collect = (
  stream: Stream.Stream<Uint8Array, unknown>,
  maxBytes: number,
): Effect.Effect<string> =>
  Stream.runFold(
    stream,
    () => ({ chunks: [] as Uint8Array[], total: 0 }),
    (acc, chunk: Uint8Array) => {
      if (acc.total >= maxBytes) return acc;
      acc.chunks.push(chunk);
      acc.total += chunk.length;
      return acc;
    },
  ).pipe(
    Effect.map((acc) => Buffer.concat(acc.chunks).toString("utf8")),
    // A stream fault loses the tail, never the answer: an empty read is still a
    // read, and the caller distinguishes it from "we did not look".
    Effect.catchCause(() => Effect.succeed("")),
  );

/** Joining a collector fiber is itself bounded: a grandchild holding the pipe
 *  open must not extend a bounded probe without limit. */
const JOIN_GRACE_MS = 2_000;

const joinBounded = (fiber: Fiber.Fiber<string, never>): Effect.Effect<string> =>
  Fiber.join(fiber).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(JOIN_GRACE_MS),
      orElse: () => Fiber.interrupt(fiber).pipe(Effect.as("")),
    }),
    Effect.catchCause(() => Effect.succeed("")),
  );

/** Run a bounded, output-capped command. Shared by the version and auth probes. */
const runBounded = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): Effect.Effect<RunOutcome, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawned = yield* ChildProcess.make(executable, [...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }).pipe(
      Effect.map((handle) => ({ ok: true as const, handle })),
      Effect.catch((error) =>
        Effect.succeed({ ok: false as const, message: error.message, code: errnoOf(error) }),
      ),
    );
    if (!spawned.ok) {
      return {
        state: "spawn-failed",
        message: spawned.message,
        code: spawned.code,
      } satisfies RunOutcome;
    }
    const handle = spawned.handle;
    const stdout = yield* Effect.forkScoped(collect(handle.stdout, MAX_STDOUT_BYTES));
    const stderr = yield* Effect.forkScoped(collect(handle.stderr, MAX_STDERR_BYTES));

    // A timer fiber, not a race against exit: the kill makes `exitCode` complete,
    // so racing them would report the signal death the timeout itself caused and
    // a hung binary would read as a failed one.
    const timer = { fired: false };
    const killer = yield* Effect.forkScoped(
      Effect.sleep(Duration.millis(timeoutMs)).pipe(
        Effect.andThen(Effect.sync(() => (timer.fired = true))),
        Effect.andThen(
          handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.catchCause(() => Effect.void)),
        ),
      ),
    );
    const exitCode = yield* handle.exitCode.pipe(
      Effect.map((code) => code as number | null),
      Effect.catch(() => Effect.succeed(null)),
    );
    yield* Fiber.interrupt(killer);
    if (timer.fired) return { state: "timeout" } satisfies RunOutcome;

    const outText = yield* joinBounded(stdout);
    const errText = yield* joinBounded(stderr);
    return {
      state: "ran",
      exitCode,
      stdout: outText,
      stderr: errText,
    } satisfies RunOutcome;
  }).pipe(Effect.scoped);

/**
 * Run `<exe> --version` and report what actually happened. Every runner in the
 * probe used the same flag (v1 probeHostVersion switched on host and returned
 * `--version` in all three arms).
 */
export const probeVersion = (
  executable: string,
  timeoutMs: number = VERSION_TIMEOUT_MS,
): Effect.Effect<VersionProbe, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.map(runBounded(executable, ["--version"], timeoutMs), (run): VersionProbe => {
    if (run.state === "timeout") {
      return {
        state: "timeout",
        reason: `${executable} --version did not answer within ${timeoutMs}ms`,
      };
    }
    if (run.state === "spawn-failed") {
      return {
        state: "spawn-failed",
        reason: `could not start ${executable}: ${run.message}`,
        code: run.code,
      };
    }
    if (run.exitCode === 0) {
      const firstLine = run.stdout.trim().split("\n")[0]?.trim() ?? "";
      if (firstLine.length === 0) {
        return {
          state: "error",
          reason: `${executable} --version exited 0 but printed nothing`,
          exitCode: run.exitCode,
        };
      }
      return { state: "ok", version: firstLine.slice(0, VERSION_MAX_CHARS) };
    }
    const tail = run.stderr.trim().slice(0, STDERR_TAIL_CHARS);
    return {
      state: "error",
      reason: `${executable} --version exited ${run.exitCode}${tail ? `: ${tail}` : ""}`,
      exitCode: run.exitCode,
    };
  });

export type AuthProbe =
  /** A positive machine-readable signal that credentials are present. */
  | { state: "authorized"; detail: string }
  /** A positive machine-readable signal that they are NOT. */
  | { state: "unauthorized"; detail: string }
  /** Ran but could not be read, or the command does not exist on this version. */
  | { state: "unknown"; detail: string }
  | { state: "not-probed"; reason: string };

/**
 * Each runner ships a purpose-built status command, so authorization costs no
 * tokens. `--version` proves a binary exists; it says nothing about credentials,
 * which is why availability used to be stuck at "unproven" forever.
 *
 * Shapes verified against the real CLIs on 2026-07-28:
 *   claude  `auth status`            → {"loggedIn": true, "authMethod": …}
 *   codex   `doctor --json`          → {schemaVersion, checks:{auth:{credentials:{status:"ok"}}}}
 *   cursor  `status --format json`   → {"status":"authenticated","isAuthenticated":true,…}
 */
const AUTH_ARGS: Readonly<Record<RunnerKind, readonly string[]>> = {
  claude: ["auth", "status"],
  codex: ["doctor", "--json"],
  cursor: ["status", "--format", "json"],
};

/** Read the runner's own answer. Only an explicit boolean counts either way —
 *  anything else is `unknown`, because a false "not logged in" would take a
 *  working harness out of service on no evidence. */
function readAuthJson(runner: RunnerKind, stdout: string): AuthProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { state: "unknown", detail: `${runner} status did not return JSON` };
  }
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

  const root = asRecord(parsed);
  if (!root) return { state: "unknown", detail: `${runner} status returned no object` };

  if (runner === "claude" || runner === "cursor") {
    const flag = runner === "claude" ? root["loggedIn"] : root["isAuthenticated"];
    if (flag === true) return { state: "authorized", detail: "credentials present" };
    if (flag === false) return { state: "unauthorized", detail: `${runner} reports not logged in` };
    return { state: "unknown", detail: `${runner} status had no boolean to read` };
  }

  // codex: `checks` is a flat map whose KEYS are dotted ids — checks["auth.credentials"],
  // not a nested checks.auth.credentials. Each value carries {id, category, status},
  // so match on `category === "auth"` rather than the literal key, which survives
  // a key rename.
  const checks = asRecord(root["checks"]);
  if (!checks) return { state: "unknown", detail: "codex doctor had no checks to read" };
  for (const value of Object.values(checks)) {
    const check = asRecord(value);
    if (check?.["category"] !== "auth") continue;
    if (check["status"] === "ok") return { state: "authorized", detail: "credentials present" };
    if (typeof check["status"] === "string") {
      return { state: "unauthorized", detail: `codex reports auth ${check["status"]}` };
    }
  }
  return { state: "unknown", detail: "codex doctor had no auth check to read" };
}

export const probeAuth = (
  runner: RunnerKind,
  executable: string,
  timeoutMs: number = AUTH_TIMEOUT_MS,
): Effect.Effect<AuthProbe, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.map(runBounded(executable, AUTH_ARGS[runner], timeoutMs), (run): AuthProbe => {
    if (run.state === "timeout") {
      return { state: "unknown", detail: `${runner} status did not answer within ${timeoutMs}ms` };
    }
    if (run.state === "spawn-failed") {
      return { state: "unknown", detail: `could not run ${runner} status: ${run.message}` };
    }
    // A non-zero exit may mean "logged out" or "this CLI has no such command".
    // Those are different, and we cannot tell them apart — so read the body, and
    // fall back to unknown rather than guessing.
    return readAuthJson(runner, run.stdout);
  });

export interface RunnerProbe {
  runner: RunnerKind;
  /** What we looked for. */
  candidate: string;
  presence: Presence;
  version: VersionProbe;
  auth: AuthProbe;
}

export interface ProbeOptions {
  /** Run `--version` and the runner's auth-status command. Off by default:
   *  presence is free, executing anything is not. */
  readonly probeVersions?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  /** Override the executable name per runner. */
  readonly executables?: Partial<Record<RunnerKind, string>> | undefined;
}

/**
 * Presence for every runner, without executing anything. Synchronous on purpose:
 * this is `accessSync` on a handful of paths, so the run path can consult it
 * during plan assembly without spawning a process (QK-HARN-002).
 */
export function presenceProbes(opts: Pick<ProbeOptions, "executables"> = {}): RunnerProbe[] {
  return ALL_RUNNERS.map((runner): RunnerProbe => {
    const candidate = opts.executables?.[runner] ?? DEFAULT_EXECUTABLES[runner];
    const presence = resolveExecutable(candidate);
    const reason =
      presence.state === "absent"
        ? "not present — nothing to run"
        : presence.state === "denied"
          ? "found but not executable — refusing to claim it works"
          : "pass --probe to run it";
    return {
      runner,
      candidate,
      presence,
      version: { state: "not-probed", reason },
      auth: { state: "not-probed", reason },
    };
  });
}

/** Presence for every runner; version and auth only when asked (`--probe`). */
export const probeRunners = (
  opts: ProbeOptions = {},
): Effect.Effect<RunnerProbe[], never, ChildProcessSpawner.ChildProcessSpawner> => {
  const base = presenceProbes(opts);
  if (opts.probeVersions !== true) return Effect.succeed(base);
  return Effect.forEach(
    base,
    (probe) =>
      // Only a present binary is worth running; the others keep their reason.
      probe.presence.state === "present"
        ? Effect.map(
            Effect.all(
              [
                probeVersion(probe.presence.executable, opts.timeoutMs),
                probeAuth(probe.runner, probe.presence.executable),
              ],
              { concurrency: "unbounded" },
            ),
            ([version, auth]): RunnerProbe => ({ ...probe, version, auth }),
          )
        : Effect.succeed(probe),
    { concurrency: "unbounded" },
  );
};
