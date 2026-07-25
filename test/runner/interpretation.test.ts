import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dispatchRunnerJob } from "../../src/runner/dispatcher.js";
import type { ResultInterpreter, RunnerJobFacts } from "../../src/runner/interpretation.js";
import type { RunnerProfile } from "../../src/runner/types.js";

const profile: RunnerProfile = {
  schemaVersion: 1,
  profileId: "seam-claude",
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

async function artifactDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "quirks-seam-"));
}

function recordingInterpreter(): { interpreter: ResultInterpreter; seen: RunnerJobFacts[]; transcripts: string[] } {
  const seen: RunnerJobFacts[] = [];
  const transcripts: string[] = [];
  return {
    seen,
    transcripts,
    interpreter: {
      async interpret(facts, transcript) {
        seen.push(facts);
        transcripts.push(transcript);
        return { status: "success", sessionHandle: "from-interpreter", artifactPaths: [] };
      },
    },
  };
}

test("the launcher hands its own observations to the interpreter and returns what it decides", async () => {
  const dir = await artifactDir();
  const script = path.join(dir, "speak.mjs");
  await writeFile(script, 'process.stdout.write("a runner said this\\n");\n', "utf8");
  const { interpreter, seen, transcripts } = recordingInterpreter();

  const result = await dispatchRunnerJob({
    jobId: "job-seam",
    profile,
    argv: [process.execPath, script],
    artifactDir: dir,
    timeoutMs: 5_000,
    interpreter,
  });

  assert.equal(seen.length, 1);
  const facts = seen[0]!;
  assert.equal(facts.jobId, "job-seam");
  assert.equal(facts.exitCode, 0);
  assert.equal(facts.profileId, "seam-claude");
  assert.equal(facts.runnerType, "claude");
  assert.equal(facts.transcriptPath !== undefined, true, "the transcript must be retained before interpretation");
  assert.match(transcripts[0] ?? "", /a runner said this/);
  assert.equal(result.status, "success");
  assert.equal(result.sessionHandle, "from-interpreter");
});

test("the interpreter reads exactly the text that was retained, so a verdict stays auditable", async () => {
  const dir = await artifactDir();
  const script = path.join(dir, "secretish.mjs");
  // The retained transcript is redacted before it reaches disk. Interpreting
  // the unredacted stdout instead would mean quoting evidence that is not in
  // the record an operator can read back.
  await writeFile(script, 'process.stdout.write("token sk-ant-api03-0123456789abcdefghijklmnop\\n");\n', "utf8");
  const { interpreter, transcripts } = recordingInterpreter();

  await dispatchRunnerJob({
    jobId: "job-redact",
    profile,
    argv: [process.execPath, script],
    artifactDir: dir,
    timeoutMs: 5_000,
    interpreter,
  });

  assert.equal(transcripts[0]?.includes("sk-ant-api03"), false);
  assert.match(transcripts[0] ?? "", /redacted-secret/);
});

test("the launcher owns a timeout outright and never asks the interpreter about it", async () => {
  const dir = await artifactDir();
  const script = path.join(dir, "hang.mjs");
  await writeFile(script, "setInterval(() => {}, 1000);\n", "utf8");
  const { interpreter, seen } = recordingInterpreter();

  const result = await dispatchRunnerJob({
    jobId: "job-timeout",
    profile,
    argv: [process.execPath, script],
    artifactDir: dir,
    timeoutMs: 300,
    interpreter,
  });

  assert.equal(result.status, "timeout");
  assert.equal(seen.length, 0, "a killed job has no result to interpret");
});

test("an interpreter that throws fails the job honestly instead of crashing the campaign", async () => {
  const dir = await artifactDir();
  const script = path.join(dir, "ok.mjs");
  await writeFile(script, 'process.stdout.write("done\\n");\n', "utf8");

  const result = await dispatchRunnerJob({
    jobId: "job-throw",
    profile,
    argv: [process.execPath, script],
    artifactDir: dir,
    timeoutMs: 5_000,
    interpreter: { async interpret() { throw new Error("interpreter exploded"); } },
  });

  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "interpretation_error");
  assert.match(result.failure?.message ?? "", /interpreter exploded/);
  assert.equal(result.artifactPaths.some((entry) => entry.includes("transcript-")), true);
});
