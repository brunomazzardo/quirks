import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCodexResumeArgv } from "../../src/runner/codex.js";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";
import { transcriptPath } from "../../src/runner/result-contract.js";
import type { RunnerProfile } from "../../src/runner/types.js";
import { StubInterpreter } from "./support/stub-interpreter.js";

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

async function dispatchFakeClaude(mode: string, timeoutMs = 5_000, interpreter = new StubInterpreter()) {
  const artifactDir = await makeTempArtifactDir();
  const result = await dispatchRunnerJob({
    jobId: "job-1",
    profile: fakeProfile,
    argv: fakeClaudeArgv(mode),
    artifactDir,
    timeoutMs,
    interpreter,
  });
  return { result, interpreter, artifactDir };
}

test("dispatch spawns argv directly without a shell and normalizes the interpreted result", async () => {
  const { result } = await dispatchFakeClaude("success");
  assert.equal(result.status, "success");
  assert.equal(result.runner, "fake-claude");
  assert.equal(result.runnerType, "claude");
  assert.equal(result.resolvedModel, "test-model");
  assert.equal(result.effort, "standard");
  assert.equal(result.failure, undefined);
});

test("the launcher reports the session id it generated as a fact", async () => {
  const { interpreter } = await dispatchFakeClaude("success");
  assert.equal(interpreter.facts[0]?.sessionId, SESSION_ID);
});

test("dispatch classifies hung runners as timeout without interpreting anything", async () => {
  const { result, interpreter } = await dispatchFakeClaude("timeout", 300);
  assert.equal(result.status, "timeout");
  assert.equal(interpreter.facts.length, 0);
});

test("dispatch refuses argv without an executable", async () => {
  const result = await dispatchRunnerJob({
    jobId: "job-empty",
    profile: fakeProfile,
    argv: [],
    artifactDir: await makeTempArtifactDir(),
    timeoutMs: 1_000,
    interpreter: new StubInterpreter(),
  });
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "invalid_argv");
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

test("dispatch executes codex resume argv and interprets what it produced", async () => {
  const executable = await executableFakeCodex();
  const artifactDir = await makeTempArtifactDir();
  const argv = buildCodexResumeArgv({
    executable,
    workspace: artifactDir,
    sessionHandle: "codex-session-abc",
    briefPath: path.join(artifactDir, "brief.md"),
    capabilities: ["repository-read", "repository-write"],
    effort: "standard",
  });

  const interpreter = new StubInterpreter();
  const result = await dispatchRunnerJob({
    jobId: "job-codex-resume",
    profile: codexProfile,
    argv,
    artifactDir,
    timeoutMs: 5_000,
    interpreter,
  });

  assert.equal(result.status, "success");
  // A resume must not reimpose a result contract: the flags that suppressed
  // codex's reasoning are gone from the resume path too.
  assert.equal(argv.includes("--output-schema"), false);
  assert.equal(argv.includes("-o"), false);
  assert.equal(interpreter.facts.length, 1);
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
    interpreter: new StubInterpreter(),
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

test("the worktree the launcher bound is a fact the interpreter is told", async () => {
  const artifactDir = await makeTempArtifactDir();
  const worktree = await mkdtemp(path.join(os.tmpdir(), "quirks-runner-worktree-"));
  const interpreter = new StubInterpreter();
  await dispatchRunnerJob({
    jobId: "job-facts-cwd",
    profile: fakeProfile,
    argv: fakeClaudeArgv("success"),
    artifactDir,
    cwd: worktree,
    timeoutMs: 5_000,
    interpreter,
  });
  assert.equal(interpreter.facts[0]?.worktreePath, worktree);
});

/**
 * A resume reuses the job id, and the transcript path is derived from it. The
 * first version of this overwrote the earlier attempt's transcript, quietly
 * destroying the evidence a verdict had been derived from — while the whole
 * design rests on "the raw transcript is always retained, so any interpretation
 * can be audited after the fact".
 */
test("a second run under the same job id keeps the first transcript rather than overwriting it", async () => {
  const artifactDir = await makeTempArtifactDir();
  const first = path.join(artifactDir, "first.mjs");
  const second = path.join(artifactDir, "second.mjs");
  await writeFile(first, 'process.stdout.write("FIRST ATTEMPT SAID THIS\\n");\n', "utf8");
  await writeFile(second, 'process.stdout.write("SECOND ATTEMPT SAID THIS\\n");\n', "utf8");

  const one = await dispatchRunnerJob({
    jobId: "job-resumed",
    profile: fakeProfile,
    argv: [process.execPath, first],
    artifactDir,
    timeoutMs: 5_000,
    interpreter: new StubInterpreter(),
  });
  const two = await dispatchRunnerJob({
    jobId: "job-resumed",
    profile: fakeProfile,
    argv: [process.execPath, second],
    artifactDir,
    timeoutMs: 5_000,
    interpreter: new StubInterpreter(),
  });

  const firstPath = one.artifactPaths.find((entry) => entry.includes("transcript-"))!;
  const secondPath = two.artifactPaths.find((entry) => entry.includes("transcript-"))!;
  assert.notEqual(firstPath, secondPath, "the second attempt must not claim the first attempt's file");
  assert.match(await readFile(firstPath, "utf8"), /FIRST ATTEMPT SAID THIS/);
  assert.match(await readFile(secondPath, "utf8"), /SECOND ATTEMPT SAID THIS/);
});
