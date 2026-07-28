// Spawn a runner, bound its streams, retain the transcript always — including
// on timeout and flood. A non-zero exit is never recorded as durable success.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { statusFromExit, type DispatchResult, type RunnerKind } from "./types.ts";

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
  jobId: string;
  runner: RunnerKind;
  argv: readonly string[];
  artifactDir: string;
  timeoutMs: number;
  /** Required for claude — it has no workspace flag and uses process cwd. */
  cwd: string;
  env?: Readonly<Record<string, string>>;
}

interface StreamCollectResult {
  text: string;
  overflow: boolean;
  /** Set when the stream faulted. The bytes already read are still returned. */
  error?: string;
}

/**
 * Collect a stream up to `maxBytes`, and NEVER reject: a stream fault must not
 * discard what was already read, because the transcript is always retained
 * (FOUNDING). Rejecting here used to lose the whole transcript on any stdio error.
 */
function collectBounded(stream: Readable, maxBytes: number): Promise<StreamCollectResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(error === undefined ? { text, overflow } : { text, overflow, error });
    };
    stream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        overflow = true;
        stream.destroy();
        return;
      }
      chunks.push(buf);
    });
    stream.on("error", (err: Error) => finish(err.message));
    stream.on("close", () => finish());
    stream.on("end", () => finish());
  });
}

/**
 * Wait for a collector, but never longer than `graceMs`. Destroying the stream
 * makes the collector settle with whatever arrived, so a pipe held open by a
 * process we could not signal costs us a truncated transcript rather than a hang.
 */
async function collectWithGrace(
  stream: Readable | null | undefined,
  collector: Promise<StreamCollectResult> | undefined,
  graceMs: number,
): Promise<StreamCollectResult> {
  if (!collector) return { text: "", overflow: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<"grace">((resolve) => {
    timer = setTimeout(() => resolve("grace"), graceMs);
  });
  try {
    const first = await Promise.race([collector, grace]);
    if (first !== "grace") return first;
    stream?.destroy();
    return await collector;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Signal the runner's whole process group, not just the process we spawned.
 *
 * Agent CLIs spawn children constantly. Killing only the direct child leaves the
 * grandchildren running AND holding the stdout pipe open, which is what let a
 * 30-second sleep outlive a 400ms timeout. A negative pid targets the group —
 * available because the child is spawned `detached`, making it group leader.
 */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // ESRCH: already gone. EPERM or an unsupported platform: fall back to the
      // direct child, which is still better than nothing.
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* already gone */
  }
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

export async function dispatchRunner(input: DispatchInput): Promise<DispatchResult> {
  const started = Date.now();
  const executable = input.argv[0];
  if (!executable) {
    return {
      jobId: input.jobId,
      runner: input.runner,
      status: "failure",
      exitCode: null,
      transcriptPath: null,
      durationMs: 0,
      failure: { code: "invalid_argv", message: "argv must include an executable" },
    };
  }

  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let stdoutPromise: Promise<StreamCollectResult> | undefined;

  const child = spawn(executable, input.argv.slice(1), {
    shell: false,
    cwd: input.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...input.env },
    // Own process group, so the timeout can kill everything the runner spawned
    // (QK-RUN-007). We never unref: this process still awaits the child.
    detached: true,
  });

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    killTree(child, "SIGTERM");
    killTimer = setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
  }, input.timeoutMs);

  try {
    if (!child.stdout || !child.stderr) {
      return {
        jobId: input.jobId,
        runner: input.runner,
        status: "failure",
        exitCode: null,
        transcriptPath: null,
        durationMs: Date.now() - started,
        failure: { code: "spawn_error", message: "child missing stdout/stderr pipes" },
      };
    }

    stdoutPromise = collectBounded(child.stdout, MAX_STDOUT_BYTES);
    const stderrPromise = collectBounded(child.stderr, MAX_STDERR_BYTES);

    // Wait for 'exit', NOT 'close'. 'close' waits for the stdio streams too, and
    // a grandchild that inherited the pipe keeps them open — that is precisely how
    // a 30-second sleep outlived a 400ms timeout (QK-RUN-007).
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });

    // The process is gone; give stdio a bounded moment to finish.
    const [stdout, stderr] = await Promise.all([
      collectWithGrace(child.stdout, stdoutPromise, STREAM_DRAIN_GRACE_MS),
      collectWithGrace(child.stderr, stderrPromise, STREAM_DRAIN_GRACE_MS),
    ]);

    const notes: string[] = [];
    if (stdout.overflow) notes.push("stdout flooded — retained the bound prefix");
    if (stderr.overflow) notes.push("stderr flooded — retained the bound prefix");
    if (stdout.error) notes.push(`stdout faulted (${stdout.error}) — retained what was read`);
    if (stderr.error) notes.push(`stderr faulted (${stderr.error}) — retained what was read`);

    // Always retain, including on timeout and flood. The interpreter (and the
    // operator) read this exact text.
    const retained = retainableTranscript(stdout.text);
    const transcriptPath = writeTranscript(input.artifactDir, input.jobId, retained);

    const status = statusFromExit(exitCode, timedOut);
    // Honesty: never record durable success on a non-zero exit.
    if (status === "success" && exitCode !== 0) {
      throw new Error("invariant violated: success with non-zero exit");
    }

    const result: DispatchResult = {
      jobId: input.jobId,
      runner: input.runner,
      status,
      exitCode,
      transcriptPath,
      durationMs: Date.now() - started,
      ...(notes.length > 0 ? { notes } : {}),
    };
    if (status !== "success") {
      result.failure = {
        code: timedOut ? "timeout" : "non_zero_exit",
        message: timedOut
          ? `runner timed out after ${input.timeoutMs}ms`
          : `runner exited ${exitCode}${stderr.text ? `: ${stderr.text.slice(0, 400)}` : ""}`,
      };
    }
    return result;
  } catch (err) {
    // Best-effort salvage of whatever stdout we already collected.
    let transcriptPath: string | null = null;
    if (stdoutPromise) {
      try {
        const collected = await stdoutPromise;
        transcriptPath = writeTranscript(
          input.artifactDir,
          input.jobId,
          retainableTranscript(collected.text),
        );
      } catch {
        /* nothing to salvage */
      }
    }
    return {
      jobId: input.jobId,
      runner: input.runner,
      status: "failure",
      exitCode: null,
      transcriptPath,
      durationMs: Date.now() - started,
      failure: { code: "spawn_error", message: (err as Error).message },
    };
  } finally {
    clearTimeout(timeoutTimer);
    if (killTimer) clearTimeout(killTimer);
  }
}
