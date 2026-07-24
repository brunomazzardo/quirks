import type { RunnerType } from "../campaign/routing.js";
import { claudeResultPath } from "./claude.js";
import { cursorResultPath } from "./cursor.js";

/**
 * Job-bound result envelope path a runner's brief must state, or undefined when
 * the CLI enforces the envelope itself.
 *
 * codex writes the envelope mechanically (`--output-schema` plus `-o`), so its
 * brief needs no contract. cursor has no equivalent flag (QK-RUN-005), and
 * neither does claude — yet `parseClaudeResult` hard-requires a non-empty
 * artifact on disk. Leaving that unstated made the envelope a matter of chance:
 * the 2026-07-24 real-CLI probe ran four identical claude cells and one wrote
 * no envelope at all. See docs/smoke/2026-07-24-runner-boundary-probe.md.
 */
export function resultContractPath(
  runnerType: RunnerType,
  artifactDir: string,
  jobId: string,
): string | undefined {
  switch (runnerType) {
    case "codex":
      return undefined;
    case "cursor":
      return cursorResultPath(artifactDir, jobId);
    case "claude":
      return claudeResultPath(artifactDir, jobId);
    default: {
      const exhaustive: never = runnerType;
      return exhaustive;
    }
  }
}
