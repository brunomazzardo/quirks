import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { SessionRegistry } from "../../src/runner/sessions.js";
import { campaignEnvelope } from "../campaign/support.js";

async function openMinimalStore(stateDir: string): Promise<CampaignStore> {
  const incomplete = campaignEnvelope();
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  return CampaignStore.create({ stateDir, repositoryId: envelope.repositoryId, campaignId: envelope.campaignId, envelope });
}

test("records session handles and heartbeats for recovery", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-sessions-"));
  const store = await openMinimalStore(stateDir);
  const registry = await SessionRegistry.open(store);
  await registry.register({
    jobId: "job-1",
    role: "implementer",
    profileId: "cursor-standard",
    sessionHandle: "thread-1",
    pid: process.pid,
    artifactPaths: ["artifacts/job-1/result.json"],
  });
  const sessions = await registry.list();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.jobId, "job-1");
  assert.equal(sessions[0]?.role, "implementer");
  assert.equal(sessions[0]?.profileId, "cursor-standard");
  assert.equal(sessions[0]?.sessionHandle, "thread-1");
  assert.equal(sessions[0]?.pid, process.pid);
  assert.deepEqual(sessions[0]?.artifactPaths, ["artifacts/job-1/result.json"]);
  assert.match(sessions[0]?.startedAt ?? "", /202/);
  assert.match(sessions[0]?.lastHeartbeatAt ?? "", /202/);
  assert.equal(sessions[0]?.terminalStatus, undefined);
});

test("concurrent registrations both survive in sessions.json", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-sessions-"));
  const store = await openMinimalStore(stateDir);
  const registry = await SessionRegistry.open(store);
  await Promise.all([
    registry.register({
      jobId: "job-implementer",
      role: "implementer",
      profileId: "cursor-standard",
      sessionHandle: "thread-1",
      pid: process.pid,
      artifactPaths: [],
    }),
    registry.register({
      jobId: "job-reviewer",
      role: "reviewer",
      profileId: "claude-standard",
      sessionHandle: "thread-2",
      pid: process.pid,
      artifactPaths: [],
    }),
  ]);
  const persisted = await store.readSessionsDocument();
  assert.deepEqual(
    persisted.sessions.map((session) => session.jobId).toSorted(),
    ["job-implementer", "job-reviewer"],
  );
});

test("concurrent register and update serialize without losing either write", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-sessions-"));
  const store = await openMinimalStore(stateDir);
  const registry = await SessionRegistry.open(store);
  await registry.register({
    jobId: "job-1",
    role: "implementer",
    profileId: "cursor-standard",
    sessionHandle: "thread-1",
    pid: process.pid,
    artifactPaths: [],
  });
  await Promise.all([
    registry.update({ jobId: "job-1", terminalStatus: "success" }),
    registry.register({
      jobId: "job-2",
      role: "reviewer",
      profileId: "claude-standard",
      sessionHandle: "thread-2",
      pid: process.pid,
      artifactPaths: [],
    }),
  ]);
  const persisted = await store.readSessionsDocument();
  assert.deepEqual(persisted.sessions.map((session) => session.jobId).toSorted(), ["job-1", "job-2"]);
  assert.equal(persisted.sessions.find((session) => session.jobId === "job-1")?.terminalStatus, "success");
});

test("update refreshes lastHeartbeatAt on heartbeat", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-sessions-"));
  const store = await openMinimalStore(stateDir);
  const registry = await SessionRegistry.open(store);
  await registry.register({
    jobId: "job-1",
    role: "implementer",
    profileId: "cursor-standard",
    sessionHandle: "thread-1",
    pid: process.pid,
    artifactPaths: ["artifacts/job-1/result.json"],
  });
  const [before] = await registry.list();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const updated = await registry.update({ jobId: "job-1" });
  assert.equal(updated.startedAt, before?.startedAt);
  assert.notEqual(updated.lastHeartbeatAt, before?.lastHeartbeatAt);
  assert.ok(updated.lastHeartbeatAt >= (before?.lastHeartbeatAt ?? ""));
});

test("update marks terminal status without deleting history", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-sessions-"));
  const store = await openMinimalStore(stateDir);
  const registry = await SessionRegistry.open(store);
  await registry.register({
    jobId: "job-1",
    role: "reviewer",
    profileId: "claude-standard",
    sessionHandle: "thread-2",
    pid: process.pid,
    artifactPaths: ["artifacts/job-1/review.json"],
  });
  await registry.update({ jobId: "job-1", terminalStatus: "success" });
  const sessions = await registry.list();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.terminalStatus, "success");
  assert.equal(sessions[0]?.sessionHandle, "thread-2");
});
