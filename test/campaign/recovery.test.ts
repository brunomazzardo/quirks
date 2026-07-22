import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { recoverCampaign } from "../../src/campaign/recovery.js";
import { computeInstructionsHash } from "../../src/campaign/task-brief.js";
import { CampaignSupervisor } from "../../src/campaign/supervisor.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import { FakeTaskSource } from "../task-source/fake-source.js";
import { campaignEnvelope } from "./support.js";
import { FakeRunnerPort } from "./support/fake-runner-port.js";
import { FakeWorktreePort } from "./support/fake-worktree.js";

async function crashedStoreFixture() {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-recovery-"));
  const lockDir = await mkdtemp(path.join(os.tmpdir(), "quirks-recovery-lock-"));
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-recovery-repo-"));

  const source = new FakeTaskSource();
  const incomplete = campaignEnvelope({
    campaignId: "cmp-recovery",
    taskIds: ["QK-1"],
    taskRevisions: { "QK-1": source.taskRevision("QK-1") },
    hashes: {
      config: "sha256:cfg",
      workflowPolicy: "sha256:wf",
      instructions: computeInstructionsHash({}),
    },
    routing: {
      "QK-1": {
        primary: { profileId: "cursor-standard", tier: "standard", effort: "standard" },
        fallbacks: [],
      },
    },
  });
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  const store = await CampaignStore.create({
    stateDir,
    repositoryId: envelope.repositoryId,
    campaignId: envelope.campaignId,
    envelope,
  });
  const outbox = SyncOutbox.open(store.syncOutboxFile);
  const context = {
    store,
    source,
    outbox,
    runner: new FakeRunnerPort(),
    worktree: new FakeWorktreePort(),
    lockPath: path.join(lockDir, "repository.lock"),
    repositoryRoot,
    workflowSkills: {},
  };

  const challenge = createApprovalChallenge({
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    ttlMs: 60_000,
  });
  await consumeApprovalToken({
    store,
    token: challenge.token,
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    operator: { kind: "configured-profile", id: "operator@test" },
  });

  const supervisor = await CampaignSupervisor.open(context);
  await supervisor.startApproved();
  await supervisor.stop();

  return { store, context };
}

test("reconstructs running jobs from events and sessions without duplicating dispatch", async () => {
  const { store } = await crashedStoreFixture();
  const report = await recoverCampaign(store);
  assert.equal(report.duplicateDispatchesPrevented >= 1, true);
  assert.equal(report.state.status, "paused");
  assert.equal(report.recoveredJobs.length >= 1, true);
});

test("detects envelope drift and pauses campaign", async () => {
  const { store } = await crashedStoreFixture();
  const envelope = await store.readEnvelope();
  await store.writeState({
    schemaVersion: 1,
    campaignId: envelope.campaignId,
    status: "running",
    digest: "sha256:" + "f".repeat(64),
    updatedAt: new Date().toISOString(),
  });
  const report = await recoverCampaign(store);
  assert.equal(report.state.status, "paused");
  assert.match(report.pauseReason ?? "", /drift|revision|envelope/i);
});
