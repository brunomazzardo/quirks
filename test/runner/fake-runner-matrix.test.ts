import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";
import { ManagingAgentInterpreter } from "../../src/runner/managing-agent/interpreter.js";
import { DEFAULT_INTERPRETER_CONFIG } from "../../src/runner/managing-agent/config.js";
import type { RunnerProfile } from "../../src/runner/types.js";
import { StubInterpreter } from "./support/stub-interpreter.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

/**
 * What the launcher owes every runner, whatever the CLI says.
 *
 * This matrix used to assert parser outcomes per runner per mode. Those parsers
 * are gone: the CLI is no longer asked to emit an envelope, so there is nothing
 * vendor-shaped left to parse. What is still vendor-shaped is *starting* the
 * process and capturing what it produced, and that is what these assert — with
 * the interpreter stubbed, so a failure here is a launcher failure and never a
 * model's.
 */
const modes = [
  "success",
  "success-no-disk",
  "review-revise",
  "review-accept",
  "review-silent",
  "permission-exit-zero",
  "partial",
  "malformed",
  "transient",
  "usage-limit",
  "non-resumable",
  "fabricated-tests",
] as const;

const runners = [
  { name: "claude", runnerType: "claude" as const, script: "fake-claude.mjs" },
  { name: "codex", runnerType: "codex" as const, script: "fake-codex.mjs" },
  { name: "cursor", runnerType: "cursor" as const, script: "fake-cursor.mjs" },
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

function fakeArgv(script: string, mode: string): readonly string[] {
  return [
    process.execPath,
    path.resolve("test/fixtures/fake-runners", script),
    "--session-id",
    SESSION_ID,
    "--mode",
    mode,
  ];
}

async function makeTempArtifactDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "quirks-runner-artifacts-"));
}

/** Modes whose process exits non-zero, which the launcher must report as a fact. */
const NON_ZERO_EXIT_MODES = new Set(["transient"]);

for (const runner of runners) {
  for (const mode of modes) {
    test(`the launcher captures what fake ${runner.name} produced in mode ${mode}`, async () => {
      const artifactDir = await makeTempArtifactDir();
      const jobId = `job-${runner.name}-${mode}`;
      const interpreter = new StubInterpreter();

      const result = await dispatchRunnerJob({
        jobId,
        role: mode.startsWith("review-") ? "reviewer" : "implementer",
        profile: profile(runner.runnerType, `fake-${runner.name}`),
        argv: fakeArgv(runner.script, mode),
        artifactDir,
        timeoutMs: 5_000,
        interpreter,
      });

      assert.equal(interpreter.facts.length, 1, "every completed run reaches the interpreter exactly once");
      const facts = interpreter.facts[0]!;
      assert.equal(facts.jobId, jobId);
      assert.equal(facts.runnerType, runner.runnerType);
      assert.equal(
        facts.exitCode,
        NON_ZERO_EXIT_MODES.has(mode) ? 1 : 0,
        "the exit code is a launcher fact, reported rather than inferred",
      );
      assert.equal(facts.sessionId, SESSION_ID);

      // The transcript must be retained before interpretation and must actually
      // contain what the process said: it is the record every verdict is later
      // checked against.
      assert.equal(typeof facts.transcriptPath, "string");
      const transcript = await readFile(facts.transcriptPath!, "utf8");
      assert.equal(transcript.length > 0, true, `${mode} produced output that was not retained`);
      assert.equal(transcript, interpreter.transcripts[0]);
      assert.equal(result.artifactPaths.includes(facts.transcriptPath!), true);
    });
  }
}

test("a hung runner times out without ever consulting the interpreter", async () => {
  const interpreter = new StubInterpreter();
  const result = await dispatchRunnerJob({
    jobId: "job-hung",
    profile: profile("claude", "fake-claude"),
    argv: fakeArgv("fake-claude.mjs", "silence"),
    artifactDir: await makeTempArtifactDir(),
    timeoutMs: 300,
    interpreter,
  });
  assert.equal(result.status, "timeout");
  assert.equal(interpreter.facts.length, 0);
});

test("an oversized runner is refused by the launcher, not passed on to be read", async () => {
  const interpreter = new StubInterpreter();
  const result = await dispatchRunnerJob({
    jobId: "job-oversized",
    profile: profile("cursor", "fake-cursor"),
    argv: fakeArgv("fake-cursor.mjs", "oversized"),
    artifactDir: await makeTempArtifactDir(),
    timeoutMs: 5_000,
    interpreter,
  });
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "output_limit_exceeded");
  assert.equal(interpreter.facts.length, 0);
});

