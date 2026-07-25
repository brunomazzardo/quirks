export interface ClaudeArgvInput {
  executable: string;
  sessionId: string;
  model: string;
  effort: string;
  briefPath: string;
  workspace: string;
  artifactDir: string;
  configDir?: string;
  allowPermissionBypass?: boolean;
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
  input: Pick<
    ClaudeArgvInput,
    "model" | "effort" | "workspace" | "artifactDir" | "allowPermissionBypass"
  >,
): void {
  argv.push(
    "--model",
    input.model,
    "--effort",
    claudeEffort(input.effort),
    "--output-format",
    "stream-json",
    // --output-format=stream-json is rejected without --verbose. Passing it
    // explicitly keeps dispatch independent of a per-account settings.json,
    // which is the only reason the personal account ever worked.
    "--verbose",
  );
  if (input.allowPermissionBypass === true) {
    argv.push("--dangerously-skip-permissions");
  }
  // --add-dir is variadic, so it stays last: any positional appended after it
  // would be absorbed as another directory rather than read as the prompt.
  argv.push("--add-dir", input.workspace, input.artifactDir);
}

export function buildClaudeArgv(input: ClaudeArgvInput): readonly string[] {
  const argv = [
    input.executable,
    "-p",
    "--session-id",
    input.sessionId,
    // The prompt precedes every flag: a variadic flag placed before it would
    // consume it, leaving the CLI with no prompt at all.
    input.briefPath,
  ];
  appendSharedArgv(argv, input);
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
