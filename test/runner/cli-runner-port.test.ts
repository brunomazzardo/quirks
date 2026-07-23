import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CliRunnerPort } from "../../src/runner/cli-runner-port.js";
import { cursorResultContractSection, cursorResultPath } from "../../src/runner/cursor.js";
import type { RunnerProfile } from "../../src/runner/types.js";

async function executableFakeRunner(scriptName: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-"));
  const fixtureDir = path.resolve("test/fixtures/fake-runners");
  await cp(path.join(fixtureDir, "shared-modes.mjs"), path.join(tempDir, "shared-modes.mjs"));
  const source = path.join(fixtureDir, scriptName);
  const target = path.join(tempDir, scriptName);
  const original = await readFile(source, "utf8");
  await writeFile(target, `#!/usr/bin/env node\n${original}`, "utf8");
  await chmod(target, 0o755);
  return target;
}

function profile(
  runnerType: RunnerProfile["runnerType"],
  profileId: string,
  executable: string,
  tier: RunnerProfile["tier"] = "standard",
): RunnerProfile {
  return {
    schemaVersion: 1,
    profileId,
    runnerType,
    executable,
    accountAlias: "default",
    quotaPoolId: "pool",
    tier,
    model: "test-model",
    effort: tier,
    capabilities: ["repository-read", "repository-write"],
    wallClockMs: 5_000,
    redactionRules: [],
  };
}

async function dispatchFixture(
  runnerType: RunnerProfile["runnerType"],
  scriptName: string,
  tier: RunnerProfile["tier"] = "standard",
) {
  const executable = await executableFakeRunner(scriptName);
  const profiles = new Map([
    [runnerType, profile(runnerType, runnerType, executable, tier)],
  ]);
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-artifacts-"));
  const briefPath = path.join(artifactRoot, "brief.md");
  await writeFile(briefPath, "# brief\n", "utf8");
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-worktree-"));

  const port = new CliRunnerPort(profiles);
  return port.dispatch({
    jobId: `job-${runnerType}`,
    taskId: "QK-1",
    role: "implementer",
    route: {
      profileId: runnerType,
      runnerType,
      tier,
      effort: tier,
      quotaPoolId: "pool",
    },
    briefPath,
    worktreePath,
  });
}

test("CliRunnerPort dispatches claude through argv builder and requires artifact evidence", async () => {
  const result = await dispatchFixture("claude", "fake-claude.mjs");
  assert.equal(result.status, "success");
  assert.match(result.sessionHandle, /^[0-9a-f-]{36}$/);
  assert.equal(result.artifactPaths.length > 0, true);
});

test("CliRunnerPort dispatches codex through declared result artifact path", async () => {
  const result = await dispatchFixture("codex", "fake-codex.mjs");
  assert.equal(result.status, "success");
  assert.match(result.sessionHandle, /./);
  assert.equal(result.artifactPaths.length > 0, true);
});

test("CliRunnerPort passes the brief contents through to the codex prompt positional", async () => {
  const executable = await executableFakeRunner("fake-codex.mjs");
  const profiles = new Map([["codex", profile("codex", "codex", executable)]]);
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-codex-brief-"));
  const briefPath = path.join(artifactRoot, "brief.md");
  const briefContents = "---\ntitle: codex brief\n---\nDo the codex thing.\n";
  await writeFile(briefPath, briefContents, "utf8");
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-codex-worktree-"));

  const port = new CliRunnerPort(profiles);
  const result = await port.dispatch({
    jobId: "job-codex-brief",
    taskId: "QK-1",
    role: "implementer",
    route: {
      profileId: "codex",
      runnerType: "codex",
      tier: "standard",
      effort: "standard",
      quotaPoolId: "pool",
    },
    briefPath,
    worktreePath,
  });

  assert.equal(result.status, "success");
  const captured = JSON.parse(
    await readFile(path.join(artifactRoot, "codex-argv.json"), "utf8"),
  ) as string[];
  const promptIndex = captured.indexOf(briefContents);
  assert.notEqual(promptIndex, -1);
  assert.equal(captured[promptIndex - 1], "--");
});

// QK-RUN-005 acceptance: a cursor job that follows the brief's result
// contract passes validation; the brief-declared path is the job-unique one.
test("CliRunnerPort dispatches cursor and validates the brief-declared result envelope", async () => {
  const executable = await executableFakeRunner("fake-cursor.mjs");
  const profiles = new Map([["cursor", profile("cursor", "cursor", executable)]]);
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-cursor-"));
  const briefPath = path.join(artifactRoot, "brief.md");
  const resultPath = cursorResultPath(artifactRoot, "job-cursor");
  await writeFile(briefPath, `# brief\n\n${cursorResultContractSection(resultPath)}\n`, "utf8");
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-cursor-worktree-"));

  const port = new CliRunnerPort(profiles);
  const result = await port.dispatch({
    jobId: "job-cursor",
    taskId: "QK-1",
    role: "implementer",
    route: {
      profileId: "cursor",
      runnerType: "cursor",
      tier: "standard",
      effort: "standard",
      quotaPoolId: "pool",
    },
    briefPath,
    worktreePath,
  });

  assert.equal(result.status, "success");
  assert.match(result.sessionHandle, /./);
  assert.ok(result.artifactPaths.includes(resultPath), "result must report the declared envelope path");
});

test("CliRunnerPort fails a cursor job that never writes the declared envelope, naming the path", async () => {
  const result = await dispatchFixture("cursor", "fake-cursor.mjs");
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "missing_structured_result");
  assert.match(result.failure?.message ?? "", /cursor-result-job-cursor\.json/);
});

test("CliRunnerPort rejects unknown profile ids", async () => {
  const port = new CliRunnerPort(new Map());
  const briefPath = path.join(await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-brief-")), "brief.md");
  await mkdir(path.dirname(briefPath), { recursive: true });
  await writeFile(briefPath, "# brief\n", "utf8");
  await assert.rejects(
    () => port.dispatch({
      jobId: "job-missing",
      taskId: "QK-1",
      role: "implementer",
      route: {
        profileId: "missing",
        runnerType: "claude",
        tier: "standard",
        effort: "standard",
        quotaPoolId: "pool",
      },
      briefPath,
      worktreePath: "/tmp/worktree",
    }),
    /Unknown runner profile missing/,
  );
});
