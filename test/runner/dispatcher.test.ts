import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCodexResumeArgv } from "../../src/runner/codex.js";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";
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

function fakeClaudeArgv(mode: string): readonly string[] {
  return [
    process.execPath,
    path.resolve("test/fixtures/fake-runners/fake-claude.mjs"),
    "--session-id",
    SESSION_ID,
    "--mode",
    mode,
  ];
}

async function dispatchFakeClaude(mode: string, timeoutMs = 5_000) {
  return dispatchRunnerJob({
    jobId: "job-1",
    profile: fakeProfile,
    argv: fakeClaudeArgv(mode),
    artifactDir: await makeTempArtifactDir(),
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
