import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { artifactPathsForRunner } from "../../src/runner/cli-runner-port.js";
import {
  buildCursorArgv,
  buildCursorResumeArgv,
  cursorResultPath,
  parseCursorResult,
} from "../../src/runner/cursor.js";
import type { RunnerProfile } from "../../src/runner/types.js";

const baseInput = {
  executable: "/usr/bin/agent",
  sessionId: "thread-1",
  model: "composer-2.5",
  briefPath: "artifacts/job-1/brief.md",
  workspace: "/tmp/worktree",
};

test("cursor argv uses non-interactive entry point with model and brief path", () => {
  const argv = buildCursorArgv(baseInput);
  assert.equal(argv[0], "/usr/bin/agent");
  assert.equal(argv.includes("-p"), true);
  assert.equal(argv.includes("--model"), true);
  assert.equal(argv[argv.indexOf("--model") + 1], "composer-2.5");
  assert.equal(argv.includes(baseInput.briefPath), true);
});

test("cursor argv never embeds brief prose, only the file path", () => {
  const argv = buildCursorArgv(baseInput);
  for (const entry of argv) {
    assert.equal(entry.includes("\n"), false);
  }
  assert.equal(argv.some((entry) => entry.length > 200), false);
});

test("cursor argv omits force/trust posture when capability is not granted", () => {
  const argv = buildCursorArgv({ ...baseInput, capabilities: ["repository-read"] });
  assert.equal(argv.includes("--force"), false);
  assert.equal(argv.includes("--trust"), false);
});

test("cursor argv adds force posture only when profile capabilities allow it", () => {
  const argv = buildCursorArgv({ ...baseInput, capabilities: ["repository-read", "repository-write"] });
  assert.equal(argv.includes("--force"), true);
});

test("cursor argv defaults to no force posture when capabilities are absent", () => {
  const argv = buildCursorArgv(baseInput);
  assert.equal(argv.includes("--force"), false);
});

test("buildCursorResumeArgv includes --resume with the thread id", () => {
  const argv = buildCursorResumeArgv("thread-9", baseInput);
  assert.equal(argv[0], "/usr/bin/agent");
  assert.equal(argv.includes("--resume"), true);
  assert.equal(argv[argv.indexOf("--resume") + 1], "thread-9");
  assert.equal(argv.includes("-p"), true);
});

// Mirrors codexResultPath: the first real campaign shared one
// cursor-result.json between roles and attempts, so a reviewer attempt
// could clobber (or inherit) another job's envelope.
test("cursorResultPath is unique per job so concurrent jobs never clobber each other", () => {
  const first = cursorResultPath("/tmp/artifacts", "job-1");
  const second = cursorResultPath("/tmp/artifacts", "job-2");

  assert.notEqual(first, second);
  assert.match(first, /job-1/);
  assert.match(second, /job-2/);
});

test("cursorResultPath sanitizes campaign-style job ids into a plain file name", () => {
  const resultPath = cursorResultPath("/tmp/artifacts", "cmp-1:QK-1:reviewer:2");
  assert.equal(path.dirname(resultPath), "/tmp/artifacts");
  assert.doesNotMatch(path.basename(resultPath), /[:/\\]/);
  assert.notEqual(
    resultPath,
    cursorResultPath("/tmp/artifacts", "cmp-1:QK-1:implementer:2"),
  );
});

test("artifactPathsForRunner declares the job-unique cursor result path", () => {
  const profile: RunnerProfile = {
    schemaVersion: 1,
    profileId: "cursor-standard",
    runnerType: "cursor",
    executable: "/usr/bin/agent",
    accountAlias: "default",
    quotaPoolId: "pool",
    tier: "standard",
    model: "composer-2.5",
    effort: "standard",
    capabilities: ["repository-read"],
    wallClockMs: 5_000,
    redactionRules: [],
  };

  const first = artifactPathsForRunner(profile, "/tmp/artifacts", "job-1");
  const second = artifactPathsForRunner(profile, "/tmp/artifacts", "job-2");
  assert.deepEqual(first, [cursorResultPath("/tmp/artifacts", "job-1")]);
  assert.deepEqual(second, [cursorResultPath("/tmp/artifacts", "job-2")]);
  assert.notDeepEqual(first, second);
});

const DECLARED_RESULT_PATH = "/tmp/artifacts/cursor-result-job-1.json";

function artifactsWith(envelope: unknown): {
  declaredResultPath: string;
  files: Readonly<Record<string, string>>;
} {
  return {
    declaredResultPath: DECLARED_RESULT_PATH,
    files: {
      [DECLARED_RESULT_PATH]:
        typeof envelope === "string" ? envelope : JSON.stringify(envelope),
    },
  };
}

const missingArtifacts = { declaredResultPath: DECLARED_RESULT_PATH, files: {} } as const;

const validEnvelope = {
  status: "success",
  sessionHandle: "thread-42",
  artifactPaths: [DECLARED_RESULT_PATH],
  failure: null,
} as const;

