export interface BuildCodexArgvInput {
  executable: string;
  model: string;
  workspace: string;
  promptText: string;
  artifactDir: string;
  capabilities: readonly string[];
  effort: string;
}

export interface BuildCodexResumeArgvInput {
  executable: string;
  workspace: string;
  sessionHandle: string;
  briefPath: string;
  capabilities: readonly string[];
  effort: string;
  continuePrompt?: string;
}

export type CodexSandboxMode = "read-only" | "workspace-write";

export const CODEX_PROMPT_MAX_BYTES = 100 * 1024;

export const CODEX_CONTINUE_PROMPT =
  "Continue from the current thread state. Re-read the brief at <briefPath> and pick the next highest-value step.";

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

/**
 * The prompt text codex receives. The brief is inlined when it fits, because a
 * path alone leaves the model to find it; there is no envelope instruction,
 * since nothing reads an envelope any more.
 */
export function codexPromptText(briefPath: string, briefContents: string | undefined): string {
  if (briefContents !== undefined && Buffer.byteLength(briefContents, "utf8") <= CODEX_PROMPT_MAX_BYTES) {
    return briefContents;
  }
  return `Read the brief at ${briefPath} and complete it.`;
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
    "--color",
    "never",
    "--json",
    "--",
    input.promptText,
  ];
}

export function buildCodexResumeArgv(input: BuildCodexResumeArgvInput): readonly string[] {
  return [
    input.executable,
    "exec",
    // The initial dispatch binds the workspace with -C; a resume that omits it
    // restarts in whatever directory the supervisor happens to occupy.
    "-C",
    input.workspace,
    "-s",
    codexSandboxMode(input.capabilities),
    "-c",
    `model_reasoning_effort=${codexReasoningEffort(input.effort)}`,
    "--color",
    "never",
    "--json",
    "resume",
    input.sessionHandle,
    "--",
    input.continuePrompt ?? CODEX_CONTINUE_PROMPT.replace("<briefPath>", input.briefPath),
  ];
}
