import path from "node:path";
import { parseReviewVerdict, type ReviewVerdict } from "./result-contract.js";
import type { RunnerJobStatus } from "./types.js";

const FORCE_CAPABILITY = "repository-write";

/**
 * Job-unique result envelope path, mirroring `codexResultPath`: a shared
 * cursor-result.json let attempts and roles clobber each other's envelopes
 * in the first real campaign.
 */
export function cursorResultPath(artifactDir: string, jobId: string): string {
  const safeJobId = jobId.replace(/[^A-Za-z0-9._-]/g, "-");
  return path.join(artifactDir, `cursor-result-${safeJobId}.json`);
}

/** Exact brief line prefix a cursor job follows to find its declared result path. */
export const CURSOR_RESULT_PATH_INSTRUCTION =
  "Before exiting, write your result envelope JSON to exactly this path: ";

/**
 * Brief section stating the result envelope contract for a cursor job.
 * Cursor has no `--output-schema`/`-o` equivalent (verified against
 * cursor-agent 2026.07.20 `--help`), so enforcement is brief-guided here
 * and validation-strict in `parseCursorResult`.
 */
export function cursorResultContractSection(resultPath: string): string {
  const example = JSON.stringify({
    status: "success",
    verdict: "revise",
    sessionHandle: "cursor-session-1",
    artifactPaths: [resultPath],
    failure: null,
  });
  return [
    "Runner result contract:",
    `- ${CURSOR_RESULT_PATH_INSTRUCTION}${resultPath}`,
    '- The envelope is a single JSON object with exactly these fields: "status" (one of "success", "failure", "cancelled", "timeout", "usage_limit", "permission_denied"), "verdict" ("accept" or "revise" if you are reviewing, otherwise null), "sessionHandle" (your session or thread id as a string, or null), "artifactPaths" (array of file path strings for your evidence; include the envelope path itself), "failure" (string reason for any non-success status, or null).',
    '- "status" reports whether YOUR JOB ran, not whether you approve of the work. If you completed the review and are recommending changes, that is status "success" with verdict "revise" — never status "failure".',
    '- Put review findings in your final message and evidence files, not in "failure". "failure" is only for the job itself failing.',
    `- Filled example (a completed review that asks for changes): ${example}`,
    "- A missing or malformed envelope classifies the job as failed regardless of any prose summary.",
  ].join("\n");
}

export interface CursorArgvInput {
  readonly executable: string;
  readonly sessionId: string;
  readonly model: string;
  readonly briefPath: string;
  readonly workspace: string;
  readonly artifactDir: string;
  readonly capabilities?: readonly string[];
}

/**
 * Positional prompt for a cursor job. cursor-agent takes its prompt as a
 * positional (`agent [prompt...]`) and has no flag that accepts a prompt file,
 * so the brief is referenced by path rather than inlined: argv is world-visible
 * in `ps`, and a real brief would otherwise land there verbatim.
 */
export function cursorPromptText(briefPath: string): string {
  return `Read the brief at ${briefPath}, complete it, and write the result envelope to the declared result path before exiting.`;
}

export interface CursorResultFailure {
  readonly reason: string;
  readonly detail?: string;
}

export interface CursorParsedResult {
  readonly status: RunnerJobStatus;
  readonly verdict?: ReviewVerdict;
  readonly sessionHandle?: string;
  readonly artifactPaths: readonly string[];
  readonly failure?: CursorResultFailure;
}

/** Declared per-job result envelope evidence, mirroring `CodexResultArtifacts`. */
export interface CursorResultArtifacts {
  readonly declaredResultPath: string;
  readonly files: Readonly<Record<string, string>>;
}

interface CursorResultEvent {
  readonly type?: string;
  readonly subtype?: string;
  readonly is_error?: boolean;
  readonly session_id?: string;
  readonly chatId?: string;
  readonly threadId?: string;
  readonly error?: string;
  readonly message?: string;
}

interface CursorResultEnvelope {
  readonly status?: unknown;
  readonly verdict?: unknown;
  readonly sessionHandle?: unknown;
  readonly artifactPaths?: unknown;
  readonly failure?: unknown;
}

const CURSOR_STATUSES = new Set<RunnerJobStatus>([
  "success",
  "failure",
  "cancelled",
  "timeout",
  "usage_limit",
  "permission_denied",
]);

