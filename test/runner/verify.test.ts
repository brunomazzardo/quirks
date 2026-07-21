import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RunnerJobResult } from "../../src/runner/types.js";
import { verifyJobArtifacts } from "../../src/runner/verify.js";

function resultWithArtifacts(artifactPaths: readonly string[]): RunnerJobResult {
  return {
    schemaVersion: 1,
    jobId: "job-1",
    runner: "claude-standard",
    runnerType: "claude",
    resolvedModel: "claude-sonnet",
    effort: "standard",
    status: "success",
    sessionHandle: "session-1",
    artifactPaths,
    usage: {},
    failure: undefined,
  };
}

test("verifyJobArtifacts succeeds when expected artifact files exist", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-verify-"));
  const resultPath = path.join(artifactDir, "result.json");
  const logPath = path.join(artifactDir, "transcript.log");
  await writeFile(resultPath, '{"schemaVersion":1,"jobId":"job-1","status":"success"}\n', "utf8");
  await writeFile(logPath, "structured transcript\n", "utf8");

  const verified = await verifyJobArtifacts(resultWithArtifacts([resultPath, logPath]), {
    expectedPaths: [resultPath, logPath],
  });

  assert.deepEqual(verified, {
    ok: true,
    artifactPaths: [resultPath, logPath],
  });
});

test("verifyJobArtifacts fails closed when an expected artifact is missing", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-verify-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, '{"schemaVersion":1,"jobId":"job-1","status":"success"}\n', "utf8");

  const verified = await verifyJobArtifacts(resultWithArtifacts([resultPath]), {
    expectedPaths: [resultPath, path.join(artifactDir, "missing.json")],
  });

  assert.equal(verified.ok, false);
  assert.equal(verified.code, "missing_artifact");
});

test("verifyJobArtifacts fails closed when expected files are not listed by the result", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-verify-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, '{"schemaVersion":1,"jobId":"job-1","status":"success"}\n', "utf8");

  const verified = await verifyJobArtifacts(resultWithArtifacts([]), {
    expectedPaths: [resultPath],
  });

  assert.equal(verified.ok, false);
  assert.equal(verified.code, "unreported_artifact");
});

test("verifyJobArtifacts validates optional JSON result envelopes", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-verify-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, '{"schemaVersion":1,"jobId":"job-1","status":"success"}\n', "utf8");

  const verified = await verifyJobArtifacts(resultWithArtifacts([resultPath]), {
    expectedPaths: [resultPath],
    jsonEnvelopes: [resultPath],
  });

  assert.equal(verified.ok, true);
});

test("verifyJobArtifacts rejects malformed JSON result envelopes", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-verify-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, "Task complete.\n", "utf8");

  const verified = await verifyJobArtifacts(resultWithArtifacts([resultPath]), {
    expectedPaths: [resultPath],
    jsonEnvelopes: [resultPath],
  });

  assert.equal(verified.ok, false);
  assert.equal(verified.code, "invalid_json_envelope");
});

test("verifyJobArtifacts rejects JSON envelopes with mismatched job ids", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-verify-"));
  const resultPath = path.join(artifactDir, "result.json");
  await writeFile(resultPath, '{"schemaVersion":1,"jobId":"other","status":"success"}\n', "utf8");

  const verified = await verifyJobArtifacts(resultWithArtifacts([resultPath]), {
    expectedPaths: [resultPath],
    jsonEnvelopes: [resultPath],
  });

  assert.equal(verified.ok, false);
  assert.equal(verified.code, "invalid_json_envelope");
});