/**
 * The full production path with only the model stubbed: a real dispatch, a real
 * retained transcript, and the real reconciliation deciding what may be
 * believed. The fake reviewer's prose is deliberately the awkward kind —
 * "**Revise.** I don't think this should be accepted as it stands" — so a quote
 * lifted from it still has to survive the transcript check.
 */
for (const runner of runners) {
  test(`a ${runner.name} reviewer's quoted revise survives the whole path`, async () => {
    const artifactDir = await makeTempArtifactDir();
    const interpreter = new ManagingAgentInterpreter(
      DEFAULT_INTERPRETER_CONFIG,
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify([{
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: {
            status: "success",
            verdict: "revise",
            verdictEvidence: "Revise. I don't think this should be accepted as it stands.",
            findings: [{ severity: "critical", title: "Off-by-one", detail: "sum.js:3" }],
            artifactPaths: [],
            sessionHandle: null,
            failure: null,
            summary: "The reviewer asked for changes.",
          },
        }]),
        stderr: "",
      }),
    );

    const result = await dispatchRunnerJob({
      jobId: `job-${runner.name}-review`,
      role: "reviewer",
      profile: profile(runner.runnerType, `fake-${runner.name}`),
      argv: fakeArgv(runner.script, "review-revise"),
      artifactDir,
      timeoutMs: 5_000,
      interpreter,
    });

    assert.equal(result.status, "success");
    assert.equal(result.verdict, "revise");
    assert.match(result.verdictEvidence ?? "", /I don't think this should be accepted/);
    assert.equal(typeof result.interpretationPath, "string");
  });
}

test("a quote that is not in the runner's transcript fails the job instead of accepting it", async () => {
  const artifactDir = await makeTempArtifactDir();
  const interpreter = new ManagingAgentInterpreter(
    DEFAULT_INTERPRETER_CONFIG,
    async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{
        type: "result",
        subtype: "success",
        is_error: false,
        structured_output: {
          status: "success",
          verdict: "accept",
          verdictEvidence: "This is excellent work and I approve it without reservation.",
          findings: [],
          artifactPaths: [],
          sessionHandle: null,
          failure: null,
          summary: "The reviewer approved.",
        },
      }]),
      stderr: "",
    }),
  );

  const result = await dispatchRunnerJob({
    jobId: "job-fabricated-accept",
    role: "reviewer",
    profile: profile("claude", "fake-claude"),
    argv: fakeArgv("fake-claude.mjs", "review-revise"),
    artifactDir,
    timeoutMs: 5_000,
    interpreter,
  });

  assert.notEqual(result.verdict, "accept");
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "unsupported_verdict");
});

test("a reviewer that stated no judgment yields indeterminate, never accept", async () => {
  const artifactDir = await makeTempArtifactDir();
  const interpreter = new ManagingAgentInterpreter(
    DEFAULT_INTERPRETER_CONFIG,
    async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{
        type: "result",
        subtype: "success",
        is_error: false,
        structured_output: {
          status: "success",
          verdict: "indeterminate",
          verdictEvidence: "",
          findings: [],
          artifactPaths: [],
          sessionHandle: null,
          failure: null,
          summary: "The transcript contains no accept or revise recommendation.",
        },
      }]),
      stderr: "",
    }),
  );

  const result = await dispatchRunnerJob({
    jobId: "job-silent-review",
    role: "reviewer",
    profile: profile("cursor", "fake-cursor"),
    argv: fakeArgv("fake-cursor.mjs", "review-silent"),
    artifactDir,
    timeoutMs: 5_000,
    interpreter,
  });

  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.status, "success");
});

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

test("a runner that writes files leaves them where the interpreter can see them", async () => {
  const artifactDir = await makeTempArtifactDir();
  const interpreter = new StubInterpreter();
  await writeFile(path.join(artifactDir, "pre-existing.txt"), "x", "utf8");

  await dispatchRunnerJob({
    jobId: "job-artifacts",
    profile: profile("claude", "fake-claude", ["repository-read", "repository-write"]),
    argv: fakeArgv("fake-claude.mjs", "success"),
    artifactDir,
    timeoutMs: 5_000,
    interpreter,
  });

  assert.equal(interpreter.facts[0]?.artifactDir, artifactDir);
});
