import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { InterpretedResult, ResultInterpreter, RunnerJobFacts } from "./interpretation.js";
import { normalizeJobResult } from "./job-result.js";
import { redactTranscript, transcriptPath } from "./result-contract.js";
import type { RunnerJobResult, RunnerJobStatus, RunnerProfile } from "./types.js";

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1_048_576;
const KILL_GRACE_MS = 100;

export interface DispatchRunnerJobInput {
  jobId: string;
  role?: RunnerJobFacts["role"];
  profile: RunnerProfile;
  argv: readonly string[];
  artifactDir: string;
  timeoutMs: number;
  /**
   * Working directory for the child, which is the job's worktree.
   *
   * codex binds its workspace with -C and cursor with --workspace, but claude
   * has no such flag and relies entirely on the process working directory.
   * Without this a claude job ran in the supervisor's checkout instead of its
   * isolated worktree — editing the wrong tree while the prepared worktree
   * stayed clean and its base commit was read back as the candidate.
   */
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /**
   * How the runner's output becomes a structured result. The launcher knows how
   * to start a CLI correctly and nothing about the shape of what it says.
   */
  interpreter: ResultInterpreter;
}

interface StreamCollectResult {
  buffer: Buffer;
  overflow: boolean;
}

function collectBoundedStream(
  stream: Readable,
  maxBytes: number,
): Promise<StreamCollectResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;

    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        overflow = true;
        stream.destroy();
        return;
      }
      chunks.push(buffer);
    });

    stream.on("error", (error) => reject(error));
    stream.on("close", () => resolve({ buffer: Buffer.concat(chunks), overflow }));
    stream.on("end", () => resolve({ buffer: Buffer.concat(chunks), overflow }));
  });
}

function extractFlagValue(argv: readonly string[], flag: string): string | undefined {
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      return argv[index + 1];
    }
  }
  return undefined;
}

function failureResult(
  base: {
    jobId: string;
    profile: RunnerProfile;
    sessionHandle: string;
  },
  status: RunnerJobStatus,
  code: string,
  message: string,
  artifactPaths: readonly string[] = [],
): RunnerJobResult {
  return normalizeJobResult({
    jobId: base.jobId,
    profileId: base.profile.profileId,
    runnerType: base.profile.runnerType,
    resolvedModel: base.profile.model,
    effort: base.profile.effort,
    status,
    sessionHandle: base.sessionHandle,
    artifactPaths,
    failure: { code, message },
  });
}

/**
 * Persist the runner transcript as job evidence; never fail the job for it.
 *
 * Each transcript is capped well below the 16 MiB stdout limit: a long campaign
 * dispatches thousands of jobs into one shared artifact dir, and retaining every
 * full buffer could exhaust the disk that later envelope, journal, and
 * provenance writes depend on. The tail is kept because a reviewer's findings
 * come last. Written 0600: a transcript can still contain material the redactor
 * does not recognise.
 */
const MAX_RETAINED_TRANSCRIPT_BYTES = 1024 * 1024;

/**
 * The exact text that will be retained — computed before it is written, because
 * this is also the text handed to the interpreter. Interpreting raw stdout while
 * retaining something else would let a verdict quote evidence that no operator
 * can find in the record afterwards.
 */
function retainableTranscript(stdout: string): string {
  const redacted = redactTranscript(stdout);
  return redacted.length > MAX_RETAINED_TRANSCRIPT_BYTES
    ? `[transcript truncated: kept the final ${MAX_RETAINED_TRANSCRIPT_BYTES} bytes]\n${redacted.slice(-MAX_RETAINED_TRANSCRIPT_BYTES)}`
    : redacted;
}

/** How many same-job attempts keep their own transcript before one is reused. */
const MAX_TRANSCRIPT_ATTEMPTS = 100;

function numberedTranscriptPath(target: string, attempt: number): string {
  const extension = path.extname(target);
  return `${target.slice(0, target.length - extension.length)}.${attempt}${extension}`;
}

/**
 * Retain a transcript without ever overwriting an earlier one.
 *
 * The path is derived from the job id, and a resume reuses the job id — so a
 * plain write destroyed the evidence the first attempt's result had been
 * derived from. The whole design rests on the transcript still being there to
 * check an interpretation against, so a second attempt takes the next free
 * name instead.
 */
