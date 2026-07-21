export interface BuildCodexArgvInput {
  executable: string;
  model: string;
  workspace: string;
  briefPath: string;
  resultPath: string;
}

export interface BuildCodexResumeArgvInput {
  executable: string;
  sessionHandle: string;
  workspace: string;
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
  sessionHandle: string | undefined;
  artifactPaths: readonly string[];
  failure: string | undefined;
}

export interface CodexResultArtifacts {
  declaredResultPath: string;
  files: Readonly<Record<string, string>>;
}

interface CodexResultArtifact {
  status?: unknown;
  sessionHandle?: unknown;
  artifactPaths?: unknown;
  failure?: unknown;
}

const CODEX_STATUSES = new Set<CodexResultStatus>([
  "success",
  "failure",
  "cancelled",
  "timeout",
  "usage_limit",
  "permission_denied",
]);

export function buildCodexArgv(input: BuildCodexArgvInput): readonly string[] {
  return [
    input.executable,
    "exec",
    "-m",
    input.model,
    "-C",
    input.workspace,
    "-o",
    input.resultPath,
    input.briefPath,
  ];
}

export function buildCodexResumeArgv(input: BuildCodexResumeArgvInput): readonly string[] {
  return [
    input.executable,
    "exec",
    "-C",
    input.workspace,
    "resume",
    input.sessionHandle,
  ];
}

export function parseCodexResult(_stdout: string, artifacts: CodexResultArtifacts): CodexResult {
  const rawArtifact = artifacts.files[artifacts.declaredResultPath];
  if (rawArtifact === undefined) {
    return failureResult(`Missing Codex result artifact at ${artifacts.declaredResultPath}`);
  }

  let parsed: CodexResultArtifact;
  try {
    parsed = JSON.parse(rawArtifact) as CodexResultArtifact;
  } catch {
    return failureResult(`Invalid Codex result artifact JSON at ${artifacts.declaredResultPath}`);
  }

  if (!isCodexResultStatus(parsed.status)) {
    return failureResult(`Invalid Codex result status in ${artifacts.declaredResultPath}`);
  }

  const artifactPaths = parseArtifactPaths(parsed.artifactPaths, artifacts.declaredResultPath);
  if (parsed.status === "success" && artifactPaths.length === 0) {
    return failureResult(`Codex success requires artifact evidence at ${artifacts.declaredResultPath}`);
  }

  return {
    status: parsed.status,
    sessionHandle: typeof parsed.sessionHandle === "string" ? parsed.sessionHandle : undefined,
    artifactPaths,
    failure: typeof parsed.failure === "string" ? parsed.failure : undefined,
  };
}

function failureResult(failure: string): CodexResult {
  return {
    status: "failure",
    sessionHandle: undefined,
    artifactPaths: [],
    failure,
  };
}

function isCodexResultStatus(value: unknown): value is CodexResultStatus {
  return typeof value === "string" && CODEX_STATUSES.has(value as CodexResultStatus);
}

function parseArtifactPaths(value: unknown, declaredResultPath: string): readonly string[] {
  if (value === undefined) return [declaredResultPath];
  if (!Array.isArray(value)) return [];
  return value.filter((path): path is string => typeof path === "string" && path.length > 0);
}
