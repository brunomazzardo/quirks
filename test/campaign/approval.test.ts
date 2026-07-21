import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge, hasDurableApproval } from "../../src/campaign/approval.js";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { campaignEnvelope } from "./support.js";

async function createStore() {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-approval-"));
  const incomplete = campaignEnvelope({ campaignId: "cmp-approval" });
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  return { envelope, store: await CampaignStore.create({ stateDir, repositoryId: envelope.repositoryId, campaignId: envelope.campaignId, envelope }) };
}

test("records one durable approval per digest and rejects replay", async () => {
  const { store, envelope } = await createStore();
  const challenge = createApprovalChallenge({ campaignId: envelope.campaignId, digest: envelope.digest, ttlMs: 60_000 });
  const input = { store, token: challenge.token, campaignId: envelope.campaignId, digest: envelope.digest, operator: { kind: "configured-profile" as const, id: "operator@test" } };
  const approval = await consumeApprovalToken(input);
  assert.equal(approval.digest, envelope.digest);
  assert.equal(await hasDurableApproval(store, envelope.digest), true);
  await assert.rejects(() => consumeApprovalToken(input), /APPROVAL_REPLAY/);
});

test("rejects digest mismatch and expiry without mutation", async () => {
  const { store, envelope } = await createStore();
  const mismatch = createApprovalChallenge({ campaignId: envelope.campaignId, digest: envelope.digest });
  await assert.rejects(() => consumeApprovalToken({ store, token: mismatch.token, campaignId: envelope.campaignId, digest: "sha256:" + "b".repeat(64), operator: { kind: "self-asserted", id: "x" } }), /DIGEST_MISMATCH/);
  const expired = createApprovalChallenge({ campaignId: envelope.campaignId, digest: envelope.digest, ttlMs: 0 });
  await assert.rejects(() => consumeApprovalToken({ store, token: expired.token, campaignId: envelope.campaignId, digest: envelope.digest, operator: { kind: "self-asserted", id: "x" } }), /APPROVAL_EXPIRED/);
  assert.equal((await store.readApprovals()).length, 0);
});
