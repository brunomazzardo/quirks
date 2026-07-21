import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge } from "../../src/campaign/approval.js";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignSupervisor, type CampaignSupervisorContext } from "../../src/campaign/supervisor.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { RepositoryLock } from "../../src/state/repository-lock.js";
import { SyncOutbox } from "../../src/sync/outbox.js";
import { FakeTaskSource } from "../task-source/fake-source.js";
import { campaignEnvelope } from "./support.js";
import { FakeRunnerPort } from "./support/fake-runner-port.js";
import { FakeWorktreePort } from "./support/fake-worktree.js";

async function testContext(): Promise<CampaignSupervisorContext> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-supervisor-"));
  const lockDir = await mkdtemp(path.join(os.tmpdir(), "quirks-supervisor-lock-"));
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-supervisor-repo-"));
  await mkdir(path.join(repositoryRoot, ".quirks"), { recursive: true });
  await writeFile(path.join(repositoryRoot, ".quirks/tasks.json"), '{"tasks":[]}\n', "utf8");

  const incomplete = campaignEnvelope({
    campaignId: "cmp-supervisor",
    taskIds: ["QK-1"],
    taskRevisions: { "QK-1": "sha256:rev" },
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
  const source = new FakeTaskSource();
  const outbox = SyncOutbox.open(store.syncOutboxFile);

  return {
    store,
    source,
    outbox,
    runner: new FakeRunnerPort(),
    worktree: new FakeWorktreePort(),
    lockPath: path.join(lockDir, "repository.lock"),
    repositoryRoot,
  };
}

async function recordApproval(context: CampaignSupervisorContext): Promise<void> {
  const envelope = await context.store.readEnvelope();
  const challenge = createApprovalChallenge({
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    ttlMs: 60_000,
  });
  await consumeApprovalToken({
    store: context.store,
    token: challenge.token,
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    operator: { kind: "configured-profile", id: "operator@test" },
  });
}

test("refuses claim before durable approval exists", async () => {
  const supervisor = await CampaignSupervisor.open(await testContext());
  await assert.rejects(() => supervisor.startApproved(), /APPROVAL_REQUIRED/);
});

test("claims and dispatches only approved tasks after approval", async () => {
  const context = await testContext();
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();
  const status = await supervisor.status();
  assert.equal(status.claimedTaskIds.includes("QK-1"), true);
  assert.equal(status.dispatchedJobs.length, 1);
  assert.equal(status.dispatchedJobs[0]?.taskId, "QK-1");
  const state = await context.store.readState();
  assert.equal(state.status, "running");
});

test("acquires repository lock during startApproved", async () => {
  const context = await testContext();
  const supervisor = await CampaignSupervisor.open(context);
  await recordApproval(context);
  await supervisor.startApproved();
  await assert.rejects(
    () => RepositoryLock.acquire(context.lockPath, { campaignId: "other-campaign" }),
    /LOCAL_LOCK_HELD|LOCK_NOT_OWNED/i,
  );
  await supervisor.stop();
});
