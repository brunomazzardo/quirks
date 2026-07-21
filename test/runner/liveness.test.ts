import assert from "node:assert/strict";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { QuirksError } from "../../src/core/errors.js";
import { probeLiveness, resumeJob } from "../../src/runner/liveness.js";
import { SessionRegistry } from "../../src/runner/sessions.js";
import type { RunnerProfile } from "../../src/runner/types.js";
import { EventJournal } from "../../src/state/event-journal.js";
import { campaignEnvelope } from "../campaign/support.js";

const STALE_AFTER_MS = 1_000;

async function openMinimalStore(): Promise<CampaignStore> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-liveness-"));
  const incomplete = campaignEnvelope();
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  return CampaignStore.create({ stateDir, repositoryId: envelope.repositoryId, campaignId: envelope.campaignId, envelope });
}

async function makeArtifact(mtimeOffsetMs: number): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-liveness-artifact-"));
  const filePath = path.join(dir, "output.log");
  await writeFile(filePath, "output");
  const touchedAt = new Date(Date.now() + mtimeOffsetMs);
  await utimes(filePath, touchedAt, touchedAt);
  return filePath;
}

async function registerSession(
  registry: SessionRegistry,
  overrides: { jobId: string; pid: number; sessionHandle: string; artifactPaths: readonly string[] },
) {
  return registry.register({
    role: "implementer",
    profileId: "fake-profile",
    ...overrides,
  });
}

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

function alwaysAlive() {
  return { isAlive: () => true };
}

function alwaysDead() {
  return { isAlive: () => false };
}

function worktree(hasModifications: boolean) {
  return { hasModifications: async () => hasModifications };
}

test("reports active classification when process is alive and output is fresh", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(0);
  await registerSession(registry, { jobId: "job-1", pid: process.pid, sessionHandle: "", artifactPaths: [artifactPath] });

  const report = await probeLiveness("job-1", {
    registry,
    journal,
    worktree: worktree(false),
    process: alwaysAlive(),
    staleAfterMs: STALE_AFTER_MS,
  });

  assert.equal(report.pid, process.pid);
  assert.equal(report.processAlive, true);
  assert.equal(report.outputGrowing, true);
  assert.equal(report.classification, "active");
  assert.equal(report.resumeEligible, false);
  assert.equal(report.terminal, false);
});

test("reports paused classification when process is alive but output has stalled", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(-10 * STALE_AFTER_MS);
  await registerSession(registry, { jobId: "job-1", pid: process.pid, sessionHandle: "", artifactPaths: [artifactPath] });

  const report = await probeLiveness("job-1", {
    registry,
    journal,
    worktree: worktree(false),
    process: alwaysAlive(),
    staleAfterMs: STALE_AFTER_MS,
  });

  assert.equal(report.processAlive, true);
  assert.equal(report.outputGrowing, false);
  assert.equal(report.classification, "paused");
  assert.equal(report.resumeEligible, false);
  assert.equal(report.terminal, false);
});

test("reports stale classification when process is dead with no recovery evidence", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(-10 * STALE_AFTER_MS);
  await registerSession(registry, { jobId: "job-1", pid: 999_999, sessionHandle: "", artifactPaths: [artifactPath] });

  const report = await probeLiveness("job-1", {
    registry,
    journal,
    worktree: worktree(false),
    process: alwaysDead(),
    staleAfterMs: STALE_AFTER_MS,
  });

  assert.equal(report.processAlive, false);
  assert.equal(report.worktreeModified, false);
  assert.equal(report.transcriptRecoverable, false);
  assert.equal(report.classification, "stale");
  assert.equal(report.resumeEligible, false);
  assert.equal(report.terminal, true);
});

test("reports resumable classification driven by worktree modifications", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(-10 * STALE_AFTER_MS);
  await registerSession(registry, { jobId: "job-1", pid: 999_999, sessionHandle: "", artifactPaths: [artifactPath] });

  const report = await probeLiveness("job-1", {
    registry,
    journal,
    worktree: worktree(true),
    process: alwaysDead(),
    staleAfterMs: STALE_AFTER_MS,
  });

  assert.equal(report.worktreeModified, true);
  assert.equal(report.classification, "resumable");
  assert.equal(report.resumeEligible, true);
  assert.equal(report.terminal, false);
});

test("reports resumable classification driven by runner-native transcript recovery", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(-10 * STALE_AFTER_MS);
  await registerSession(registry, {
    jobId: "job-1",
    pid: 999_999,
    sessionHandle: "session-abc",
    artifactPaths: [artifactPath],
  });

  const report = await probeLiveness("job-1", {
    registry,
    journal,
    worktree: worktree(false),
    process: alwaysDead(),
    staleAfterMs: STALE_AFTER_MS,
  });

  assert.equal(report.worktreeModified, false);
  assert.equal(report.transcriptRecoverable, true);
  assert.equal(report.classification, "resumable");
  assert.equal(report.resumeEligible, true);
});

