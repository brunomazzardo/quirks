import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CliRunnerPort } from "../../src/runner/cli-runner-port.js";
import type { RunnerProfile } from "../../src/runner/types.js";
import { StubInterpreter } from "./support/stub-interpreter.js";

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
  role: "implementer" | "reviewer" = "implementer",
  interpreter = new StubInterpreter(),
) {
  const executable = await executableFakeRunner(scriptName);
  const profiles = new Map([
    [runnerType, profile(runnerType, runnerType, executable)],
  ]);
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-artifacts-"));
  const briefPath = path.join(artifactRoot, "brief.md");
  // A plain brief: no envelope contract is stated for any runner any more.
  await writeFile(briefPath, "# brief\n", "utf8");
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-worktree-"));

  const port = new CliRunnerPort(profiles, interpreter);
  const result = await port.dispatch({
    jobId: `job-${runnerType}`,
    taskId: "QK-1",
    role,
    route: {
      profileId: runnerType,
      runnerType,
      tier: "standard",
      effort: "standard",
      quotaPoolId: "pool",
    },
    briefPath,
    worktreePath,
  });
  return { result, interpreter, artifactRoot, worktreePath };
}

test("CliRunnerPort dispatches claude through the production argv builder", async () => {
  const { result, interpreter } = await dispatchFixture("claude", "fake-claude.mjs");
  assert.equal(result.status, "success");
  assert.equal(interpreter.facts[0]?.runnerType, "claude");
  assert.match(interpreter.facts[0]?.sessionId ?? "", /^[0-9a-f-]{36}$/);
});

test("CliRunnerPort dispatches codex and passes the brief contents as the prompt positional", async () => {
  const executable = await executableFakeRunner("fake-codex.mjs");
  const profiles = new Map([["codex", profile("codex", "codex", executable)]]);
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-codex-brief-"));
  const briefPath = path.join(artifactRoot, "brief.md");
  const briefContents = "---\ntitle: codex brief\n---\nDo the codex thing.\n";
  await writeFile(briefPath, briefContents, "utf8");
  const worktreePath = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-codex-worktree-"));

  const port = new CliRunnerPort(profiles, new StubInterpreter());
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
  // The result-shape flags are gone from the real dispatch path, not just from
  // the argv unit test.
  assert.equal(captured.includes("--output-schema"), false);
  assert.equal(captured.includes("-o"), false);
});

test("CliRunnerPort dispatches cursor", async () => {
  const { result, interpreter } = await dispatchFixture("cursor", "fake-cursor.mjs");
  assert.equal(result.status, "success");
  assert.equal(interpreter.facts[0]?.runnerType, "cursor");
});

/**
 * The role decides whether a verdict is asked for at all. Dropping it here read
 * every reviewer as an implementer, which silently discards its judgment — the
 * fail-open this boundary exists to prevent.
 */
test("CliRunnerPort passes the job role through to interpretation", async () => {
  const { interpreter } = await dispatchFixture("claude", "fake-claude.mjs", "reviewer");
  assert.equal(interpreter.facts[0]?.role, "reviewer");
});

test("CliRunnerPort binds the child to the job's worktree", async () => {
  const { interpreter, worktreePath } = await dispatchFixture("claude", "fake-claude.mjs");
  assert.equal(interpreter.facts[0]?.worktreePath, worktreePath);
});

test("CliRunnerPort rejects unknown profile ids", async () => {
  const port = new CliRunnerPort(new Map(), new StubInterpreter());
  const briefPath = path.join(await mkdtemp(path.join(os.tmpdir(), "quirks-cli-runner-brief-")), "brief.md");
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
