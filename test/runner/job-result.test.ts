import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJobResult } from "../../src/runner/job-result.js";

test("normalizeJobResult returns schema v1 runner metadata and immutable artifact paths", () => {
  const artifactPaths = ["artifacts/job-1/result.json"];

  const result = normalizeJobResult({
    jobId: "job-1",
    profileId: "claude-standard",
    runnerType: "claude",
    resolvedModel: "claude-sonnet",
    effort: "standard",
    status: "success",
    sessionHandle: "session-1",
    artifactPaths,
    usage: { inputTokens: 12, outputTokens: 34 },
    failure: undefined,
  });

  artifactPaths.push("artifacts/job-1/late.txt");

  assert.deepEqual(result, {
    schemaVersion: 1,
    jobId: "job-1",
    runner: "claude-standard",
    runnerType: "claude",
    resolvedModel: "claude-sonnet",
    effort: "standard",
    status: "success",
    sessionHandle: "session-1",
    artifactPaths: ["artifacts/job-1/result.json"],
    usage: { inputTokens: 12, outputTokens: 34 },
    failure: undefined,
  });
});

test("normalizeJobResult preserves structured failure details", () => {
  const result = normalizeJobResult({
    jobId: "job-2",
    profileId: "codex-high",
    runnerType: "codex",
    resolvedModel: "gpt-5-codex",
    effort: "high",
    status: "permission_denied",
    sessionHandle: "session-2",
    artifactPaths: [],
    failure: {
      code: "permission_denied",
      message: "runner requested blocked command",
    },
  });

  assert.equal(result.status, "permission_denied");
  assert.deepEqual(result.failure, {
    code: "permission_denied",
    message: "runner requested blocked command",
  });
});
