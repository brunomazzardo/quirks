import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyFailure } from "../../src/campaign/failures.js";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";
import type { RunnerProfile } from "../../src/runner/types.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const modes = [
  "success",
  "success-no-disk",
  "permission-exit-zero",
  "partial",
  "malformed",
  "oversized",
  "transient",
  "usage-limit",
  "silence",
  "wedge-after-work",
  "non-resumable",
  "fabricated-tests",
] as const;

const runners = [
  { name: "claude", runnerType: "claude" as const, script: "fake-claude.mjs", buildArgv: claudeArgv },
  { name: "codex", runnerType: "codex" as const, script: "fake-codex.mjs", buildArgv: codexArgv },
  { name: "cursor", runnerType: "cursor" as const, script: "fake-cursor.mjs", buildArgv: cursorArgv },
];

function profile(runnerType: RunnerProfile["runnerType"], profileId: string): RunnerProfile {
  return {
    schemaVersion: 1,
    profileId,
    runnerType,
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
}

function claudeArgv(script: string, mode: string): readonly string[] {
  return [
    process.execPath,
    path.resolve("test/fixtures/fake-runners", script),
    "--session-id",
    SESSION_ID,
    "--mode",
    mode,
  ];
}

async function codexArgv(script: string, mode: string): Promise<readonly string[]> {
  const resultPath = path.join(await mkdtemp(path.join(os.tmpdir(), "quirks-codex-result-")), "result.json");
  return [
    process.execPath,
    path.resolve("test/fixtures/fake-runners", script),
    "-o",
    resultPath,
    "--session-id",
    SESSION_ID,
    "--mode",
    mode,
  ];
}

function cursorArgv(script: string, mode: string): readonly string[] {
  return claudeArgv(script, mode);
}

async function makeTempArtifactDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "quirks-runner-artifacts-"));
}

function timeoutForMode(mode: (typeof modes)[number]): number {
  if (mode === "silence" || mode === "wedge-after-work") return 300;
  if (mode === "oversized") return 2_000;
  return 5_000;
}

for (const runner of runners) {
  for (const mode of modes) {
    test(`fake ${runner.name} handles mode ${mode} deterministically`, async () => {
      const argv = runner.runnerType === "codex"
        ? await runner.buildArgv(runner.script, mode)
        : runner.buildArgv(runner.script, mode);
      const result = await dispatchRunnerJob({
        jobId: `job-${runner.name}-${mode}`,
        profile: profile(runner.runnerType, `fake-${runner.name}`),
        argv,
        artifactDir: await makeTempArtifactDir(),
        timeoutMs: timeoutForMode(mode),
      });
      const failureClass = classifyFailure(result);
      assert.equal(typeof failureClass, "string");
    });
  }
}

test("fake host emits durable start and attach events", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const script = path.resolve("test/fixtures/fake-hosts/fake-host.mjs");

  const started = await execFileAsync(process.execPath, [script, "--mode", "foreground-complete", "--campaign", "cmp-1"]);
  assert.match(started.stdout, /host\.started/);
  assert.match(started.stdout, /host\.completed/);

  const attach = await execFileAsync(process.execPath, [script, "--mode", "attach", "--campaign", "cmp-1"]);
  assert.match(attach.stdout, /host\.attached/);
});