test("parseCursorResult reports success from a valid declared result envelope", () => {
  const stdout = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "assistant", message: "working on it" }),
    JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "thread-42" }),
  ].join("\n");
  const parsed = parseCursorResult(stdout, artifactsWith(validEnvelope));
  assert.equal(parsed.status, "success");
  assert.equal(parsed.sessionHandle, "thread-42");
  assert.deepEqual(parsed.artifactPaths, [DECLARED_RESULT_PATH]);
  assert.equal(parsed.failure, undefined);
});

test("parseCursorResult accepts a valid envelope even when stdout has no result event", () => {
  const parsed = parseCursorResult("prose transcript only\n", artifactsWith(validEnvelope));
  assert.equal(parsed.status, "success");
  assert.equal(parsed.sessionHandle, "thread-42");
  assert.deepEqual(parsed.artifactPaths, [DECLARED_RESULT_PATH]);
});

// First real campaign 2026-07-23: the cursor CLI reported success but the
// reviewer never wrote the envelope, and the bare missing_structured_result
// gave the operator nothing to act on.
test("parseCursorResult fails a CLI-level success without a declared envelope, naming the path", () => {
  const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "thread-42" });
  const parsed = parseCursorResult(stdout, missingArtifacts);
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "missing_structured_result");
  assert.match(parsed.failure?.detail ?? "", new RegExp(DECLARED_RESULT_PATH));
  assert.equal(parsed.sessionHandle, "thread-42");
});

test("parseCursorResult never treats prose 'done' as success", () => {
  const stdout = [
    JSON.stringify({ type: "assistant", message: "done! all tests pass" }),
    "Task complete.",
  ].join("\n");
  const parsed = parseCursorResult(stdout, missingArtifacts);
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "missing_structured_result");
});

test("parseCursorResult names every missing envelope field in the failure detail", () => {
  const parsed = parseCursorResult("", artifactsWith({ status: "success" }));
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "missing_structured_result");
  for (const field of ["sessionHandle", "artifactPaths", "failure"]) {
    assert.match(parsed.failure?.detail ?? "", new RegExp(field), `detail must name ${field}`);
  }
  assert.doesNotMatch(parsed.failure?.detail ?? "", /\bstatus\b/);
});

test("parseCursorResult names invalid envelope fields such as the campaign's status ok", () => {
  const parsed = parseCursorResult("", artifactsWith({ status: "ok" }));
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "missing_structured_result");
  assert.match(parsed.failure?.detail ?? "", /status/);
  assert.match(parsed.failure?.detail ?? "", /sessionHandle/);
  assert.match(parsed.failure?.detail ?? "", /artifactPaths/);
});

test("parseCursorResult rejects a non-JSON envelope with an actionable detail", () => {
  const parsed = parseCursorResult("", artifactsWith("All done, see summary above.\n"));
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "missing_structured_result");
  assert.match(parsed.failure?.detail ?? "", /JSON/);
  assert.match(parsed.failure?.detail ?? "", new RegExp(DECLARED_RESULT_PATH));
});

test("parseCursorResult downgrades envelope success without artifact evidence", () => {
  const parsed = parseCursorResult(
    "",
    artifactsWith({ ...validEnvelope, artifactPaths: [] }),
  );
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "missing_artifact_evidence");
});

test("parseCursorResult carries an honest failure envelope through verbatim", () => {
  const parsed = parseCursorResult(
    "",
    artifactsWith({
      status: "failure",
      sessionHandle: "thread-9",
      artifactPaths: [],
      failure: "honest_partial",
    }),
  );
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.sessionHandle, "thread-9");
  assert.equal(parsed.failure?.reason, "runner_reported_error");
  assert.equal(parsed.failure?.detail, "honest_partial");
});

test("parseCursorResult prefers the stream session handle over the envelope's", () => {
  const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "stream-thread" });
  const parsed = parseCursorResult(stdout, artifactsWith(validEnvelope));
  assert.equal(parsed.status, "success");
  assert.equal(parsed.sessionHandle, "stream-thread");
});

test("parseCursorResult classifies a reported permission denial without an envelope", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    session_id: "thread-7",
    error: "Permission denied for file write",
  });
  const parsed = parseCursorResult(stdout, missingArtifacts);
  assert.equal(parsed.status, "permission_denied");
  assert.equal(parsed.sessionHandle, "thread-7");
  assert.equal(parsed.failure?.reason, "permission_denied_signal");
});

test("parseCursorResult classifies a reported usage limit without an envelope", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    error: "Usage limit reached for this account",
  });
  const parsed = parseCursorResult(stdout, missingArtifacts);
  assert.equal(parsed.status, "usage_limit");
});

test("parseCursorResult reports CLI-level errors over a missing envelope", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    error: "Unexpected internal runner error",
  });
  const parsed = parseCursorResult(stdout, missingArtifacts);
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "runner_reported_error");
});
