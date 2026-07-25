import { createHash } from "node:crypto";
import path from "node:path";
import { redactSecretShapedText } from "../prompt/untrusted-content.js";

/**
 * A reviewer's judgment, kept separate from the runner's transport status.
 *
 * `status` answers "did the job run"; `verdict` answers "what did the reviewer
 * decide". Overloading one enum for both meant a reviewer recommending changes
 * could only write status:"failure", which the supervisor read as a crashed
 * runner and retried. The cmp-uimotion-1 campaign retried exactly that way
 * until BUDGET_EXCEEDED while holding two complete, well-formed reviews.
 *
 * `indeterminate` is a first-class answer, not a missing one. When a reviewer's
 * judgment cannot be established from what it actually said, recording that
 * fact is honest; recording nothing invites a later reader to supply "accept"
 * by default, which is the fail-open this whole boundary exists to prevent.
 */
export type ReviewVerdict = "accept" | "revise" | "indeterminate";

export function parseReviewVerdict(raw: unknown): ReviewVerdict | undefined {
  return raw === "accept" || raw === "revise" || raw === "indeterminate" ? raw : undefined;
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
 * Job-unique path for the retained runner transcript.
 *
 * A reviewer's reasoning frequently cannot reach us any other way. A codex
 * reviewer runs under `-s read-only` and so cannot write a findings file at
 * all, and its final message is constrained by `--output-schema` to be the
 * envelope — the 2026-07-24 review rounds lost a Critical finding to exactly
 * that squeeze, truncated into a 256-character transport field. Retaining the
 * transcript is also what keeps any later interpretation auditable against
 * what the runner actually said.
 */
export function transcriptPath(artifactDir: string, jobId: string): string {
  // Sanitizing alone is not injective: `cmp:alpha` and `cmp-alpha` collapse to
  // the same name, and .quirks/briefs is shared across campaigns, so one job's
  // evidence could overwrite another's. A digest of the raw id disambiguates.
  const safeJobId = jobId.replace(/[^A-Za-z0-9._-]/g, "-");
  const digest = createHash("sha256").update(jobId).digest("hex").slice(0, 8);
  return path.join(artifactDir, `transcript-${safeJobId}-${digest}.jsonl`);
}

/**
 * Job-unique path for the retained interpretation record.
 *
 * Interpretation is never the only record: the transcript says what the runner
 * said, and this says how that became a structured result — which model read
 * it, under which brief, what it quoted, and which mechanical checks fired.
 * Without it, a verdict is an assertion; with it, a verdict is auditable.
 */
export function interpretationPath(artifactDir: string, jobId: string): string {
  const safeJobId = jobId.replace(/[^A-Za-z0-9._-]/g, "-");
  const digest = createHash("sha256").update(jobId).digest("hex").slice(0, 8);
  return path.join(artifactDir, `interpretation-${safeJobId}-${digest}.json`);
}

/** Redact secret-shaped text before a transcript is written to disk. */
export function redactTranscript(transcript: string): string {
  return redactSecretShapedText(transcript);
}
