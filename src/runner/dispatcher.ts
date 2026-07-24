import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";
import { parseClaudeResult, claudeArtifactPaths, claudeResultPath } from "./claude.js";
import { parseCodexResult } from "./codex.js";
import { parseCursorResult, cursorResultPath } from "./cursor.js";
import { normalizeJobResult } from "./job-result.js";
import { parseReviewVerdict, redactTranscript, transcriptPath, type ReviewVerdict } from "./result-contract.js";
import type { RunnerJobFailure, RunnerJobResult, RunnerJobStatus, RunnerProfile } from "./types.js";

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1_048_576;
const KILL_GRACE_MS = 100;

export interface DispatchRunnerJobInput {
  jobId: string;
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
}

interface StreamCollectResult {
  buffer: Buffer;
  overflow: boolean;
}

interface ParsedDispatch {
  status: RunnerJobStatus;
  verdict?: ReviewVerdict;
  sessionHandle: string;
  artifactPaths: readonly string[];
  failure?: RunnerJobFailure;
  notes?: readonly string[];
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

function codexDeclaredResultPath(argv: readonly string[]): string | undefined {
  return extractFlagValue(argv, "-o");
}

async function readDeclaredArtifactFiles(
  declaredResultPath: string,
): Promise<Readonly<Record<string, string>>> {
  try {
    const contents = await readFile(declaredResultPath, "utf8");
    return { [declaredResultPath]: contents };
  } catch {
    return {};
  }
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

async function parseRunnerOutputAsync(input: {
  jobId: string;
  profile: RunnerProfile;
  argv: readonly string[];
  artifactDir: string;
  stdout: string;
  exitCode: number | null;
  sessionId?: string;
}): Promise<ParsedDispatch> {
  const sessionFallback = input.sessionId ?? "";

  switch (input.profile.runnerType) {
    case "claude": {
      const parsed = parseClaudeResult(input.stdout, {
        exitCode: input.exitCode ?? 1,
        artifactPaths: claudeArtifactPaths(input.artifactDir, input.jobId),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      });
      // The claude CLI cannot enforce the envelope, so the verdict is read back
      // from the brief-declared file the job wrote.
      const verdict = await readClaudeVerdict(claudeResultPath(input.artifactDir, input.jobId));
      return {
        status: parsed.status,
        ...(verdict !== undefined ? { verdict } : {}),
        sessionHandle: parsed.sessionHandle || sessionFallback,
        artifactPaths: parsed.artifactPaths,
        ...(parsed.failure !== undefined
          ? { failure: { code: parsed.failure.code, message: parsed.failure.message } }
          : {}),
      };
    }
    case "codex": {
      const declaredResultPath = codexDeclaredResultPath(input.argv);
      if (!declaredResultPath) {
        return {
          status: "failure",
          sessionHandle: sessionFallback,
          artifactPaths: [],
          failure: {
            code: "missing_result_path",
            message: "Codex argv did not declare a result artifact path",
          },
        };
      }

      const parsed = parseCodexResult(input.stdout, {
        declaredResultPath,
        files: await readDeclaredArtifactFiles(declaredResultPath),
      });

      return {
        status: parsed.status,
        ...(parsed.verdict !== undefined ? { verdict: parsed.verdict } : {}),
        sessionHandle: parsed.sessionHandle ?? sessionFallback,
        artifactPaths: parsed.artifactPaths,
        ...(parsed.failure !== undefined
          ? { failure: { code: codexFailureCode(parsed.status), message: parsed.failure } }
          : {}),
        ...(parsed.notes.length > 0 ? { notes: parsed.notes } : {}),
      };
    }
    case "cursor": {
      // Cursor has no --output-schema/-o equivalent, so the brief instructs
      // the agent to write the envelope to the job-unique declared path and
      // the parser validates it strictly.
      const declaredResultPath = cursorResultPath(input.artifactDir, input.jobId);
      const parsed = parseCursorResult(input.stdout, {
        declaredResultPath,
        files: await readDeclaredArtifactFiles(declaredResultPath),
      });
      return {
        status: parsed.status,
        ...(parsed.verdict !== undefined ? { verdict: parsed.verdict } : {}),
        sessionHandle: parsed.sessionHandle ?? sessionFallback,
        artifactPaths: parsed.artifactPaths,
        ...(parsed.failure !== undefined
          ? {
              failure: {
                code: parsed.failure.reason,
                message: parsed.failure.detail ?? parsed.failure.reason,
              },
            }
          : {}),
      };
    }
    default: {
      const exhaustive: never = input.profile.runnerType;
      return exhaustive;
    }
  }
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

async function retainTranscript(
  artifactDir: string,
  jobId: string,
  stdout: string,
): Promise<string | undefined> {
  if (stdout.length === 0) return undefined;
  const target = transcriptPath(artifactDir, jobId);
  const redacted = redactTranscript(stdout);
  const bounded = redacted.length > MAX_RETAINED_TRANSCRIPT_BYTES
    ? `[transcript truncated: kept the final ${MAX_RETAINED_TRANSCRIPT_BYTES} bytes]\n${redacted.slice(-MAX_RETAINED_TRANSCRIPT_BYTES)}`
    : redacted;
  try {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(target, bounded, { encoding: "utf8", mode: 0o600 });
    return target;
  } catch {
    return undefined;
  }
}

async function readClaudeVerdict(envelopePath: string): Promise<ReviewVerdict | undefined> {
  try {
    const parsed = JSON.parse(await readFile(envelopePath, "utf8")) as { verdict?: unknown };
    return parseReviewVerdict(parsed.verdict);
  } catch {
    return undefined;
  }
}

function codexFailureCode(status: RunnerJobStatus): string {
  if (status === "usage_limit") return "usage_limit";
  if (status === "cancelled") return "interrupted";
  return "runner_error";
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

    const stdout = stdoutResult.buffer.toString("utf8");
    // Retain the transcript before parsing. A read-only codex reviewer cannot
    // write a findings file, and --output-schema constrains its final message to
    // the envelope, so this is frequently the only place its reasoning exists.
    const retainedTranscript = await retainTranscript(input.artifactDir, input.jobId, stdout);

    const parsed = await parseRunnerOutputAsync({
      jobId: input.jobId,
      profile: input.profile,
      argv: input.argv,
      artifactDir: input.artifactDir,
      stdout,
      exitCode,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });

    return normalizeJobResult({
      jobId: input.jobId,
      profileId: input.profile.profileId,
      runnerType: input.profile.runnerType,
      resolvedModel: input.profile.model,
      effort: input.profile.effort,
      status: parsed.status,
      ...(parsed.verdict !== undefined ? { verdict: parsed.verdict } : {}),
      sessionHandle: parsed.sessionHandle,
      artifactPaths: retainedTranscript
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