test("reports terminal classification once a terminal status is recorded", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(0);
  await registerSession(registry, { jobId: "job-1", pid: process.pid, sessionHandle: "", artifactPaths: [artifactPath] });
  await registry.update({ jobId: "job-1", terminalStatus: "success" });

  const report = await probeLiveness("job-1", {
    registry,
    journal,
    worktree: worktree(false),
    process: alwaysAlive(),
    staleAfterMs: STALE_AFTER_MS,
  });

  assert.equal(report.classification, "terminal");
  assert.equal(report.terminal, true);
  assert.equal(report.resumeEligible, false);
});

test("resumeJob dispatches a runner-native resume and records the session update", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(-10 * STALE_AFTER_MS);
  await registerSession(registry, {
    jobId: "job-1",
    pid: 999_999,
    sessionHandle: "session-abc",
    artifactPaths: [artifactPath],
  });

  let capturedArgv: readonly string[] | undefined;
  const result = await resumeJob("job-1", {
    registry,
    journal,
    profile: fakeProfile,
    workspace: "/repo/workspace",
    briefPath: "/repo/brief.md",
    artifactDir: "/tmp/artifacts/job-1",
    timeoutMs: 5_000,
    dispatch: async (input) => {
      capturedArgv = input.argv;
      return {
        schemaVersion: 1,
        jobId: input.jobId,
        runner: input.profile.profileId,
        runnerType: input.profile.runnerType,
        resolvedModel: input.profile.model,
        effort: input.profile.effort,
        status: "success",
        sessionHandle: "session-abc",
        artifactPaths: ["artifacts/job-1/result.json"],
        usage: {},
        failure: undefined,
      };
    },
  });

  assert.equal(result.status, "success");
  assert.equal(capturedArgv?.includes("--resume"), true);
  assert.equal(capturedArgv?.includes("session-abc"), true);
  const sessions = await registry.list();
  assert.equal(sessions[0]?.terminalStatus, "success");
  assert.deepEqual(sessions[0]?.artifactPaths, ["artifacts/job-1/result.json"]);
});

test("rejects a second resume attempt for the same job", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(-10 * STALE_AFTER_MS);
  await registerSession(registry, {
    jobId: "job-1",
    pid: 999_999,
    sessionHandle: "session-abc",
    artifactPaths: [artifactPath],
  });

  const deps = {
    registry,
    journal,
    profile: fakeProfile,
    workspace: "/repo/workspace",
    briefPath: "/repo/brief.md",
    artifactDir: "/tmp/artifacts/job-1",
    timeoutMs: 5_000,
    dispatch: async (input: { jobId: string; profile: RunnerProfile }) => ({
      schemaVersion: 1 as const,
      jobId: input.jobId,
      runner: input.profile.profileId,
      runnerType: input.profile.runnerType,
      resolvedModel: input.profile.model,
      effort: input.profile.effort,
      status: "failure" as const,
      sessionHandle: "session-abc",
      artifactPaths: [],
      usage: {},
      failure: undefined,
    }),
  };

  await resumeJob("job-1", deps);

  await assert.rejects(
    () => resumeJob("job-1", deps),
    (error: unknown) => error instanceof QuirksError && error.code === "PROTOCOL_VIOLATION",
  );
});

test("reports exhausted classification once the one permitted resume has been used", async () => {
  const store = await openMinimalStore();
  const registry = await SessionRegistry.open(store);
  const journal = new EventJournal(path.join(store.campaignPath, "resume-journal.jsonl"));
  const artifactPath = await makeArtifact(-10 * STALE_AFTER_MS);
  await registerSession(registry, {
    jobId: "job-1",
    pid: 999_999,
    sessionHandle: "session-abc",
    artifactPaths: [artifactPath],
  });

  await resumeJob("job-1", {
    registry,
    journal,
    profile: fakeProfile,
    workspace: "/repo/workspace",
    briefPath: "/repo/brief.md",
    artifactDir: "/tmp/artifacts/job-1",
    timeoutMs: 5_000,
    dispatch: async (input) => ({
      schemaVersion: 1,
      jobId: input.jobId,
      runner: input.profile.profileId,
      runnerType: input.profile.runnerType,
      resolvedModel: input.profile.model,
      effort: input.profile.effort,
      status: "failure",
      sessionHandle: "session-abc",
      artifactPaths: [],
      usage: {},
      failure: { code: "runner_timeout", message: "still stuck" },
    }),
  });

  const report = await probeLiveness("job-1", {
    registry,
    journal,
    worktree: worktree(false),
    process: alwaysDead(),
    staleAfterMs: STALE_AFTER_MS,
  });

  assert.equal(report.classification, "exhausted");
  assert.equal(report.resumeEligible, false);
  assert.equal(report.terminal, true);
});
