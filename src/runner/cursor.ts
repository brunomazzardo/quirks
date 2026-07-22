import type { RunnerJobStatus } from "./types.js";
import path from "node:path";

const FORCE_CAPABILITY = "repository-write";

export function cursorArtifactPaths(artifactDir: string): readonly string[] {
  return [path.join(artifactDir, "cursor-result.json")];
}

export interface CursorArgvInput {
  readonly executable: string;
  readonly sessionId: string;
  readonly model: string;
  readonly briefPath: string;
  readonly workspace: string;
  readonly capabilities?: readonly string[];
}

export interface CursorResultFailure {
  readonly reason: string;
  readonly detail?: string;
}

export interface CursorParsedResult {
  readonly status: RunnerJobStatus;
  readonly sessionHandle?: string;
  readonly artifactPaths: readonly string[];
  readonly failure?: CursorResultFailure;
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

export function buildCursorArgv(input: CursorArgvInput): readonly string[] {
  const argv: string[] = [
    input.executable,
    "-p",
    "--output-format",
    "json",
    "--model",
    input.model,
    "--workspace",
    input.workspace,
    "--file",
    input.briefPath,
  ];
  if (input.capabilities?.includes(FORCE_CAPABILITY)) {
    argv.push("--force");
  }
  return argv;
}

export function buildCursorResumeArgv(
  threadId: string,
  input: CursorArgvInput,
): readonly string[] {
  const [executable, ...rest] = buildCursorArgv(input);
  return [executable as string, "--resume", threadId, ...rest];
}

function isJsonObject(value: unknown): value is CursorResultEvent {
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

function sessionHandleOf(event: CursorResultEvent): string | undefined {
  return event.session_id ?? event.chatId ?? event.threadId;
}

export function parseCursorResult(
  stdout: string,
  artifacts: readonly string[],
): CursorParsedResult {
  const resultEvents = parseStructuredEvents(stdout).filter((event) => event.type === "result");
  const finalEvent = resultEvents[resultEvents.length - 1];

  if (!finalEvent) {
    return {
      status: "failure",
      artifactPaths: artifacts,
      failure: { reason: "missing_structured_result" },
    };
  }

  const sessionHandle = sessionHandleOf(finalEvent);
  const isError = finalEvent.is_error === true || finalEvent.subtype === "error";

  if (!isError) {
    return {
      status: "success",
      artifactPaths: artifacts,
      ...(sessionHandle !== undefined ? { sessionHandle } : {}),
    };
  }

  const reason = classifyFailureReason(finalEvent);
  const status: RunnerJobStatus =
    reason === "permission_denied_signal"
      ? "permission_denied"
      : reason === "usage_limit_signal"
        ? "usage_limit"
        : "failure";
  const detail = finalEvent.error ?? finalEvent.message;

  return {
    status,
    artifactPaths: artifacts,
    ...(sessionHandle !== undefined ? { sessionHandle } : {}),
    failure: { reason, ...(detail !== undefined ? { detail } : {}) },
  };
}
