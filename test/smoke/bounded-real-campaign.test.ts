import assert from "node:assert/strict";
import test from "node:test";
import {
  createBoundedBareRemote,
  prepareBoundedFixtureRoot,
  runBoundedCampaign,
} from "../../src/smoke/bounded-campaign.js";
import { BOUNDED_CAMPAIGN_APPROVAL_ENV } from "../../src/smoke/types.js";

test("bounded campaign rejects unapproved execution", async () => {
  await assert.rejects(
    () => runBoundedCampaign({ approved: false }),
    /approve-exact-campaign/,
  );
});

test("bounded campaign cannot land before approval, review, and provenance acknowledgement", async () => {
  const fixtureRoot = await prepareBoundedFixtureRoot();
  const { bareRemote } = await createBoundedBareRemote(fixtureRoot, "quirks-smoke");
  const started = Date.now();
  const result = await runBoundedCampaign({
    fixtureRoot,
    bareRemote,
    branch: "quirks-smoke",
    approved: true,
    useFakeRunners: true,
  });
  const elapsedMs = Date.now() - started;
  assert.equal(result.changedFiles.join("\n"), "src/message.txt");
  assert.equal(result.review.outcome, "approved");
  assert.equal(result.taskStatus, "completed");
  assert.equal(result.remoteHead, result.acceptedCommit);
  assert.equal(result.pendingSyncIntents, 0);
  assert.match(result.approvalMethod, /consumeApprovalToken/);
  process.stdout.write(`bounded-real-campaign.test: ok in ${(elapsedMs / 1000).toFixed(2)}s\n`);
});

test("bounded campaign gate requires approval env", async () => {
  const previous = process.env.QUIRKS_SMOKE_APPROVED;
  delete process.env.QUIRKS_SMOKE_APPROVED;
  try {
    await assert.rejects(
      () => runBoundedCampaign(),
      /approve-exact-campaign/,
    );
  } finally {
    if (previous === undefined) delete process.env.QUIRKS_SMOKE_APPROVED;
    else process.env.QUIRKS_SMOKE_APPROVED = previous;
  }
  assert.equal(BOUNDED_CAMPAIGN_APPROVAL_ENV, "approve-exact-campaign");
});
