import { statSync } from "node:fs";
import path from "node:path";

export interface ClaudeArgvInput {
  executable: string;
  sessionId: string;
  model: string;
  effort: string;
  briefPath: string;
  workspace: string;
  configDir?: string;
  allowPermissionBypass?: boolean;
}

export interface ClaudeResultArtifacts {
  exitCode: number;
  artifactPaths: readonly string[];
  sessionId?: string;
}

export type ClaudeResultStatus = "success" | "failure" | "permission_denied" | "usage_limit";

export interface ClaudeParseFailure {
  code: string;
  message: string;
}

export interface ClaudeParseResult {
  status: ClaudeResultStatus;
  sessionHandle: string;
  artifactPaths: readonly string[];
  failure?: ClaudeParseFailure;
}

interface ClaudeStreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  permission_denials?: readonly unknown[];
  rate_limit_info?: {
    requests_remaining?: number;
    tokens_remaining?: number;
  };
}

/**
 * Profile effort tiers are quirks judgment tiers, not claude CLI effort
 * values. The claude CLI (verified against 2.1.218) accepts only
 * low|medium|high|xhigh|max, so mechanical/standard/principal must be
 * mapped; claude-native values pass through verbatim. Same bug class as
 * the fixed codex `codexReasoningEffort` mapping.
 */
const CLAUDE_EFFORTS: Readonly<Record<string, string>> = {
  mechanical: "low",
  standard: "medium",
  high: "high",
  principal: "xhigh",
};

export function claudeEffort(effort: string): string {
  return CLAUDE_EFFORTS[effort] ?? effort;
}

function appendSharedArgv(
  argv: string[],
  input: Pick<ClaudeArgvInput, "model" | "effort" | "workspace" | "allowPermissionBypass">,
): void {
  argv.push(
    "--model",
    input.model,
    "--effort",
    claudeEffort(input.effort),
    "--output-format",
    "stream-json",
    "--add-dir",
    input.workspace,
  );
  if (input.allowPermissionBypass === true) {
    argv.push("--dangerously-skip-permissions");
  }
}

export function buildClaudeArgv(input: ClaudeArgvInput): readonly string[] {
  const argv = [
    input.executable,
    "-p",
    "--session-id",
    input.sessionId,
  ];
  appendSharedArgv(argv, input);
  argv.push(input.briefPath);
  return argv;
}

export function buildClaudeResumeArgv(
  sessionId: string,
  input: Omit<ClaudeArgvInput, "sessionId">,
): readonly string[] {
  const argv = [
    input.executable,
    "-p",
    "--resume",
    sessionId,
  ];
  appendSharedArgv(argv, input);
  return argv;
}

export function buildClaudeEnv(
  input: { configDir?: string },
): Readonly<Record<string, string>> | undefined {
  if (!input.configDir) return undefined;
  return { CLAUDE_CONFIG_DIR: input.configDir };
}

function parseStreamEvents(stdout: string): ClaudeStreamEvent[] {
  const events: ClaudeStreamEvent[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        events.push(parsed as ClaudeStreamEvent);
      }
    } catch {
      // Ignore non-JSON transcript lines.
    }
  }
  return events;
}

function findTerminalResult(events: readonly ClaudeStreamEvent[]): ClaudeStreamEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "result") return event;
  }
  return undefined;
}

function hasUsageLimit(events: readonly ClaudeStreamEvent[]): boolean {
  for (const event of events) {
    if (event.type !== "rate_limit_event") continue;
    const info = event.rate_limit_info;
    if (!info) continue;
    if (info.requests_remaining === 0 || info.tokens_remaining === 0) return true;
  }
  return false;
}

export function claudeArtifactPaths(artifactDir: string): readonly string[] {
  return [path.join(artifactDir, "result.json")];
}

function verifyArtifactPaths(paths: readonly string[]): string[] | undefined {
  const verified: string[] = [];
  for (const artifactPath of paths) {
    try {
      const stats = statSync(artifactPath);
      if (!stats.isFile() || stats.size === 0) {
        return undefined;
      }
      verified.push(artifactPath);
    } catch {
      return undefined;
    }
  }
  return verified;
}

function failure(
  status: ClaudeResultStatus,
  sessionHandle: string,
  artifactPaths: readonly string[],
  code: string,
  message: string,
): ClaudeParseResult {
  return {
    status,
    sessionHandle,
    artifactPaths,
    failure: { code, message },
  };
}

export function parseClaudeResult(stdout: string, artifacts: ClaudeResultArtifacts): ClaudeParseResult {
  const fallbackSessionHandle = artifacts.sessionId ?? "";
  const events = parseStreamEvents(stdout);
  const terminalResult = findTerminalResult(events);

  if (hasUsageLimit(events) && (!terminalResult || terminalResult.is_error === true)) {
    return failure(
      "usage_limit",
      terminalResult?.session_id ?? fallbackSessionHandle,
      [],
      "usage_limit",
      "Claude runner hit a usage or rate limit before producing a successful result",
    );
  }

  if (!terminalResult) {
    return failure(
      "failure",
      fallbackSessionHandle,
      [],
      "missing_structured_result",
      "stdout did not contain a structured terminal result event",
    );
  }

  const sessionHandle = terminalResult.session_id ?? fallbackSessionHandle;

  if (Array.isArray(terminalResult.permission_denials) && terminalResult.permission_denials.length > 0) {
    return failure(
      "permission_denied",
      sessionHandle,
      [],
      "permission_denied",
      "Claude runner reported permission denials in the structured result",
    );
  }

  if (terminalResult.is_error === true || terminalResult.subtype === "error") {
    return failure(
      "failure",
      sessionHandle,
      [],
      "runner_error",
      terminalResult.result?.trim() || "Claude runner returned a structured error result",
    );
  }

  if (terminalResult.subtype !== "success" && terminalResult.subtype !== "completion") {
    return failure(
      "failure",
      sessionHandle,
      [],
      "invalid_result_subtype",
      "Claude runner did not emit a success terminal result",
    );
  }

  const verifiedArtifacts = verifyArtifactPaths(artifacts.artifactPaths);
  if (!verifiedArtifacts || verifiedArtifacts.length === 0) {
    return failure(
      "failure",
      sessionHandle,
      [],
      "missing_artifact_evidence",
      "required on-disk artifact evidence is missing or empty",
    );
  }

  if (artifacts.exitCode !== 0) {
    return failure(
      "failure",
      sessionHandle,
      verifiedArtifacts,
      "non_zero_exit",
      `Claude runner exited with code ${artifacts.exitCode}`,
    );
  }

  return {
    status: "success",
    sessionHandle,
    artifactPaths: verifiedArtifacts,
  };
}
