import assert from "node:assert/strict";
import test from "node:test";
import { claudeResultPath } from "../../src/runner/claude.js";
import { cursorResultPath } from "../../src/runner/cursor.js";
import { resultContractPath, reviewerAcceptedAttempt } from "../../src/runner/result-contract.js";

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
