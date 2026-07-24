import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { artifactPathsForRunner } from "../../src/runner/cli-runner-port.js";
import {
  buildClaudeArgv,
  buildClaudeEnv,
  buildClaudeResumeArgv,
  claudeEffort,
  claudeResultPath,
  parseClaudeResult,
} from "../../src/runner/claude.js";
import type { RunnerProfile } from "../../src/runner/types.js";

const baseInput = {
  executable: "/usr/bin/claude",
  sessionId: "11111111-1111-4111-8111-111111111111",
  model: "fable",
  effort: "high",
  briefPath: "artifacts/job-1/brief.md",
  workspace: "/tmp/worktree",
  artifactDir: "artifacts/job-1",
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
  assert.equal(argv.includes("artifacts/job-1/brief.md"), true);
  assert.equal(argv.includes("Implement the task now."), false);
  assert.equal(argv.includes("# Task brief"), false);
});

/**
 * Flags the claude CLI accepts as variadic. A variadic flag immediately before
 * the positional prompt absorbs it as another value, leaving no prompt.
 */
const VARIADIC_FLAGS = ["--add-dir", "--allowedTools", "--disallowedTools"] as const;

// Real-CLI probe 2026-07-24: with the brief appended last, `--add-dir
// <workspace> <briefPath>` consumed the brief as a second directory and the CLI
// exited 1 with "Input must be provided either through stdin or as a prompt
// argument when using --print". Write-capable profiles escaped only because
// --dangerously-skip-permissions happened to terminate the variadic list, so
// every read-only reviewer profile was broken while implementers worked by
// luck. Confirmed again with --allowedTools, so the hazard is the variadic
// class, not one flag. See docs/smoke/2026-07-24-runner-boundary-probe.md.
test("claude argv places the brief positional ahead of every variadic flag so it cannot be swallowed", () => {
  for (const allowPermissionBypass of [false, true]) {
    const argv = buildClaudeArgv({ ...baseInput, allowPermissionBypass });
    const briefIndex = argv.indexOf(baseInput.briefPath);
    assert.ok(briefIndex > 0, `brief positional must be present (bypass=${allowPermissionBypass})`);
    for (const flag of VARIADIC_FLAGS) {
      const flagIndex = argv.indexOf(flag);
      if (flagIndex === -1) continue;
      assert.ok(
        briefIndex < flagIndex,
        `${flag} at ${flagIndex} must follow the brief positional at ${briefIndex} (bypass=${allowPermissionBypass})`,
      );
    }
  }
});

// The personal account passed only because ~/.claude/settings.json sets
// "verbose": true; the work account has no such key and exited 1 with
// "--output-format=stream-json requires --verbose".
test("claude argv passes --verbose explicitly with stream-json rather than relying on local settings", () => {
  for (const argv of [
    buildClaudeArgv(baseInput),
    buildClaudeResumeArgv(baseInput.sessionId, baseInput),
  ]) {
    assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json");
    assert.equal(argv.includes("--verbose"), true);
  }
});

// The brief and the result envelope both live in artifactDir, outside the
// workspace, so a reviewer can neither read its brief nor write its envelope
// without the directory being granted.
test("claude argv grants the artifact dir alongside the workspace", () => {
  for (const argv of [
    buildClaudeArgv(baseInput),
    buildClaudeResumeArgv(baseInput.sessionId, baseInput),
  ]) {
    // --add-dir is variadic: collect every value until the next flag.
    const start = argv.indexOf("--add-dir");
    assert.ok(start >= 0, "--add-dir must be present");
    const granted: string[] = [];
    for (const entry of argv.slice(start + 1)) {
      if (entry.startsWith("-")) break;
      granted.push(entry);
    }
    assert.ok(granted.includes("/tmp/worktree"), "workspace must be granted");
    assert.ok(granted.includes("artifacts/job-1"), "artifact dir must be granted");
  }
});

// Mirrors codexResultPath and cursorResultPath, both already fixed for this:
// claude wrote a single shared artifactDir/result.json, so concurrent roles and
// attempts could clobber (or inherit) another job's envelope. The failed
// cmp-uimotion-1 campaign left exactly one shared .quirks/briefs/result.json.
test("claudeResultPath is unique per job so concurrent claude jobs never clobber each other", () => {
  const first = claudeResultPath("/tmp/artifacts", "job-1");
  const second = claudeResultPath("/tmp/artifacts", "job-2");

  assert.notEqual(first, second);
  assert.match(first, /job-1/);
  assert.match(second, /job-2/);
});

test("claudeResultPath sanitizes campaign-style job ids into a plain file name", () => {
  const resultPath = claudeResultPath("/tmp/artifacts", "cmp-1:QK-1:reviewer:2");
  assert.equal(path.dirname(resultPath), "/tmp/artifacts");
  assert.doesNotMatch(path.basename(resultPath), /[:/\\]/);
  assert.notEqual(resultPath, claudeResultPath("/tmp/artifacts", "cmp-1:QK-1:implementer:2"));
});

test("artifactPathsForRunner declares the job-unique claude result path", () => {
  const profile: RunnerProfile = {
    schemaVersion: 1,
    profileId: "claude-standard",
    runnerType: "claude",
    executable: "/usr/bin/claude",
    accountAlias: "default",
    quotaPoolId: "pool",
    tier: "standard",
    model: "sonnet",
    effort: "standard",
    capabilities: ["repository-read"],
    wallClockMs: 5_000,
    redactionRules: [],
  };

  const first = artifactPathsForRunner(profile, "/tmp/artifacts", "job-1");
  const second = artifactPathsForRunner(profile, "/tmp/artifacts", "job-2");
  assert.deepEqual(first, [claudeResultPath("/tmp/artifacts", "job-1")]);
  assert.notDeepEqual(first, second);
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
