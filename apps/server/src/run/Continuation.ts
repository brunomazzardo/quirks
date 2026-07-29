// Continuation brief — written into the SAME worktree on an honest partial so
// the next attempt resumes rather than restarts (Pilot pattern; D11).

// Ported verbatim from the bun-era src/run/continuation.ts (QK-MONO-005).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { continuationPath } from "../store/LedgerPaths.ts";

export interface ContinuationInput {
  taskId: string;
  /** What already exists in the worktree — commits, files, passing checks. */
  whatExists: string[];
  /** Numbered remaining scope. */
  remaining: string[];
  worktree: string;
  /** Optional free-form note from the parent. */
  note?: string;
}

/** Render + write. Always says "do not redo groundwork". */
export function writeContinuationBrief(input: ContinuationInput): string {
  const path = continuationPath(input.worktree, input.taskId);
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    `# Continuation — ${input.taskId}`,
    "",
    "This worktree already has progress. **Do not redo groundwork.**",
    "",
    "## What exists",
    ...(input.whatExists.length > 0
      ? input.whatExists.map((w) => `- ${w}`)
      : ["- (nothing recorded)"]),
    "",
    "## Remaining scope",
    ...(input.remaining.length > 0
      ? input.remaining.map((r, i) => `${i + 1}. ${r}`)
      : ["1. (unspecified — ask the parent record)"]),
  ];
  if (input.note) {
    lines.push("", "## Note", input.note);
  }
  lines.push("");
  writeFileSync(path, lines.join("\n"), "utf8");
  return path;
}
