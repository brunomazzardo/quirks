const FORCE_CAPABILITY = "repository-write";

/**
 * Positional prompt for a cursor job. cursor-agent takes its prompt as a
 * positional (`agent [prompt...]`) and has no flag that accepts a prompt file,
 * so the brief is referenced by path rather than inlined: argv is world-visible
 * in `ps`, and a real brief would otherwise land there verbatim.
 */
export function cursorPromptText(briefPath: string): string {
  return `Read the brief at ${briefPath} and complete it.`;
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
    // The brief lives outside the workspace.
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
