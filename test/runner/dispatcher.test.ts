import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claudeResultPath } from "../../src/runner/claude.js";
import { buildCodexResumeArgv } from "../../src/runner/codex.js";
import { cursorResultContractSection } from "../../src/runner/cursor.js";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";
import { transcriptPath } from "../../src/runner/result-contract.js";
import type { RunnerProfile } from "../../src/runner/types.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const fakeProfile: RunnerProfile = {
  schemaVersion: 1,
  profileId: "fake-claude",
  runnerType: "claude",
  executable: process.execPath,
  accountAlias: "default",
  quotaPoolId: "pool",
  tier: "standard",
  model: "test-model",
  effort: "standard",
  capabilities: ["repository-read"],
  wallClockMs: 5_000,
  redactionRules: [],
};

async function makeTempArtifactDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "quirks-runner-artifacts-"));
}

function fakeClaudeArgv(mode: string, briefPath: string): readonly string[] {
  return [
    process.execPath,
    path.resolve("test/fixtures/fake-runners/fake-claude.mjs"),
    // Production passes the brief as the positional prompt; the fake reads its
    // declared envelope path out of that brief, exactly as a real job does.
    briefPath,
    "--session-id",
    SESSION_ID,
    "--mode",
    mode,
  ];
}

/** Brief stating the job-unique envelope path, as the supervisor now does. */
async function briefDeclaring(artifactDir: string, jobId: string): Promise<string> {
  const briefPath = path.join(artifactDir, "brief.md");
  await writeFile(
    briefPath,
    `# brief\n\n${cursorResultContractSection(claudeResultPath(artifactDir, jobId))}\n`,
    "utf8",
  );
  return briefPath;
}

async function dispatchFakeClaude(mode: string, timeoutMs = 5_000) {
  const artifactDir = await makeTempArtifactDir();
  return dispatchRunnerJob({
    jobId: "job-1",
    profile: fakeProfile,
    argv: fakeClaudeArgv(mode, await briefDeclaring(artifactDir, "job-1")),
    artifactDir,
    timeoutMs,
  });
}

test("dispatch spawns argv directly without a shell and normalizes success", async () => {
  const result = await dispatchFakeClaude("success");
  assert.equal(result.status, "success");
  assert.match(result.sessionHandle, /./);
  assert.equal(result.sessionHandle, SESSION_ID);
  assert.equal(result.runner, "fake-claude");
  assert.equal(result.runnerType, "claude");
  assert.equal(result.resolvedModel, "test-model");
  assert.equal(result.effort, "standard");
  assert.equal(result.artifactPaths.length > 0, true);
  assert.equal(result.failure, undefined);
});

test("dispatch classifies exit-zero permission denial as permission_denied", async () => {
  const result = await dispatchFakeClaude("exit-zero-denied");
  assert.equal(result.status, "permission_denied");
  assert.equal(result.failure?.code, "permission_denied");
});

test("dispatch rejects malformed output without treating prose done as success", async () => {
  const result = await dispatchFakeClaude("malformed");
  assert.notEqual(result.status, "success");
  assert.equal(result.status, "failure");
});

test("dispatch classifies hung runners as timeout", async () => {
  const result = await dispatchFakeClaude("timeout", 300);
  assert.equal(result.status, "timeout");
});

const codexProfile: RunnerProfile = {
  ...fakeProfile,
  profileId: "fake-codex",
  runnerType: "codex",
};

async function executableFakeCodex(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "quirks-dispatcher-codex-"));
  const fixtureDir = path.resolve("test/fixtures/fake-runners");
  await cp(path.join(fixtureDir, "shared-modes.mjs"), path.join(tempDir, "shared-modes.mjs"));
  const original = await readFile(path.join(fixtureDir, "fake-codex.mjs"), "utf8");
  const target = path.join(tempDir, "fake-codex.mjs");
  await writeFile(target, `#!/usr/bin/env node\n${original}`, "utf8");
  await chmod(target, 0o755);
  return target;
}

