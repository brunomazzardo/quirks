import type { RunnerType } from "../campaign/routing.js";
import { claudeResultPath } from "./claude.js";
import { cursorResultPath } from "./cursor.js";

/**
 * A reviewer's judgment, kept separate from the runner's transport status.
 *
 * `status` answers "did the job run"; `verdict` answers "what did the reviewer
 * decide". Overloading one enum for both meant a reviewer recommending changes
 * could only write status:"failure", which the supervisor read as a crashed
 * runner and retried. The cmp-uimotion-1 campaign retried exactly that way
 * until BUDGET_EXCEEDED while holding two complete, well-formed reviews.
 */
export type ReviewVerdict = "accept" | "revise";

export function parseReviewVerdict(raw: unknown): ReviewVerdict | undefined {
  return raw === "accept" || raw === "revise" ? raw : undefined;
}

/**
 * Whether a reviewer job accepts the attempt. A reviewer that ran and asked for
 * changes is a completed job that withholds acceptance — not a runner failure,
 * and so never a retryable runner error.
 *
 * Acceptance requires an explicit accept. Treating an absent verdict as accept
 * was fail-open: cursor and claude do not mechanically require the field, so a
 * reviewer could omit it and be read as approving. Adding a channel for revise
 * while defaulting its absence to accept would reintroduce the very
 * silent-wrong-acceptance class this was meant to remove.
 */
export function reviewerAcceptedAttempt(
  reviewer: { status: string; verdict?: ReviewVerdict | undefined },
): boolean {
  if (reviewer.status !== "success") return false;
  return reviewer.verdict === "accept";
}

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
