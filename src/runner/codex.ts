// Codex argv. Learned facts:
// - bind the workspace with -C on every dispatch AND every resume
// - quirks effort tiers map onto model_reasoning_effort
// - inline the brief when it fits; otherwise point at the path (≤100 KiB)

export interface CodexArgvInput {
  executable: string;
  model: string;
  workspace: string;
  artifactDir: string;
  effort: string;
  promptText: string;
}

export const CODEX_PROMPT_MAX_BYTES = 100 * 1024;

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
  if (
    briefContents !== undefined &&
    Buffer.byteLength(briefContents, "utf8") <= CODEX_PROMPT_MAX_BYTES
  ) {
    return briefContents;
  }
  return `Read the brief at ${briefPath} and complete it.`;
}

export function buildCodexArgv(input: CodexArgvInput): readonly string[] {
  // No sandbox restriction — FOUNDING D12. workspace-write is the write posture.
  return [
    input.executable,
    "exec",
    "-m",
    input.model,
    "-C",
    input.workspace,
    "-s",
    "workspace-write",
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
