import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReviewVerdict, type ReviewVerdict } from "./result-contract.js";

export interface BuildCodexArgvInput {
  executable: string;
  model: string;
  workspace: string;
  promptText: string;
  resultPath: string;
  artifactDir: string;
  schemaPath: string;
  capabilities: readonly string[];
  effort: string;
}

export interface BuildCodexResumeArgvInput {
  executable: string;
  sessionHandle: string;
  briefPath: string;
  resultPath: string;
  schemaPath: string;
  capabilities: readonly string[];
  effort: string;
  continuePrompt?: string;
}

export type CodexResultStatus =
  | "success"
  | "failure"
  | "cancelled"
  | "timeout"
  | "usage_limit"
  | "permission_denied";

export interface CodexResult {
  status: CodexResultStatus;
  verdict: ReviewVerdict | undefined;
  sessionHandle: string | undefined;
  artifactPaths: readonly string[];
  failure: string | undefined;
  notes: readonly string[];
}

export interface CodexResultArtifacts {
  declaredResultPath: string;
  files: Readonly<Record<string, string>>;
}

interface CodexResultArtifact {
  status?: unknown;
  verdict?: unknown;
  sessionHandle?: unknown;
  artifactPaths?: unknown;
  failure?: unknown;
}

interface CodexStreamEvent {
  type?: unknown;
  thread_id?: unknown;
  session_id?: unknown;
  message?: unknown;
  error?: { message?: unknown };
}

const USAGE_LIMIT_PATTERN = /usage limit|rate limit|quota/i;
const INTERRUPTION_PATTERN = /interrupt|cancel|abort/i;

const CODEX_STATUSES = new Set<CodexResultStatus>([
  "success",
  "failure",
  "cancelled",
  "timeout",
  "usage_limit",
  "permission_denied",
]);

export type CodexSandboxMode = "read-only" | "workspace-write";

export const CODEX_PROMPT_MAX_BYTES = 100 * 1024;

export const CODEX_CONTINUE_PROMPT =
  "Continue from the current thread state. Re-read the brief at <briefPath>, pick the next highest-value step, and write the result envelope to the declared result path before exiting.";

export function codexResultPath(artifactDir: string, jobId: string): string {
  const safeJobId = jobId.replace(/[^A-Za-z0-9._-]/g, "-");
  return path.join(artifactDir, `codex-result-${safeJobId}.json`);
}

export function codexResultSchemaPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../schemas/codex-result.schema.json",
  );
}

export function codexSandboxMode(capabilities: readonly string[]): CodexSandboxMode {
  return capabilities.includes("repository-write") ? "workspace-write" : "read-only";
}

const CODEX_REASONING_EFFORTS: Readonly<Record<string, string>> = {
  mechanical: "low",
  standard: "medium",
  high: "high",
  principal: "high",
};

export function codexReasoningEffort(effort: string): string {
  return CODEX_REASONING_EFFORTS[effort] ?? effort;
}

export function codexPromptText(briefPath: string, briefContents: string | undefined): string {
  if (briefContents !== undefined && Buffer.byteLength(briefContents, "utf8") <= CODEX_PROMPT_MAX_BYTES) {
    return briefContents;
  }
  return `Read the brief at ${briefPath}, complete it, and write the result envelope to the declared result path before exiting.`;
}

export function buildCodexArgv(input: BuildCodexArgvInput): readonly string[] {
  return [
    input.executable,
    "exec",
    "-m",
    input.model,
    "-C",
    input.workspace,
    "-s",
    codexSandboxMode(input.capabilities),
    "--add-dir",
    input.artifactDir,
    "-c",
    `model_reasoning_effort=${codexReasoningEffort(input.effort)}`,
    "--output-schema",
    input.schemaPath,
    "--color",
    "never",
    "--json",
    "-o",
    input.resultPath,
    "--",
    input.promptText,
  ];
}

export function buildCodexResumeArgv(input: BuildCodexResumeArgvInput): readonly string[] {
  return [
    input.executable,
    "exec",
    "-s",
    codexSandboxMode(input.capabilities),
    "-c",
    `model_reasoning_effort=${codexReasoningEffort(input.effort)}`,
    "--output-schema",
    input.schemaPath,
    "--color",
    "never",
    "--json",
    "-o",
    input.resultPath,
    "resume",
    input.sessionHandle,
    "--",
    input.continuePrompt ?? CODEX_CONTINUE_PROMPT.replace("<briefPath>", input.briefPath),
  ];
}

function parseStreamEvents(stdout: string): CodexStreamEvent[] {
  const events: CodexStreamEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        events.push(parsed as CodexStreamEvent);
      }
    } catch {
      // Ignore non-JSON transcript lines.
    }
  }
  return events;
}

