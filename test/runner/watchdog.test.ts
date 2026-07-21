import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { classifyFailure } from "../../src/campaign/failures.js";
import { CampaignStore } from "../../src/campaign/store.js";
import type { RunnerProfile } from "../../src/runner/types.js";
import {
  heartbeatPath,
  probeLiveness,
  readHeartbeat,
  startDetachedJob,
  stopWatchdog,
} from "../../src/runner/watchdog.js";
import { campaignEnvelope } from "../campaign/support.js";

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

async function openRunningStore(stateDir: string): Promise<CampaignStore> {
  const incomplete = campaignEnvelope();
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  const store = await CampaignStore.create({
    stateDir,
    repositoryId: envelope.repositoryId,
    campaignId: envelope.campaignId,
    envelope,
  });
  await store.writeState({
    schemaVersion: 1,
    campaignId: envelope.campaignId,
    status: "running",
    digest: envelope.digest,
    updatedAt: new Date().toISOString(),
  });
  return store;
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

async function startFakeJob(
  store: CampaignStore,
  mode: string,
  timeoutMs: number,
  jobId?: string,
): Promise<{ campaignId: string; jobId: string }> {
  const started = await startDetachedJob({
    store,
    profile: fakeProfile,
    argv: fakeClaudeArgv(mode),
    timeoutMs,
    ...(jobId === undefined ? {} : { jobId }),
    cancelScope: "job",
    role: "implementer",
    heartbeatIntervalMs: 25,
  });
  return started;
}

describe("watchdog detached execution", { concurrency: false }, () => {
  test.afterEach(async () => {
    await stopWatchdog();
  });

  test("records PID, session handle, and heartbeat before returning", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-watchdog-"));
    const store = await openRunningStore(stateDir);

    const { campaignId, jobId } = await startFakeJob(store, "success", 5_000);

    assert.match(campaignId, /cmp-/);
    assert.match(jobId, /./);

    const heartbeat = await readHeartbeat(store, jobId);
    assert.equal(heartbeat.campaignId, campaignId);
    assert.equal(heartbeat.sessionHandle, SESSION_ID);
    assert.ok(heartbeat.pid > 0);

    const sessions = JSON.parse(await readFile(store.sessionsFile, "utf8")) as {
      sessions: Array<{ jobId: string; pid: number; sessionHandle: string }>;
    };
    const session = sessions.sessions.find((entry) => entry.jobId === jobId);
    assert.ok(session);
    assert.equal(session?.sessionHandle, SESSION_ID);
    assert.ok((session?.pid ?? 0) > 0);

    const events = await store.readEvents();
    const dispatched = events.find((event) => event.type === "runner.dispatched");
    assert.ok(dispatched);
    assert.equal(dispatched.evidence.jobId, jobId);
    assert.equal(dispatched.evidence.sessionHandle, SESSION_ID);
    assert.match(dispatched.evidence.pid ?? "", /[1-9]/);
    assert.equal(dispatched.evidence.timeoutMs, "5000");
    assert.equal(dispatched.evidence.cancelScope, "job");

    const liveness = await probeLiveness(store, jobId);
    assert.ok(liveness.pid > 0);
    assert.equal(liveness.sessionHandle, SESSION_ID);
  });

  test("updates heartbeat while a detached job is still running", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-watchdog-"));
    const store = await openRunningStore(stateDir);
    const { jobId } = await startFakeJob(store, "timeout", 30_000);

    const first = await readHeartbeat(store, jobId);
    assert.equal(first.status, "running");

    await new Promise((resolve) => setTimeout(resolve, 80));

    const second = await readHeartbeat(store, jobId);
    assert.equal(second.status, "running");
    assert.ok(second.updatedAt >= first.updatedAt);
    assert.notEqual(second.revision, first.revision);
  });

  test("classifies wall-clock timeout as a transient pause", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-watchdog-"));
    const store = await openRunningStore(stateDir);
    const { jobId } = await startFakeJob(store, "timeout", 200);

    const deadline = Date.now() + 5_000;
    let heartbeat = await readHeartbeat(store, jobId);
    let snapshot = await store.readState();
    while (
      (heartbeat.status === "running" || snapshot.status === "running") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      heartbeat = await readHeartbeat(store, jobId);
      snapshot = await store.readState();
    }

    assert.equal(heartbeat.status, "timeout");
    assert.equal(heartbeat.terminalStatus, "timeout");
    assert.equal(classifyFailure({ status: "timeout" }), "transient_runner");

    const events = await store.readEvents();
    const paused = events.find((event) => event.type === "runner.timeout" && event.to === "paused");
    assert.ok(paused);
    assert.equal(paused.reason, "runner_timeout");
    assert.equal(paused.evidence.jobId, jobId);
    assert.equal(paused.evidence.failureClass, "transient_runner");

    assert.equal(snapshot.status, "paused");
    assert.equal(snapshot.pausedReason, "runner_timeout");
  });

  test("heartbeat file lives under artifacts/<job-id>/heartbeat.json", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-watchdog-"));
    const store = await openRunningStore(stateDir);
    const { jobId } = await startFakeJob(store, "success", 5_000, "job-explicit");

    assert.equal(heartbeatPath(store, jobId), path.join(store.artifactsPath, jobId, "heartbeat.json"));
    await readFile(heartbeatPath(store, jobId), "utf8");
  });
});
