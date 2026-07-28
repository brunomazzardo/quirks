// Spawn a runner, bound its streams, retain the transcript always — including
// on timeout and flood. A non-zero exit is never recorded as durable success.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { statusFromExit, type DispatchResult, type RunnerKind } from "./types.ts";

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1_048_576;
const MAX_RETAINED_TRANSCRIPT_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 100;

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
}

function collectBounded(stream: Readable, maxBytes: number): Promise<StreamCollectResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
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
    stream.on("error", reject);
    stream.on("close", () =>
      resolve({ text: Buffer.concat(chunks).toString("utf8"), overflow }),
    );
    stream.on("end", () =>
      resolve({ text: Buffer.concat(chunks).toString("utf8"), overflow }),
    );
  });
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
  });

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
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

    const [exitCode, stdout, stderr] = await new Promise<
      [number | null, StreamCollectResult, StreamCollectResult]
    >((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        Promise.all([stdoutPromise!, stderrPromise])
          .then(([out, err]) => resolve([code, out, err]))
          .catch(reject);
      });
    });

    const notes: string[] = [];
    if (stdout.overflow) notes.push("stdout flooded — retained the bound prefix");
    if (stderr.overflow) notes.push("stderr flooded — retained the bound prefix");

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
