import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyFailure } from "../../src/campaign/failures.js";
import { cursorPromptText, cursorResultContractSection } from "../../src/runner/cursor.js";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";
import { resultContractPath } from "../../src/runner/result-contract.js";
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

function profile(
  runnerType: RunnerProfile["runnerType"],
  profileId: string,
  capabilities: readonly string[] = ["repository-read"],
): RunnerProfile {
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
    capabilities: [...capabilities],
    wallClockMs: 5_000,
    redactionRules: [],
  };
}

async function briefDeclaring(
  runnerType: RunnerProfile["runnerType"],
  artifactDir: string,
  jobId: string,
): Promise<string> {
  const briefPath = path.join(artifactDir, "brief.md");
  const declared = resultContractPath(runnerType, artifactDir, jobId);
  await writeFile(
    briefPath,
    declared === undefined ? "# brief\n" : `# brief\n\n${cursorResultContractSection(declared)}\n`,
    "utf8",
  );
  return briefPath;
}

function claudeArgv(script: string, mode: string, briefPath: string): readonly string[] {
  return [
    process.execPath,
    path.resolve("test/fixtures/fake-runners", script),
    // Production passes the brief as the positional prompt; without it these
    // fakes cannot learn their envelope path, exactly as a real job could not.
    briefPath,
    "--session-id",
    SESSION_ID,
    "--mode",
    mode,
  ];
}

function codexArgv(script: string, mode: string, resultPath: string): readonly string[] {
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

function cursorArgv(script: string, mode: string, briefPath: string): readonly string[] {
  // Production wraps the brief path in an instruction; a bare path is not what a
  // real cursor job receives, and the fake parses the instruction exactly as the
  // real agent would read it.
  return claudeArgv(script, mode, cursorPromptText(briefPath));
}

async function makeTempArtifactDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "quirks-runner-artifacts-"));
}

/**
 * What each mode means, independent of how any runner happens to implement it.
 * "not-success" is used where runners legitimately differ in which non-success
 * status they report, but never in the fact that the job did not succeed.
 */
function expectedStatus(mode: (typeof modes)[number], canWrite: boolean, runner: string): string {
  switch (mode) {
    case "success":
      return "success";
    case "success-no-disk":
      // claude writes no envelope at all in this mode, so there is nothing to
      // verify and it must fail regardless of posture. codex and cursor write an
      // envelope with no work artifacts: legitimate for a reviewer that changed
      // nothing, not for a job that could write and produced nothing.
      if (runner === "claude") return "not-success";
      return canWrite ? "not-success" : "success";
    case "fabricated-tests":
      // claude and cursor emit a prose claim and no envelope, so they fail on
      // the missing envelope alone — prose is never evidence. codex writes a
      // well-formed one, which is success at the transport layer: catching a
      // runner that lied about its work is the reviewer's job, not the
      // dispatcher's. A write-capable job must still show artifacts.
      if (runner !== "codex") return "not-success";
      return canWrite ? "not-success" : "success";
    case "usage-limit":
      return "usage_limit";
    case "silence":
    case "wedge-after-work":
      return "timeout";
    case "permission-exit-zero":
      return "permission_denied";
    default:
      // partial, malformed, oversized, transient, non-resumable,
      // fabricated-tests, success-no-disk: all must refuse to claim success.
      return "not-success";
  }
}

function timeoutForMode(mode: (typeof modes)[number]): number {
  if (mode === "silence" || mode === "wedge-after-work") return 300;
  if (mode === "oversized") return 2_000;
  return 5_000;
}

/**
 * Both capability postures, because they now mean different things: a read-only
 * reviewer that accepts legitimately produces no work artifacts, while a
 * write-capable job claiming success without producing anything has not shown
 * it did the work.
 */
const postures = [
  { name: "read-only", capabilities: ["repository-read"] as readonly string[] },
  { name: "write-capable", capabilities: ["repository-read", "repository-write"] as readonly string[] },
];

for (const runner of runners) {
  for (const posture of postures) {
    for (const mode of modes) {
      test(`fake ${runner.name} (${posture.name}) handles mode ${mode} deterministically`, async () => {
        const artifactDir = await makeTempArtifactDir();
        const jobId = `job-${runner.name}-${posture.name}-${mode}`;
        const argv = runner.runnerType === "codex"
          ? runner.buildArgv(runner.script, mode, path.join(artifactDir, "result.json"))
          : runner.buildArgv(runner.script, mode, await briefDeclaring(runner.runnerType, artifactDir, jobId));
        const result = await dispatchRunnerJob({
          jobId,
          profile: profile(runner.runnerType, `fake-${runner.name}`, [...posture.capabilities]),
          argv,
          artifactDir,
          timeoutMs: timeoutForMode(mode),
        });

        // The previous assertion was that classifyFailure returns a string,
        // which it always does — so every runner could map every mode to the
        // wrong status and this matrix stayed green. That is precisely the
        // test/production divergence that hid the QK-RUN-007 dispatch defects.
        const expected = expectedStatus(mode, posture.capabilities.includes("repository-write"), runner.name);
        if (expected === "not-success") {
          assert.notEqual(result.status, "success", `${mode} must not report success`);
        } else {
          assert.equal(result.status, expected, `${mode} must map to ${expected}`);
        }
        if (result.status !== "success") {
          assert.ok(result.failure?.code, `${mode} must name why it failed`);
        }
        assert.equal(typeof classifyFailure(result), "string");
      });
    }
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