function streamSessionHandle(events: readonly CodexStreamEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "thread.started" && typeof event.thread_id === "string" && event.thread_id.length > 0) {
      return event.thread_id;
    }
    if (
      (event.type === "session.created" || event.type === "session_configured") &&
      typeof event.session_id === "string" &&
      event.session_id.length > 0
    ) {
      return event.session_id;
    }
  }
  return undefined;
}

function streamErrorMessages(events: readonly CodexStreamEvent[]): string[] {
  const messages: string[] = [];
  for (const event of events) {
    if (event.type === "error" && typeof event.message === "string") {
      messages.push(event.message);
    }
    if (event.type === "turn.failed" && typeof event.error?.message === "string") {
      messages.push(event.error.message);
    }
  }
  return messages;
}

function streamFailure(events: readonly CodexStreamEvent[]): { status: CodexResultStatus; failure: string } | undefined {
  for (const message of streamErrorMessages(events)) {
    if (USAGE_LIMIT_PATTERN.test(message)) return { status: "usage_limit", failure: message };
    if (INTERRUPTION_PATTERN.test(message)) return { status: "cancelled", failure: message };
  }
  return undefined;
}

export function parseCodexResult(stdout: string, artifacts: CodexResultArtifacts): CodexResult {
  const events = parseStreamEvents(stdout);
  const streamHandle = streamSessionHandle(events);

  const rawArtifact = artifacts.files[artifacts.declaredResultPath];
  if (rawArtifact === undefined) {
    return missingEnvelopeResult(events, streamHandle, `Missing Codex result artifact at ${artifacts.declaredResultPath}`);
  }

  let parsed: CodexResultArtifact;
  try {
    parsed = JSON.parse(rawArtifact) as CodexResultArtifact;
  } catch {
    return missingEnvelopeResult(events, streamHandle, `Invalid Codex result artifact JSON at ${artifacts.declaredResultPath}`);
  }

  if (!isCodexResultStatus(parsed.status)) {
    return missingEnvelopeResult(events, streamHandle, `Invalid Codex result status in ${artifacts.declaredResultPath}`);
  }

  const artifactPaths = parseArtifactPaths(parsed.artifactPaths, artifacts.declaredResultPath);
  if (parsed.status === "success" && artifactPaths.length === 0) {
    return failureResult(`Codex success requires artifact evidence at ${artifacts.declaredResultPath}`, streamHandle);
  }

  const envelopeHandle = typeof parsed.sessionHandle === "string" ? parsed.sessionHandle : undefined;
  const mismatch = streamHandle !== undefined && envelopeHandle !== undefined && streamHandle !== envelopeHandle;

  return {
    status: parsed.status,
    verdict: parseReviewVerdict(parsed.verdict),
    sessionHandle: streamHandle ?? envelopeHandle,
    artifactPaths,
    failure: typeof parsed.failure === "string" ? parsed.failure : undefined,
    notes: mismatch ? ["session_handle_mismatch"] : [],
  };
}

function missingEnvelopeResult(
  events: readonly CodexStreamEvent[],
  sessionHandle: string | undefined,
  fallbackFailure: string,
): CodexResult {
  const failure = streamFailure(events);
  if (failure !== undefined) {
    return {
      status: failure.status,
      verdict: undefined,
      sessionHandle,
      artifactPaths: [],
      failure: failure.failure,
      notes: [],
    };
  }
  return failureResult(fallbackFailure, sessionHandle);
}

function failureResult(failure: string, sessionHandle?: string): CodexResult {
  return {
    status: "failure",
    verdict: undefined,
    sessionHandle,
    artifactPaths: [],
    failure,
    notes: [],
  };
}

function isCodexResultStatus(value: unknown): value is CodexResultStatus {
  return typeof value === "string" && CODEX_STATUSES.has(value as CodexResultStatus);
}

/**
 * Evidence paths for a job, defaulting to the declared envelope.
 *
 * The envelope we just read is itself proof the job ran, so an omitted or empty
 * artifactPaths falls back to it rather than failing the job. Requiring the
 * model to cite it was not reliable: the 2026-07-24 probe caught two of three
 * codex models writing an explicit empty array despite the schema asking for
 * the path, which would have failed every accepting reviewer.
 */
function parseArtifactPaths(value: unknown, declaredResultPath: string): readonly string[] {
  if (value === undefined) return [declaredResultPath];
  if (!Array.isArray(value)) return [];
  const paths = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return paths.length > 0 ? paths : [declaredResultPath];
}
