// Claude argv. Learned facts (each cost a repair cycle):
// - the prompt must precede every flag — a variadic flag before it swallows it
// - --add-dir is variadic and must stay last
// - --output-format=stream-json requires --verbose (do not rely on settings.json)
// - effort tiers are quirks names; map to claude's low|medium|high|xhigh|max

export interface ClaudeArgvInput {
  executable: string;
  sessionId: string;
  model: string;
  effort: string;
  briefPath: string;
  workspace: string;
  artifactDir: string;
}

const CLAUDE_EFFORTS: Readonly<Record<string, string>> = {
  mechanical: "low",
  standard: "medium",
  high: "high",
  principal: "xhigh",
};

export function claudeEffort(effort: string): string {
  return CLAUDE_EFFORTS[effort] ?? effort;
}

export function buildClaudeArgv(input: ClaudeArgvInput): readonly string[] {
  // Quirks imposes no tool restrictions (FOUNDING D12) — permission bypass is
  // the write posture, not a capability negotiation.
  return [
    input.executable,
    "-p",
    "--session-id",
    input.sessionId,
    // Prompt before every flag: a variadic flag placed before it would consume it.
    input.briefPath,
    "--model",
    input.model,
    "--effort",
    claudeEffort(input.effort),
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    // --add-dir is variadic — stays last so nothing after is absorbed as a dir.
    "--add-dir",
    input.workspace,
    input.artifactDir,
  ];
}
