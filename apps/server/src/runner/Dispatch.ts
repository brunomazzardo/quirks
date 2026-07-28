// Spawn a runner, bound its streams, retain the transcript always — including
// on timeout and flood. A non-zero exit is never recorded as durable success.
//
// Ported from the bun-era src/runner/dispatch.ts (QK-MONO-005), onto Effect's
// platform Command API (`effect/unstable/process`) rather than raw
// node:child_process. That is a deliberate departure from QK-MONO-003's
// execFileSync precedent, and it is the Command API that earns it: the bun-era
// file hand-rolled three properties the platform spawner already guarantees —
//   - the child is spawned `detached`, so it leads its own process group;
//   - kill targets the GROUP (`process.kill(-pid)`), so a grandchild that
//     inherited stdout dies with it (QK-RUN-007);
//   - exit is observed on the process's `exit` event, never on stream `close`,
//     which is exactly how a 30-second sleep once outlived a 400ms timeout.
// What the platform does NOT do is bound the streams or retain a transcript on
// the way down; that stays here, because it is the honesty property.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { statusFromExit, type DispatchResult, type RunnerKind } from "./Types.ts";

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1_048_576;
const MAX_RETAINED_TRANSCRIPT_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 100;
/** How long to wait for stdio to finish after the process has exited (QK-RUN-007).
 *  Bounded, because a grandchild that inherited the pipe can hold it open for as
 *  long as it likes — and a timeout that can be exceeded without bound is not a
 *  timeout. */
const STREAM_DRAIN_GRACE_MS = 2_000;

export interface DispatchInput {
  readonly jobId: string;
  readonly runner: RunnerKind;
  readonly argv: readonly string[];
  readonly artifactDir: string;
  readonly timeoutMs: number;
  /** Required for claude — it has no workspace flag and uses process cwd. */
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>> | undefined;
}

/** Tail-preferring retention — findings come last. Always attempts to write. */
export function retainableTranscript(stdout: string): string {
  if (stdout.length <= MAX_RETAINED_TRANSCRIPT_BYTES) return stdout;
  return (
    `[transcript truncated: kept the final ${MAX_RETAINED_TRANSCRIPT_BYTES} bytes]\n` +
    stdout.slice(-MAX_RETAINED_TRANSCRIPT_BYTES)
  );
}

function transcriptFile(artifactDir: string, jobId: string): string {
  return join(artifactDir, `${jobId}.transcript.txt`);
}

/** Write without clobbering an earlier attempt under the same job id. */
export function writeTranscript(artifactDir: string, jobId: string, body: string): string | null {
  if (body.length === 0) return null;
  mkdirSync(artifactDir, { recursive: true });
  const base = transcriptFile(artifactDir, jobId);
  for (let attempt = 0; attempt < 100; attempt++) {
    const path = attempt === 0 ? base : join(artifactDir, `${jobId}.${attempt}.transcript.txt`);
    if (existsSync(path)) continue;
    writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
    return path;
  }
  // Pathological: reuse the last slot rather than the first.
  const last = join(artifactDir, `${jobId}.99.transcript.txt`);
  writeFileSync(last, body, { encoding: "utf8", mode: 0o600 });
  return last;
}

/** What a bounded stream collector accumulated. A fault does NOT discard what
 *  was already read — the transcript is always retained (FOUNDING). */
interface Collector {
  chunks: Uint8Array[];
  total: number;
  overflow: boolean;
  error: string | undefined;
}

const collector = (): Collector => ({ chunks: [], total: 0, overflow: false, error: undefined });

const textOf = (box: Collector): string => Buffer.concat(box.chunks).toString("utf8");

/**
 * Drain a child stream into `box`, up to `maxBytes`, and never fail: a stream
 * fault is recorded as a note, not as a lost transcript. Past the bound we keep
 * reading and discarding rather than destroying the pipe — the flood is still
 * bounded, by the dispatch timeout, and a destroyed pipe can kill a runner that
 * was about to say something useful on stderr.
 */
const drainInto = (
  stream: Stream.Stream<Uint8Array, unknown>,
  box: Collector,
  maxBytes: number,
): Effect.Effect<void> =>
  Stream.runForEach(stream, (chunk: Uint8Array) =>
    Effect.sync(() => {
      box.total += chunk.length;
      if (box.total > maxBytes) {
        box.overflow = true;
        return;
      }
      box.chunks.push(chunk);
    }),
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        box.error = String(cause);
      }),
    ),
    Effect.asVoid,
  );

/** Wait for a collector fiber, but never longer than `graceMs`; then interrupt
 *  it and keep whatever arrived. */
const drainWithGrace = <A, E>(fiber: Fiber.Fiber<A, E>): Effect.Effect<void> =>
  Fiber.join(fiber).pipe(
    Effect.asVoid,
    Effect.catchCause(() => Effect.void),
    Effect.timeoutOrElse({
      duration: Duration.millis(STREAM_DRAIN_GRACE_MS),
      orElse: () => Fiber.interrupt(fiber),
    }),
  );