async function writeTranscript(
  artifactDir: string,
  jobId: string,
  transcript: string,
): Promise<string | undefined> {
  if (transcript.length === 0) return undefined;
  const target = transcriptPath(artifactDir, jobId);
  try {
    await mkdir(artifactDir, { recursive: true });
    for (let attempt = 0; attempt < MAX_TRANSCRIPT_ATTEMPTS; attempt += 1) {
      const candidate = attempt === 0 ? target : numberedTranscriptPath(target, attempt);
      try {
        // 0600: a transcript can still contain material the redactor does not
        // recognise. "wx" is what makes this non-destructive.
        await writeFile(candidate, transcript, { encoding: "utf8", mode: 0o600, flag: "wx" });
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    // A hundred attempts under one job id is pathological. Reuse the last slot
    // rather than the first, so the original attempt's transcript survives.
    const last = numberedTranscriptPath(target, MAX_TRANSCRIPT_ATTEMPTS - 1);
    await writeFile(last, transcript, { encoding: "utf8", mode: 0o600 });
    return last;
  } catch {
    return undefined;
  }
}

export async function dispatchRunnerJob(input: DispatchRunnerJobInput): Promise<RunnerJobResult> {
  const sessionId = extractFlagValue(input.argv, "--session-id");
  const base = {
    jobId: input.jobId,
    profile: input.profile,
    sessionHandle: sessionId ?? "",
  };

  const executable = input.argv[0];
  if (!executable) {
    return failureResult(base, "failure", "invalid_argv", "Runner argv must include an executable");
  }

  let child: ChildProcess | undefined;
  let timedOut = false;
  let terminationTimer: NodeJS.Timeout | undefined;

  const terminateChild = () => {
    child?.kill("SIGTERM");
    terminationTimer = setTimeout(() => child?.kill("SIGKILL"), KILL_GRACE_MS);
  };

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    terminateChild();
  }, input.timeoutMs);

  try {
    child = spawn(executable, input.argv.slice(1), {
      shell: false,
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QUIRKS_FAKE_RUNNER_OUTDIR: input.artifactDir,
        ...input.env,
      },
    });

    const activeChild = child;
    if (!activeChild.stdout || !activeChild.stderr) {
      return failureResult(base, "failure", "spawn_error", "Runner child is missing stdout or stderr pipes");
    }

    const stdoutPromise = collectBoundedStream(activeChild.stdout, MAX_STDOUT_BYTES);
    const stderrPromise = collectBoundedStream(activeChild.stderr, MAX_STDERR_BYTES);

    const [exitCode, stdoutResult, stderrResult] = await new Promise<
      [number | null, StreamCollectResult, StreamCollectResult]
    >((resolve, reject) => {
      child!.once("error", reject);
      activeChild.once("close", (code) => {
        Promise.all([stdoutPromise, stderrPromise])
          .then(([stdoutCollected, stderrCollected]) => {
            resolve([code, stdoutCollected, stderrCollected]);
          })
          .catch(reject);
      });
    });

    if (stdoutResult.overflow || stderrResult.overflow) {
      return failureResult(
        base,
        "failure",
        "output_limit_exceeded",
        stdoutResult.overflow
          ? `stdout exceeded ${MAX_STDOUT_BYTES} bytes`
          : `stderr exceeded ${MAX_STDERR_BYTES} bytes`,
      );
    }

    if (timedOut) {
      return failureResult(
        base,
        "timeout",
        "runner_timeout",
        `Runner exceeded wall-clock timeout of ${input.timeoutMs}ms`,
      );
    }

    // Retain the transcript before interpreting it. A read-only codex reviewer
    // cannot write a findings file, so this is frequently the only place its
    // reasoning exists — and it is what any later interpretation is checked
    // against.
    const transcript = retainableTranscript(stdoutResult.buffer.toString("utf8"));
    const retainedTranscript = await writeTranscript(input.artifactDir, input.jobId, transcript);

    const facts: RunnerJobFacts = {
      jobId: input.jobId,
      role: input.role ?? "implementer",
      runnerType: input.profile.runnerType,
      profileId: input.profile.profileId,
      model: input.profile.model,
      capabilities: input.profile.capabilities,
      exitCode,
      artifactDir: input.artifactDir,
      worktreePath: input.cwd ?? input.artifactDir,
      transcriptPath: retainedTranscript,
      sessionId,
      argv: input.argv,
    };

    let parsed: InterpretedResult;
    try {
      parsed = await input.interpreter.interpret(facts, transcript);
    } catch (error) {
      // An interpreter that throws must not take the campaign down with it, and
      // must not be recorded as a runner failure of its own: the run may have
      // been perfectly good, and its transcript is still on disk to prove it.
      const message = error instanceof Error ? error.message : "Result interpretation failed";
      return failureResult(
        base,
        "failure",
        "interpretation_error",
        message,
        retainedTranscript ? [retainedTranscript] : [],
      );
    }

    return normalizeJobResult({
      jobId: input.jobId,
      profileId: input.profile.profileId,
      runnerType: input.profile.runnerType,
      resolvedModel: input.profile.model,
      effort: input.profile.effort,
      status: parsed.status,
      ...(parsed.verdict !== undefined ? { verdict: parsed.verdict } : {}),
      ...(parsed.verdictEvidence !== undefined ? { verdictEvidence: parsed.verdictEvidence } : {}),
      ...(parsed.interpretationPath !== undefined ? { interpretationPath: parsed.interpretationPath } : {}),
      sessionHandle: parsed.sessionHandle,
      artifactPaths: retainedTranscript && !parsed.artifactPaths.includes(retainedTranscript)
        ? [...parsed.artifactPaths, retainedTranscript]
        : parsed.artifactPaths,
      ...(parsed.failure !== undefined ? { failure: parsed.failure } : {}),
      ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    });
  } catch (error) {
    if (timedOut) {
      return failureResult(
        base,
        "timeout",
        "runner_timeout",
        `Runner exceeded wall-clock timeout of ${input.timeoutMs}ms`,
      );
    }

    const message = error instanceof Error ? error.message : "Runner dispatch failed";
    return failureResult(base, "failure", "spawn_error", message);
  } finally {
    clearTimeout(timeoutTimer);
    if (terminationTimer) clearTimeout(terminationTimer);
  }
}
