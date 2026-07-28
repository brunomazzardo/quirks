// Cursor argv. Learned facts:
// - there is NO --file flag (2026.07.20); the prompt is a trailing positional
// - --trust suppresses the workspace trust prompt that blocks headless runs
// - --force is the write posture (not a separate capability negotiation)

export interface CursorArgvInput {
  executable: string;
  model: string;
  briefPath: string;
  workspace: string;
  artifactDir: string;
}

export function cursorPromptText(briefPath: string): string {
  // argv is world-visible in `ps` — reference the brief by path, never inline it.
  return `Read the brief at ${briefPath} and complete it.`;
}

export function buildCursorArgv(input: CursorArgvInput): readonly string[] {
  return [
    input.executable,
    "-p",
    "--output-format",
    "json",
    "--model",
    input.model,
    "--trust",
    "--workspace",
    input.workspace,
    "--add-dir",
    input.artifactDir,
    "--force",
    cursorPromptText(input.briefPath),
  ];
}
