import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { consumeApprovalToken, createApprovalChallenge, hasDurableApproval } from "../../src/campaign/approval.js";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { stageCampaignEnvelope } from "../../src/campaign/staging.js";
import type { CampaignEnvelope } from "../../src/campaign/types.js";
import { QuirksError } from "../../src/core/errors.js";
import { campaignEnvelope } from "./support.js";

function finalized(overrides: Partial<CampaignEnvelope> = {}): CampaignEnvelope {
  const incomplete = campaignEnvelope({ campaignId: "cmp-staging", ...overrides });
  return { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
}

async function freshStateDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "quirks-staging-"));
}

async function approve(store: Awaited<ReturnType<typeof stageCampaignEnvelope>>["store"], envelope: CampaignEnvelope): Promise<void> {
  const challenge = createApprovalChallenge({ campaignId: envelope.campaignId, digest: envelope.digest, ttlMs: 60_000 });
  await consumeApprovalToken({
    store,
    token: challenge.token,
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    operator: { kind: "configured-profile", id: "operator@test" },
  });
}

test("staging a new campaign creates the store awaiting approval", async () => {
  const stateDir = await freshStateDir();
  const envelope = finalized();
  const { store, outcome } = await stageCampaignEnvelope({ stateDir, envelope });
  assert.equal(outcome, "created");
  const state = await store.readState();
  assert.equal(state.status, "awaiting_approval");
  assert.equal(state.digest, envelope.digest);
});

test("re-staging an identical envelope is idempotent without journal noise", async () => {
  const stateDir = await freshStateDir();
  const envelope = finalized();
  await stageCampaignEnvelope({ stateDir, envelope });
  const { store, outcome } = await stageCampaignEnvelope({ stateDir, envelope });
  assert.equal(outcome, "unchanged");
  const events = await store.readEvents();
  assert.equal(events.some((event) => event.type === "envelope.replaced"), false);
});

test("re-staging an awaiting_approval campaign replaces the stored envelope and journals both digests", async () => {
  const stateDir = await freshStateDir();
  const stale = finalized();
  const fresh = finalized({ verification: ["pnpm check"] });
  assert.notEqual(stale.digest, fresh.digest);

  await stageCampaignEnvelope({ stateDir, envelope: stale });
  const { store, outcome } = await stageCampaignEnvelope({ stateDir, envelope: fresh });

  assert.equal(outcome, "replaced");
  assert.equal((await store.readEnvelope()).digest, fresh.digest);
  const state = await store.readState();
  assert.equal(state.status, "awaiting_approval");
  assert.equal(state.digest, fresh.digest);

  const replaced = (await store.readEvents()).find((event) => event.type === "envelope.replaced");
  assert.ok(replaced, "expected an envelope.replaced journal event");
  assert.equal(replaced.evidence["oldDigest"], stale.digest);
  assert.equal(replaced.evidence["newDigest"], fresh.digest);
});

test("re-staging a cancelled campaign without dispatched work restores an approvable envelope", async () => {
  const stateDir = await freshStateDir();
  const stale = finalized();
  const fresh = finalized({ verification: ["pnpm check"] });

  const first = await stageCampaignEnvelope({ stateDir, envelope: stale });
  await first.store.writeState({
    schemaVersion: 1,
    campaignId: stale.campaignId,
    status: "cancelled",
    digest: stale.digest,
    updatedAt: new Date().toISOString(),
  });

  const { store, outcome } = await stageCampaignEnvelope({ stateDir, envelope: fresh });
  assert.equal(outcome, "replaced");
  const state = await store.readState();
  assert.equal(state.status, "awaiting_approval");
  assert.equal(state.digest, fresh.digest);

  // The operator loop must reach an approvable envelope without state-dir surgery.
  await approve(store, fresh);
  assert.equal(await hasDurableApproval(store, fresh.digest), true);
});

