import path from "node:path";
import { fileURLToPath } from "node:url";

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

export type CodexSandboxMode = "read-only" | "workspace-write";

export const CODEX_PROMPT_MAX_BYTES = 100 * 1024;

export function codexResultPath(artifactDir: string): string {
  return path.join(artifactDir, "codex-result.json");
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
    `model_reasoning_effort=${input.effort}`,
    "--output-schema",
    input.schemaPath,
    "--color",
    "never",
    "--json",
    "-o",
    input.resultPath,
    input.promptText,
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
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
