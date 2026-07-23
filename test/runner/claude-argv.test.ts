import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildClaudeArgv,
  buildClaudeEnv,
  buildClaudeResumeArgv,
  claudeEffort,
  parseClaudeResult,
} from "../../src/runner/claude.js";

const baseInput = {
  executable: "/usr/bin/claude",
  sessionId: "11111111-1111-4111-8111-111111111111",
  model: "fable",
  effort: "high",
  briefPath: "artifacts/job-1/brief.md",
  workspace: "/tmp/worktree",
} as const;

test("claude argv uses explicit session id and never enables permission bypass by default", () => {
  const argv = buildClaudeArgv(baseInput);
  assert.equal(argv[0], "/usr/bin/claude");
  assert.equal(argv.includes("-p"), true);
  assert.equal(argv.includes("--session-id"), true);
  assert.equal(argv.includes("--dangerously-skip-permissions"), false);
  assert.equal(argv.includes(baseInput.sessionId), true);
});

test("claude argv includes model and effort from input", () => {
  const argv = buildClaudeArgv(baseInput);
  const modelIndex = argv.indexOf("--model");
  const effortIndex = argv.indexOf("--effort");
  assert.equal(modelIndex >= 0, true);
  assert.equal(effortIndex >= 0, true);
  assert.equal(argv[modelIndex + 1], "fable");
  assert.equal(argv[effortIndex + 1], "high");
});

// Profile effort tiers are quirks judgment tiers; the claude CLI (verified
// against 2.1.218) accepts only low|medium|high|xhigh|max, so verbatim
// mechanical/standard/principal would be rejected at spawn.
const effortCases = [
  ["mechanical", "low"],
  ["standard", "medium"],
  ["high", "high"],
  ["principal", "xhigh"],
  ["low", "low"],
  ["medium", "medium"],
  ["xhigh", "xhigh"],
  ["max", "max"],
] as const;

test("claudeEffort maps profile tiers onto claude CLI effort values and passes native values through", () => {
  for (const [effort, expected] of effortCases) {
    assert.equal(claudeEffort(effort), expected, `claudeEffort(${effort})`);
  }
});

test("claude fresh argv maps profile effort tiers onto claude CLI effort values", () => {
  for (const [effort, expected] of effortCases) {
    const argv = buildClaudeArgv({ ...baseInput, effort });
    assert.equal(argv[argv.indexOf("--effort") + 1], expected, `fresh --effort for ${effort}`);
  }
});

test("claude resume argv maps profile effort tiers onto claude CLI effort values", () => {
  for (const [effort, expected] of effortCases) {
    const argv = buildClaudeResumeArgv(baseInput.sessionId, { ...baseInput, effort });
    assert.equal(argv[argv.indexOf("--effort") + 1], expected, `resume --effort for ${effort}`);
  }
});

test("claude argv passes brief as a file path only", () => {
  const argv = buildClaudeArgv({
    ...baseInput,
    briefPath: "artifacts/job-1/brief.md",
  });
  assert.equal(argv.at(-1), "artifacts/job-1/brief.md");
  assert.equal(argv.includes("Implement the task now."), false);
  assert.equal(argv.includes("# Task brief"), false);
});

test("buildClaudeEnv sets CLAUDE_CONFIG_DIR only when configDir is provided", () => {
  assert.equal(buildClaudeEnv({}), undefined);
  assert.deepEqual(buildClaudeEnv({ configDir: "/home/user/.claude-work" }), {
    CLAUDE_CONFIG_DIR: "/home/user/.claude-work",
  });
});

test("buildClaudeResumeArgv reuses model effort and workspace posture", () => {
  const argv = buildClaudeResumeArgv("11111111-1111-4111-8111-111111111111", baseInput);
  assert.equal(argv[0], "/usr/bin/claude");
  assert.equal(argv.includes("-p"), true);
  assert.equal(argv.includes("--resume"), true);
  assert.equal(argv.includes("--model"), true);
  assert.equal(argv.includes("--effort"), true);
  assert.equal(argv.includes("--add-dir"), true);
  assert.equal(argv.includes("/tmp/worktree"), true);
  assert.equal(argv.includes("fable"), true);
  assert.equal(argv.includes("high"), true);
  assert.equal(argv.includes("--session-id"), false);
  assert.equal(argv.includes("--dangerously-skip-permissions"), false);
});

test("parseClaudeResult succeeds with structured non-error result and artifact evidence", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-claude-artifacts-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, '{"status":"ok"}\n', "utf8");

  const stdout = [
    '{"type":"system","subtype":"init","session_id":"11111111-1111-4111-8111-111111111111"}',
    '{"type":"result","subtype":"success","session_id":"11111111-1111-4111-8111-111111111111","is_error":false,"result":"Done."}',
  ].join("\n");

  const parsed = parseClaudeResult(stdout, {
    exitCode: 0,
    artifactPaths: [resultPath],
    sessionId: "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(parsed.status, "success");
  assert.equal(parsed.sessionHandle, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(parsed.artifactPaths, [resultPath]);
  assert.equal(parsed.failure, undefined);
});

test("parseClaudeResult does not treat prose done as success without structured evidence", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-claude-artifacts-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, '{"status":"ok"}\n', "utf8");

  const parsed = parseClaudeResult("All done. Task complete.\n", {
    exitCode: 0,
    artifactPaths: [resultPath],
    sessionId: "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(parsed.status, "failure");
  assert.match(parsed.failure?.message ?? "", /structured terminal result/i);
});

test("parseClaudeResult rejects permission denials even when exit code is zero", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-claude-artifacts-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, '{"status":"ok"}\n', "utf8");

  const stdout = [
    '{"type":"result","subtype":"success","session_id":"11111111-1111-4111-8111-111111111111","is_error":false,"result":"Done.","permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_1","tool_input":{}}]}',
  ].join("\n");

  const parsed = parseClaudeResult(stdout, {
    exitCode: 0,
    artifactPaths: [resultPath],
    sessionId: "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(parsed.status, "permission_denied");
  assert.equal(parsed.failure?.code, "permission_denied");
});

test("parseClaudeResult requires on-disk artifact evidence", () => {
  const stdout = [
    '{"type":"result","subtype":"success","session_id":"11111111-1111-4111-8111-111111111111","is_error":false,"result":"Done."}',
  ].join("\n");

  const parsed = parseClaudeResult(stdout, {
    exitCode: 0,
    artifactPaths: ["/tmp/does-not-exist/result.json"],
    sessionId: "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(parsed.status, "failure");
  assert.match(parsed.failure?.message ?? "", /artifact/i);
});

test("parseClaudeResult classifies structured error results as failure", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-claude-artifacts-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, '{"status":"ok"}\n', "utf8");

  const stdout = [
    '{"type":"result","subtype":"error","session_id":"11111111-1111-4111-8111-111111111111","is_error":true,"result":"model overloaded"}',
  ].join("\n");

  const parsed = parseClaudeResult(stdout, {
    exitCode: 0,
    artifactPaths: [resultPath],
    sessionId: "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failure?.code, "runner_error");
});