const failed = (
  input: DispatchInput,
  code: string,
  message: string,
  durationMs: number,
  transcriptPath: string | null = null,
): DispatchResult => ({
  jobId: input.jobId,
  runner: input.runner,
  status: "failure",
  exitCode: null,
  transcriptPath,
  durationMs,
  failure: { code, message },
});

/**
 * Run one runner job to completion. Never fails: every outcome — including a
 * binary that could not be started — is a DispatchResult the parent records, so
 * a failure to dispatch is as legible as a failure to work.
 */
export const dispatchRunner = (
  input: DispatchInput,
): Effect.Effect<DispatchResult, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const started = Date.now();
    const executable = input.argv[0];
    if (executable === undefined) {
      return failed(input, "invalid_argv", "argv must include an executable", 0);
    }

    const spawned = yield* ChildProcess.make(executable, input.argv.slice(1), {
      cwd: input.cwd,
      ...(input.env !== undefined ? { env: { ...input.env }, extendEnv: true } : {}),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }).pipe(
      Effect.map((handle) => ({ ok: true as const, handle })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, message: error.message })),
    );
    if (!spawned.ok) {
      return failed(input, "spawn_error", spawned.message, Date.now() - started);
    }
    const handle = spawned.handle;

    const out = collector();
    const err = collector();
    const outFiber = yield* Effect.forkScoped(drainInto(handle.stdout, out, MAX_STDOUT_BYTES));
    const errFiber = yield* Effect.forkScoped(drainInto(handle.stderr, err, MAX_STDERR_BYTES));

    // The timeout is a separate fiber holding a timer, not a race against the
    // exit: killing the runner makes `exitCode` complete, so a race would report
    // the signal death that the timeout itself caused, and "timed out" would
    // quietly become "failed". The bun-era file had the same shape for the same
    // reason — a flag set before the kill.
    const timer = { firedAt: null as number | null };
    const killer = yield* Effect.forkScoped(
      Effect.sleep(Duration.millis(input.timeoutMs)).pipe(
        Effect.andThen(Effect.sync(() => (timer.firedAt = Date.now()))),
        Effect.andThen(
          handle
            .kill({ killSignal: "SIGTERM", forceKillAfter: Duration.millis(KILL_GRACE_MS) })
            .pipe(Effect.catchCause(() => Effect.void)),
        ),
      ),
    );

    // Wait on the process, NOT on the stdio streams. A grandchild that inherited
    // the pipe keeps them open long after the runner is gone (QK-RUN-007).
    const code = yield* handle.exitCode.pipe(
      Effect.map((value) => value as number | null),
      // exitCode fails when the process died of a signal rather than exiting.
      // That is not a success, and it is only a timeout if our timer fired.
      Effect.catch(() => Effect.succeed(null)),
    );
    yield* Fiber.interrupt(killer);
    const exit = { timedOut: timer.firedAt !== null, code };

    // The process is gone; give stdio a bounded moment to finish.
    yield* Effect.all([drainWithGrace(outFiber), drainWithGrace(errFiber)], {
      concurrency: "unbounded",
    });

    const notes: string[] = [];
    if (out.overflow) notes.push("stdout flooded — retained the bound prefix");
    if (err.overflow) notes.push("stderr flooded — retained the bound prefix");
    if (out.error) notes.push(`stdout faulted (${out.error}) — retained what was read`);
    if (err.error) notes.push(`stderr faulted (${err.error}) — retained what was read`);

    // Always retain, including on timeout and flood. The interpreter (and the
    // operator) read this exact text.
    const retained = retainableTranscript(textOf(out));
    let transcriptPath: string | null = null;
    try {
      transcriptPath = writeTranscript(input.artifactDir, input.jobId, retained);
    } catch (error) {
      notes.push(`transcript could not be written (${(error as Error).message})`);
    }

    const status = statusFromExit(exit.code, exit.timedOut);
    // Honesty: never record durable success on a non-zero exit. `statusFromExit`
    // makes this unreachable; it stays because the day it becomes reachable is
    // the day the defect returns.
    if (status === "success" && exit.code !== 0) {
      return failed(
        input,
        "spawn_error",
        "invariant violated: success with non-zero exit",
        Date.now() - started,
        transcriptPath,
      );
    }

    const stderrText = textOf(err);
    return {
      jobId: input.jobId,
      runner: input.runner,
      status,
      exitCode: exit.code,
      transcriptPath,
      durationMs: Date.now() - started,
      ...(notes.length > 0 ? { notes } : {}),
      ...(status === "success"
        ? {}
        : {
            failure: {
              code: exit.timedOut ? "timeout" : "non_zero_exit",
              message: exit.timedOut
                ? `runner timed out after ${input.timeoutMs}ms`
                : `runner exited ${exit.code}${stderrText ? `: ${stderrText.slice(0, 400)}` : ""}`,
            },
          }),
    } satisfies DispatchResult;
  }).pipe(Effect.scoped);