test("a pre-run approval never authorizes the replacement envelope", async () => {
  const stateDir = await freshStateDir();
  const stale = finalized();
  const fresh = finalized({ verification: ["pnpm check"] });

  const first = await stageCampaignEnvelope({ stateDir, envelope: stale });
  await approve(first.store, stale);

  // Approved but nothing dispatched: replacement is allowed...
  const { store, outcome } = await stageCampaignEnvelope({ stateDir, envelope: fresh });
  assert.equal(outcome, "replaced");
  // ...and the old approval must not carry over to the new digest.
  assert.equal(await hasDurableApproval(store, fresh.digest), false);
  assert.equal((await store.readEnvelope()).digest, fresh.digest);
});

test("refuses to replace once approvals exist and jobs were dispatched, naming the stored digest", async () => {
  const stateDir = await freshStateDir();
  const stale = finalized();
  const fresh = finalized({ verification: ["pnpm check"] });

  const first = await stageCampaignEnvelope({ stateDir, envelope: stale });
  await approve(first.store, stale);
  await first.store.appendEvent({
    schemaVersion: 1,
    id: "dispatch:cmp-staging:QK-101:implementer:1",
    type: "runner.dispatched",
    at: new Date().toISOString(),
    actor: "supervisor",
    from: "awaiting_approval",
    to: "running",
    reason: "task_dispatched",
    evidence: { jobId: "cmp-staging:QK-101:implementer:1", taskId: "QK-101" },
  });
  await first.store.writeState({
    schemaVersion: 1,
    campaignId: stale.campaignId,
    status: "cancelled",
    digest: stale.digest,
    updatedAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => stageCampaignEnvelope({ stateDir, envelope: fresh }),
    (error: unknown) => {
      assert.ok(error instanceof QuirksError);
      assert.ok(error.message.includes(stale.digest), "refusal must name the stored digest");
      assert.ok(error.message.includes("--campaign"), "refusal must name the real preflight escape hatch");
      assert.equal(error.details["storedDigest"], stale.digest);
      return true;
    },
  );
  // The stored envelope must be untouched by the refused replacement.
  const store = first.store;
  assert.equal((await store.readEnvelope()).digest, stale.digest);
  assert.equal((await store.readEvents()).some((event) => event.type === "envelope.replaced"), false);
});

test("refuses to replace the envelope of a campaign that is neither awaiting approval nor cancelled", async () => {
  const stateDir = await freshStateDir();
  const stale = finalized();
  const fresh = finalized({ verification: ["pnpm check"] });

  const first = await stageCampaignEnvelope({ stateDir, envelope: stale });
  await first.store.writeState({
    schemaVersion: 1,
    campaignId: stale.campaignId,
    status: "running",
    digest: stale.digest,
    updatedAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => stageCampaignEnvelope({ stateDir, envelope: fresh }),
    (error: unknown) => {
      assert.ok(error instanceof QuirksError);
      assert.ok(error.message.includes(stale.digest), "refusal must name the stored digest");
      return true;
    },
  );
  assert.equal((await first.store.readEnvelope()).digest, stale.digest);
});

test("approve failures name the stored envelope digest so the operator never hunts", async () => {
  const stateDir = await freshStateDir();
  const envelope = finalized();
  const { store } = await stageCampaignEnvelope({ stateDir, envelope });

  const transientDigest = `sha256:${"b".repeat(64)}`;
  const challenge = createApprovalChallenge({ campaignId: envelope.campaignId, digest: transientDigest, ttlMs: 60_000 });
  await assert.rejects(
    () => consumeApprovalToken({
      store,
      token: challenge.token,
      campaignId: envelope.campaignId,
      digest: transientDigest,
      operator: { kind: "self-asserted", id: "x" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof QuirksError);
      assert.match(error.message, /DIGEST_MISMATCH/);
      assert.ok(error.message.includes(envelope.digest), "approve failure must name the stored digest");
      return true;
    },
  );
});
