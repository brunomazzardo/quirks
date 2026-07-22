export const PORTABLE_HOST_MATRIX = [
  { host: "claude", runner: "claude" },
  { host: "claude", runner: "codex" },
  { host: "claude", runner: "cursor" },
  { host: "codex", runner: "claude" },
  { host: "codex", runner: "codex" },
  { host: "codex", runner: "cursor" },
  { host: "cursor", runner: "claude" },
  { host: "cursor", runner: "codex" },
  { host: "cursor", runner: "cursor" },
] as const;

export function hostArgv(host: string, repositoryRoot: string, taskId: string): string[] {
  return ["quirks-campaign", "preflight", "--repository", repositoryRoot, "--task", taskId, "--json"];
}
