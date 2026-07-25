import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  interpretationPath,
  parseReviewVerdict,
  redactTranscript,
  reviewerAcceptedAttempt,
  transcriptPath,
} from "../../src/runner/result-contract.js";

/**
 * A reviewer that ran to completion and asked for changes is a completed job
 * with a revise verdict, never a runner failure. Conflating the two is what
 * retried cmp-uimotion-1 to BUDGET_EXCEEDED (QK-RUN-008).
 */
const ACCEPT_EVIDENCE = "Accept as it stands. I found nothing that must be fixed before this lands.";

test("an attempt whose reviewer returns a revise verdict is not accepted", () => {
  assert.equal(
    reviewerAcceptedAttempt({ status: "success", verdict: "revise" }),
    false,
    "a revise verdict must not accept the attempt",
  );
});

test("an attempt whose reviewer returns an accept verdict, quoting it, is accepted", () => {
  assert.equal(
    reviewerAcceptedAttempt({ status: "success", verdict: "accept", verdictEvidence: ACCEPT_EVIDENCE }),
    true,
  );
});

test("a reviewer that crashed is not accepted, and stays distinguishable from a revise verdict", () => {
  assert.equal(reviewerAcceptedAttempt({ status: "failure" }), false);
});

/**
 * Acceptance requires an explicit accept. Returning true for a merely-absent
 * verdict was fail-open: cursor and claude do not mechanically require the
 * field, so a reviewer could omit it and be silently treated as approving.
 * Adding a channel for "revise" while defaulting its absence to "accept" would
 * reintroduce the exact silent-wrong-acceptance class QK-RUN-008 set out to
 * remove. Raised by the independent cross-vendor review, 2026-07-24.
 */
test("a reviewer that returned no verdict does not accept the attempt", () => {
  assert.equal(reviewerAcceptedAttempt({ status: "success" }), false);
});

/**
 * An interpretation that could not establish what the reviewer decided says so
 * (QK-RUN-009). It is a real answer, and it withholds acceptance exactly as a
 * revise does — the one thing it must never do is read as approval.
 */
test("an indeterminate verdict withholds acceptance", () => {
  assert.equal(reviewerAcceptedAttempt({ status: "success", verdict: "indeterminate" }), false);
});

test("indeterminate is a verdict the contract recognises rather than discards", () => {
  assert.equal(parseReviewVerdict("indeterminate"), "indeterminate");
  assert.equal(parseReviewVerdict("undetermined"), undefined);
  assert.equal(parseReviewVerdict(null), undefined);
});

/**
 * Raised by the independent claude review, 2026-07-25: the RunnerJobResult type
 * says a verdict without evidence "is never an acceptance", but the predicate
 * checked only status and verdict, so the invariant lived entirely inside the
 * interpreter's reconciliation. Any other producer — a replay, a future host
 * adapter, a test double — could accept without it.
 */
test("an accept verdict with no supporting evidence does not accept the attempt", () => {
  assert.equal(reviewerAcceptedAttempt({ status: "success", verdict: "accept" }), false);
  assert.equal(reviewerAcceptedAttempt({ status: "success", verdict: "accept", verdictEvidence: "" }), false);
  assert.equal(
    reviewerAcceptedAttempt({ status: "success", verdict: "accept", verdictEvidence: "   " }),
    false,
  );
});

test("an accept verdict carrying evidence passes this predicate, which checks presence not authenticity", () => {
  assert.equal(
    reviewerAcceptedAttempt({
      status: "success",
      verdict: "accept",
      verdictEvidence: "Accept as it stands. I found nothing that must be fixed before this lands.",
    }),
    true,
  );
});

test("only an explicit accept verdict accepts the attempt", () => {
  assert.equal(
    reviewerAcceptedAttempt({ status: "success", verdict: "accept", verdictEvidence: ACCEPT_EVIDENCE }),
    true,
  );
  assert.equal(reviewerAcceptedAttempt({ status: "success", verdict: "revise" }), false);
  assert.equal(reviewerAcceptedAttempt({ status: "success" }), false);
  assert.equal(
    reviewerAcceptedAttempt({ status: "failure", verdict: "accept", verdictEvidence: ACCEPT_EVIDENCE }),
    false,
  );
});

/**
 * The interpretation record sits beside the transcript: the transcript is what
 * the runner said, and this is how that became a structured result. Both are
 * job-unique for the same reason — .quirks/briefs is shared across campaigns,
 * so a collision would overwrite another job's evidence.
 */
test("interpretation records are job-unique and land beside the transcript", () => {
  const first = interpretationPath("/tmp/artifacts", "cmp-1:QK-1:reviewer:1");
  const second = interpretationPath("/tmp/artifacts", "cmp-1:QK-1:reviewer:2");

  assert.notEqual(first, second);
  assert.equal(path.dirname(first), "/tmp/artifacts");
  assert.doesNotMatch(path.basename(first), /[:/\\]/);
  assert.notEqual(first, transcriptPath("/tmp/artifacts", "cmp-1:QK-1:reviewer:1"));
});

/**
 * A codex reviewer runs under `-s read-only` and so physically cannot write a
 * findings file — the 2026-07-24 verification round proved it, failing with
 * permission_denied while trying. Its reasoning exists only in the transcript,
 * so unless that is retained the review is unreadable and the operator is left
 * with a bare verdict. Retaining it is also the honesty constraint QK-RUN-009
 * depends on: any later interpretation must remain auditable against what the
 * runner actually said.
 */
test("transcript path is job-unique so concurrent jobs never clobber each other", () => {
  const first = transcriptPath("/tmp/artifacts", "job-1");
  const second = transcriptPath("/tmp/artifacts", "job-2");

  assert.notEqual(first, second);
  assert.match(first, /job-1/);
});

test("transcript path sanitizes campaign-style job ids into a plain file name", () => {
  const resolved = transcriptPath("/tmp/artifacts", "cmp-1:QK-1:reviewer:2");
  assert.equal(path.dirname(resolved), "/tmp/artifacts");
  assert.doesNotMatch(path.basename(resolved), /[:/\\]/);
});

test("retained transcripts redact secret-shaped text rather than storing it verbatim", () => {
  const redacted = redactTranscript('{"msg":"token sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLL"}');
  assert.doesNotMatch(redacted, /sk-ant-api03-AAAABBBB/);
  assert.match(redacted, /redacted-secret/);
});