test("dispatch executes codex resume argv against the declared result path", async () => {
  const executable = await executableFakeCodex();
  const artifactDir = await makeTempArtifactDir();
  const argv = buildCodexResumeArgv({
    executable,
    workspace: artifactDir,
    sessionHandle: "codex-session-abc",
    briefPath: path.join(artifactDir, "brief.md"),
    resultPath: path.join(artifactDir, "codex-result.json"),
    schemaPath: "schemas/codex-result.schema.json",
    capabilities: ["repository-read", "repository-write"],
    effort: "standard",
  });

  const result = await dispatchRunnerJob({
    jobId: "job-codex-resume",
    profile: codexProfile,
    argv,
    artifactDir,
    timeoutMs: 5_000,
  });

  assert.notEqual(result.failure?.code, "missing_result_path");
  assert.equal(result.status, "success");
  assert.equal(result.artifactPaths.length > 0, true);
});

test("dispatch prefers the codex --json session handle and notes envelope disagreement", async () => {
  const executable = await executableFakeCodex();
  const artifactDir = await makeTempArtifactDir();
  const resultPath = path.join(artifactDir, "codex-result.json");

  const result = await dispatchRunnerJob({
    jobId: "job-codex-mismatch",
    profile: codexProfile,
    argv: [executable, "-o", resultPath, "--mode", "session-mismatch"],
    artifactDir,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "success");
  assert.equal(result.sessionHandle, "jsonl-session-999");
  assert.deepEqual(result.notes, ["session_handle_mismatch"]);
});

/**
 * Claude has no workspace flag: codex binds with -C and cursor with --workspace,
 * but claude relies entirely on the process working directory. The dispatcher
 * never set one, so a claude implementer ran in the supervisor's checkout rather
 * than its isolated task worktree — editing the wrong tree while the prepared
 * worktree stayed clean. Probes missed it because they set cwd themselves.
 * Raised by the independent codex review of 45901c8.
 */
test("dispatch runs the child in the job's worktree so claude is bound to it", async () => {
  const artifactDir = await makeTempArtifactDir();
  const worktree = await mkdtemp(path.join(os.tmpdir(), "quirks-runner-worktree-"));
  const probe = path.join(artifactDir, "probe-cwd.mjs");
  await writeFile(probe, "process.stdout.write(JSON.stringify({ cwd: process.cwd() }));\n", "utf8");

  const result = await dispatchRunnerJob({
    jobId: "job-cwd",
    profile: fakeProfile,
    argv: [process.execPath, probe],
    artifactDir,
    cwd: worktree,
    timeoutMs: 5_000,
  });

  const transcript = await readFile(transcriptPath(artifactDir, "job-cwd"), "utf8");
  const reported = JSON.parse(transcript) as { cwd: string };
  assert.equal(
    await realpath(reported.cwd),
    await realpath(worktree),
    "the runner must start inside its own worktree",
  );
  assert.ok(result.jobId === "job-cwd");
});

/**
 * Result paths are deterministic per job, so a retry, a resume, or a rerun finds
 * the previous attempt's envelope still on disk. The parsers prefer any valid
 * envelope over the current invocation's error output, so a failing run was
 * reported as the earlier success. Codex demonstrated it by pairing a current
 * turn.failed event with an older accepting envelope; both codex and cursor
 * returned success. The invocation must own its result file.
 */
test("a stale result envelope from a previous attempt cannot make a failed run succeed", async () => {
  const artifactDir = await makeTempArtifactDir();
  const resultPath = path.join(artifactDir, "codex-result.json");
  // An older, accepting envelope left behind by a previous attempt.
  await writeFile(
    resultPath,
    JSON.stringify({
      status: "success",
      verdict: "accept",
      sessionHandle: "stale-session",
      artifactPaths: [resultPath],
      failure: null,
    }),
    "utf8",
  );

  // This invocation fails without writing any envelope of its own.
  const failing = path.join(artifactDir, "failing-codex.mjs");
  await writeFile(failing, "process.exitCode = 1;\n", "utf8");

  const result = await dispatchRunnerJob({
    jobId: "job-stale",
    profile: codexProfile,
    argv: [process.execPath, failing, "-o", resultPath],
    artifactDir,
    timeoutMs: 5_000,
  });

  assert.notEqual(result.status, "success", "a failed invocation must not inherit an old envelope");
  assert.notEqual(result.verdict, "accept", "a stale accept must never be reused");
});
