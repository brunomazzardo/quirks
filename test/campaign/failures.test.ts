import assert from "node:assert/strict";
import test from "node:test";
import { classifyFailure, shouldRetryFailure } from "../../src/campaign/failures.js";

test("classifies usage limits and permission denials without generic retry", () => {
  assert.equal(classifyFailure({ status: "usage_limit" }), "usage_limit");
  assert.equal(classifyFailure({ status: "permission_denied" }), "permission_denial");
  assert.equal(classifyFailure({ status: "failure", retryable: true }), "transient_runner");
});

test("includes all control-plane failure classes", () => {
  assert.equal(classifyFailure({ status: "failure", reason: "task_rejection" }), "task_rejection");
  assert.equal(classifyFailure({ status: "failure", reason: "honest_partial" }), "honest_partial");
  assert.equal(classifyFailure({ status: "failure", reason: "fabricated_evidence" }), "fabricated_evidence");
  assert.equal(classifyFailure({ status: "failure", reason: "wedge_after_work" }), "wedge_after_work");
  assert.equal(classifyFailure({ status: "failure", reason: "task_source_conflict" }), "task_source_conflict");
  assert.equal(classifyFailure({ status: "failure", reason: "task_source_outage" }), "task_source_outage");
  assert.equal(classifyFailure({ status: "failure", reason: "ambiguous_mutation" }), "ambiguous_mutation");
  assert.equal(classifyFailure({ status: "failure", reason: "integration_failure" }), "integration_failure");
  assert.equal(classifyFailure({ status: "failure", reason: "pre_push_landing_failure" }), "pre_push_landing_failure");
  assert.equal(classifyFailure({ status: "failure", reason: "post_push_ambiguity" }), "post_push_ambiguity");
  assert.equal(classifyFailure({ status: "failure", reason: "crash_restart" }), "crash_restart");
});

test("allows one retry for transient runner failures and none for usage limits before reset", () => {
  assert.equal(shouldRetryFailure("transient_runner", { retriesUsed: 0, usageLimitReset: false }), true);
  assert.equal(shouldRetryFailure("transient_runner", { retriesUsed: 1, usageLimitReset: false }), false);
  assert.equal(shouldRetryFailure("usage_limit", { retriesUsed: 0, usageLimitReset: false }), false);
  assert.equal(shouldRetryFailure("usage_limit", { retriesUsed: 0, usageLimitReset: true }), true);
});
