import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCursorArgv,
  buildCursorResumeArgv,
  parseCursorResult,
} from "../../src/runner/cursor.js";

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

test("parseCursorResult reports success only from a structured result event", () => {
  const stdout = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "assistant", message: "working on it" }),
    JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "thread-42" }),
  ].join("\n");
  const parsed = parseCursorResult(stdout, ["artifacts/job-1/output.json"]);
  assert.equal(parsed.status, "success");
  assert.equal(parsed.sessionHandle, "thread-42");
  assert.deepEqual(parsed.artifactPaths, ["artifacts/job-1/output.json"]);
  assert.equal(parsed.failure, undefined);
});

test("parseCursorResult never treats prose 'done' as success", () => {
  const stdout = [
    JSON.stringify({ type: "assistant", message: "done! all tests pass" }),
    "Task complete.",
  ].join("\n");
  const parsed = parseCursorResult(stdout, []);
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "missing_structured_result");
});

test("parseCursorResult classifies a reported permission denial", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    session_id: "thread-7",
    error: "Permission denied for file write",
  });
  const parsed = parseCursorResult(stdout, []);
  assert.equal(parsed.status, "permission_denied");
  assert.equal(parsed.sessionHandle, "thread-7");
  assert.equal(parsed.failure?.reason, "permission_denied_signal");
});

test("parseCursorResult classifies a reported usage limit", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    error: "Usage limit reached for this account",
  });
  const parsed = parseCursorResult(stdout, []);
  assert.equal(parsed.status, "usage_limit");
});

test("parseCursorResult falls back to a generic failure for other reported errors", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    error: "Unexpected internal runner error",
  });
  const parsed = parseCursorResult(stdout, []);
  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.reason, "runner_reported_error");
});