export function buildCursorArgv(input: CursorArgvInput): readonly string[] {
  const argv: string[] = [
    input.executable,
    "-p",
    "--output-format",
    "json",
    "--model",
    input.model,
    // Suppresses the workspace trust prompt, which blocks a headless run
    // regardless of write capability. Not a write posture: --force is.
    "--trust",
    "--workspace",
    input.workspace,
    // The brief and the result envelope both live outside the workspace.
    "--add-dir",
    input.artifactDir,
  ];
  if (input.capabilities?.includes(FORCE_CAPABILITY)) {
    argv.push("--force");
  }
  // cursor-agent has no --file option; the prompt is a trailing positional.
  argv.push(cursorPromptText(input.briefPath));
  return argv;
}

export function buildCursorResumeArgv(
  threadId: string,
  input: CursorArgvInput,
): readonly string[] {
  const [executable, ...rest] = buildCursorArgv(input);
  return [executable as string, "--resume", threadId, ...rest];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStructuredEvents(stdout: string): CursorResultEvent[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];

  try {
    const whole = JSON.parse(trimmed) as unknown;
    if (Array.isArray(whole)) {
      return whole.filter(isJsonObject);
    }
    if (isJsonObject(whole)) {
      return [whole];
    }
  } catch {
    // Not a single JSON document; fall back to JSONL parsing below.
  }

  const events: CursorResultEvent[] = [];
  for (const line of trimmed.split("\n")) {
    const candidate = line.trim();
    if (candidate.length === 0) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isJsonObject(parsed)) events.push(parsed);
    } catch {
      continue;
    }
  }
  return events;
}

function classifyFailureReason(event: CursorResultEvent): string {
  const text = `${event.error ?? ""} ${event.message ?? ""}`.toLowerCase();
  if (text.includes("permission")) return "permission_denied_signal";
  if (text.includes("usage limit") || text.includes("rate limit")) return "usage_limit_signal";
  return "runner_reported_error";
}

function statusForReason(reason: string): RunnerJobStatus {
  if (reason === "permission_denied_signal") return "permission_denied";
  if (reason === "usage_limit_signal") return "usage_limit";
  return "failure";
}

function reasonForEnvelopeStatus(status: RunnerJobStatus): string {
  if (status === "permission_denied") return "permission_denied_signal";
  if (status === "usage_limit") return "usage_limit_signal";
  return "runner_reported_error";
}

function sessionHandleOf(event: CursorResultEvent): string | undefined {
  return event.session_id ?? event.chatId ?? event.threadId;
}

function isCursorStatus(value: unknown): value is RunnerJobStatus {
  return typeof value === "string" && CURSOR_STATUSES.has(value as RunnerJobStatus);
}

