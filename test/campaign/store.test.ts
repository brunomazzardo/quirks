import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { campaignEnvelope } from "./support.js";

test("creates the canonical campaign directory layout", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-campaign-store-"));
  const incomplete = campaignEnvelope();
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  const store = await CampaignStore.create({ stateDir, repositoryId: envelope.repositoryId, campaignId: envelope.campaignId, envelope });
  for (const file of ["campaign.json", "events.jsonl", "approvals.jsonl", "state.json", "sessions.json", "sync-outbox.jsonl"]) assert.equal(await store.hasFile(file), true);
  assert.equal((await store.readState()).status, "awaiting_approval");
});

test("refuses to open an envelope whose digest no longer matches", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-campaign-store-"));
  const incomplete = campaignEnvelope();
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  const store = await CampaignStore.create({ stateDir, repositoryId: envelope.repositoryId, campaignId: envelope.campaignId, envelope });
  await writeFile(store.campaignFile, JSON.stringify({ ...envelope, verification: ["changed"] }));
  await assert.rejects(() => CampaignStore.open(stateDir, envelope.repositoryId, envelope.campaignId), /digest mismatch/);
});
