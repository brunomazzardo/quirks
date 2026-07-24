import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  createBoundedBareRemote,
  prepareBoundedFixtureRoot,
  runBoundedCampaign,
} from "../../src/smoke/bounded-campaign.js";

const execFileAsync = promisify(execFile);
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

/**
 * The bounded campaign has its own acceptance path, separate from the
 * supervisor's. It gated on reviewer transport status alone, so a reviewer that
 * ran and asked for changes still landed and pushed — a review bypass on the
 * one path that touches a real remote. Raised by the independent codex review
 * of b72362a (QK-RUN-008).
 */
test("bounded campaign refuses to land when the reviewer withholds approval", async () => {
  const fixtureRoot = await prepareBoundedFixtureRoot();
  const { bareRemote } = await createBoundedBareRemote(fixtureRoot, "quirks-smoke");
  process.env.QUIRKS_BOUNDED_REVIEWER_VERDICT = "revise";
  try {
    await assert.rejects(
      () => runBoundedCampaign({
        fixtureRoot,
        bareRemote,
        branch: "quirks-smoke",
        approved: true,
        useFakeRunners: true,
      }),
      /review|approval|verdict/i,
      "a revise verdict must stop the campaign before it lands",
    );
  } finally {
    delete process.env.QUIRKS_BOUNDED_REVIEWER_VERDICT;
  }
});

test("bounded campaign wires supplied bare remote without pre-setup", async () => {
  const fixtureRoot = await prepareBoundedFixtureRoot();
  const bareRemote = await mkdtemp(path.join(os.tmpdir(), "quirks-bounded-remote-"));
  await execFileAsync("git", ["init", "--bare", bareRemote]);
  const result = await runBoundedCampaign({
    fixtureRoot,
    bareRemote,
    branch: "quirks-smoke",
    approved: true,
    useFakeRunners: true,
  });
  assert.equal(result.changedFiles.join("\n"), "src/message.txt");
  assert.equal(result.remoteHead, result.acceptedCommit);
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