function envelopeArtifactPaths(paths: readonly string[], declaredResultPath: string): readonly string[] {
  return paths.length > 0 ? paths : [declaredResultPath];
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

interface EnvelopeFieldIssues {
  missing: string[];
  invalid: string[];
}

/**
 * Cursor has no `--output-schema` equivalent, so the envelope shape the
 * codex schema enforces mechanically is enforced here instead: all four
 * fields are required and every violation is named in the failure detail.
 */
function envelopeFieldIssues(envelope: CursorResultEnvelope): EnvelopeFieldIssues {
  const issues: EnvelopeFieldIssues = { missing: [], invalid: [] };
  if (envelope.status === undefined) issues.missing.push("status");
  else if (!isCursorStatus(envelope.status)) issues.invalid.push("status");
  if (envelope.sessionHandle === undefined) issues.missing.push("sessionHandle");
  else if (envelope.sessionHandle !== null && typeof envelope.sessionHandle !== "string") {
    issues.invalid.push("sessionHandle");
  }
  if (envelope.artifactPaths === undefined) issues.missing.push("artifactPaths");
  else if (!isStringArray(envelope.artifactPaths)) issues.invalid.push("artifactPaths");
  if (envelope.failure === undefined) issues.missing.push("failure");
  else if (envelope.failure !== null && typeof envelope.failure !== "string") {
    issues.invalid.push("failure");
  }
  return issues;
}

interface ValidEnvelope {
  status: RunnerJobStatus;
  verdict: ReviewVerdict | undefined;
  sessionHandle: string | undefined;
  artifactPaths: readonly string[];
  failure: string | undefined;
}

type EnvelopeOutcome =
  | { kind: "valid"; envelope: ValidEnvelope }
  | { kind: "invalid"; detail: string };

function readEnvelope(artifacts: CursorResultArtifacts): EnvelopeOutcome {
  const raw = artifacts.files[artifacts.declaredResultPath];
  if (raw === undefined) {
    return {
      kind: "invalid",
      detail:
        `no result envelope was written at ${artifacts.declaredResultPath}; ` +
        "the brief requires writing the envelope JSON there before exiting",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (!isJsonObject(parsed)) {
    return {
      kind: "invalid",
      detail: `result envelope at ${artifacts.declaredResultPath} is not a valid JSON object`,
    };
  }

  const candidate = parsed as CursorResultEnvelope;
  const issues = envelopeFieldIssues(candidate);
  if (issues.missing.length > 0 || issues.invalid.length > 0) {
    const parts: string[] = [];
    if (issues.missing.length > 0) parts.push(`missing required fields: ${issues.missing.join(", ")}`);
    if (issues.invalid.length > 0) parts.push(`invalid fields: ${issues.invalid.join(", ")}`);
    return {
      kind: "invalid",
      detail: `result envelope at ${artifacts.declaredResultPath} is ${parts.join("; ")}`,
    };
  }

  return {
    kind: "valid",
    envelope: {
      status: candidate.status as RunnerJobStatus,
      verdict: parseReviewVerdict(candidate.verdict),
      sessionHandle: typeof candidate.sessionHandle === "string" ? candidate.sessionHandle : undefined,
      // The envelope we just read is itself evidence the job ran, so an empty
      // list falls back to it rather than failing an accepting reviewer that
      // changed no files. Model compliance with "cite the envelope path" was
      // measured unreliable on 2026-07-24.
      artifactPaths: envelopeArtifactPaths(
        candidate.artifactPaths as readonly string[],
        artifacts.declaredResultPath,
      ),
      failure: typeof candidate.failure === "string" ? candidate.failure : undefined,
    },
  };
}

export function parseCursorResult(
  stdout: string,
  artifacts: CursorResultArtifacts,
): CursorParsedResult {
  const resultEvents = parseStructuredEvents(stdout).filter((event) => event.type === "result");
  const finalEvent = resultEvents[resultEvents.length - 1];
  const streamHandle = finalEvent === undefined ? undefined : sessionHandleOf(finalEvent);

  const outcome = readEnvelope(artifacts);

  if (outcome.kind === "valid") {
    const sessionHandle = streamHandle ?? outcome.envelope.sessionHandle;
    if (outcome.envelope.status === "success") {
      // No empty-evidence branch here: envelopeArtifactPaths already resolves an
      // empty list to the declared envelope, which is itself proof the job ran.
      // A job that wrote no envelope at all never reaches this point — it fails
      // earlier as missing_structured_result.
      return {
        status: "success",
        artifactPaths: outcome.envelope.artifactPaths,
        ...(outcome.envelope.verdict !== undefined ? { verdict: outcome.envelope.verdict } : {}),
        ...(sessionHandle !== undefined ? { sessionHandle } : {}),
      };
    }
    return {
      status: outcome.envelope.status,
      artifactPaths: outcome.envelope.artifactPaths,
      ...(sessionHandle !== undefined ? { sessionHandle } : {}),
      failure: {
        reason: reasonForEnvelopeStatus(outcome.envelope.status),
        ...(outcome.envelope.failure !== undefined ? { detail: outcome.envelope.failure } : {}),
      },
    };
  }

  // No trustworthy envelope: CLI-level error events still classify the
  // failure (permission/usage limits), mirroring the codex stream fallback.
  if (finalEvent !== undefined && (finalEvent.is_error === true || finalEvent.subtype === "error")) {
    const reason = classifyFailureReason(finalEvent);
    const detail = finalEvent.error ?? finalEvent.message;
    return {
      status: statusForReason(reason),
      artifactPaths: [],
      ...(streamHandle !== undefined ? { sessionHandle: streamHandle } : {}),
      failure: { reason, ...(detail !== undefined ? { detail } : {}) },
    };
  }

  return {
    status: "failure",
    artifactPaths: [],
    ...(streamHandle !== undefined ? { sessionHandle: streamHandle } : {}),
    failure: { reason: "missing_structured_result", detail: outcome.detail },
  };
}
