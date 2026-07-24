import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { claudeResultPath } from "../../src/runner/claude.js";
import { cursorResultPath } from "../../src/runner/cursor.js";
import {
  redactTranscript,
  resultContractPath,
  reviewerAcceptedAttempt,
  transcriptPath,
} from "../../src/runner/result-contract.js";

/**
 * Which runners need the envelope contract stated in the brief, and which get
 * it enforced by the CLI itself.
 *
 * codex writes the envelope mechanically via --output-schema plus -o, so its
 * brief needs no contract. cursor has no equivalent flag (QK-RUN-005). claude
 * has none either, and `parseClaudeResult` hard-requires a non-empty artifact
 * on disk — yet its brief never stated one, so writing the envelope was left to
 * chance. The 2026-07-24 probe caught this directly: four identical claude
 * cells, one silently wrote no envelope.
 */
test("codex needs no brief-stated result contract because the CLI enforces the envelope", () => {
  assert.equal(resultContractPath("codex", "/tmp/artifacts", "job-1"), undefined);
});

test("cursor carries a brief-stated, job-unique result contract", () => {
  assert.equal(
    resultContractPath("cursor", "/tmp/artifacts", "job-1"),
    cursorResultPath("/tmp/artifacts", "job-1"),
  );
});

test("claude carries a brief-stated, job-unique result contract", () => {
  assert.equal(
    resultContractPath("claude", "/tmp/artifacts", "job-1"),
    claudeResultPath("/tmp/artifacts", "job-1"),
  );
});

/**
 * A reviewer that ran to completion and asked for changes is a completed job
 * with a revise verdict, never a runner failure. Conflating the two is what
 * retried cmp-uimotion-1 to BUDGET_EXCEEDED (QK-RUN-008).
 */
test("an attempt whose reviewer returns a revise verdict is not accepted", () => {
  assert.equal(
    reviewerAcceptedAttempt({ status: "success", verdict: "revise" }),
    false,
    "a revise verdict must not accept the attempt",
  );
});

test("an attempt whose reviewer returns an accept verdict is accepted", () => {
  assert.equal(reviewerAcceptedAttempt({ status: "success", verdict: "accept" }), true);
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

test("only an explicit accept verdict accepts the attempt", () => {
  assert.equal(reviewerAcceptedAttempt({ status: "success", verdict: "accept" }), true);
  assert.equal(reviewerAcceptedAttempt({ status: "success", verdict: "revise" }), false);
  assert.equal(reviewerAcceptedAttempt({ status: "success" }), false);
  assert.equal(reviewerAcceptedAttempt({ status: "failure", verdict: "accept" }), false);
});

test("result contract paths stay distinct per runner and per job", () => {
  const paths = [
    resultContractPath("cursor", "/tmp/artifacts", "job-1"),
    resultContractPath("cursor", "/tmp/artifacts", "job-2"),
    resultContractPath("claude", "/tmp/artifacts", "job-1"),
    resultContractPath("claude", "/tmp/artifacts", "job-2"),
  ];
  assert.equal(new Set(paths).size, paths.length, "every runner/job pair needs its own envelope path");
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
