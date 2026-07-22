import assert from "node:assert/strict";
import test from "node:test";
import { QuirksError } from "../../src/core/errors.js";
import { mergeCampaignToTarget } from "../../src/git/landing.js";
import { createLandingFixture } from "./support/landing-fixture.js";

test("merges campaign branch into target at expected commit", async () => {
  const fixture = await createLandingFixture();
  const result = await mergeCampaignToTarget({
    repositoryRoot: fixture.root,
    git: {
      campaignBranch: fixture.campaignBranch,
      targetBranch: fixture.targetBranch,
      expectedTargetCommit: fixture.targetCommit,
      push: { enabled: false },
    },
  });

  assert.match(result.mergeCommit, /^[a-f0-9]{40}$/);
  assert.equal(result.pushed, false);
});

test("rejects target drift before merge", async () => {
  const fixture = await createLandingFixture();
  await assert.rejects(
    () => mergeCampaignToTarget({
      repositoryRoot: fixture.root,
      git: {
        campaignBranch: fixture.campaignBranch,
        targetBranch: fixture.targetBranch,
        expectedTargetCommit: "0".repeat(40),
        push: { enabled: false },
      },
    }),
    (error: unknown) => error instanceof QuirksError && error.code === "PROTOCOL_VIOLATION",
  );
});

test("rejects dirty target working tree", async () => {
  const fixture = await createLandingFixture();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`${fixture.root}/dirty.txt`, "dirty\n", "utf8");
  await assert.rejects(
    () => mergeCampaignToTarget({
      repositoryRoot: fixture.root,
      git: {
        campaignBranch: fixture.campaignBranch,
        targetBranch: fixture.targetBranch,
        expectedTargetCommit: fixture.targetCommit,
        push: { enabled: false },
      },
    }),
    /uncommitted changes/i,
  );
});

test("runs pre-push verification before optional push", async () => {
  const fixture = await createLandingFixture();
  let verified = false;
  const result = await mergeCampaignToTarget({
    repositoryRoot: fixture.root,
    git: {
      campaignBranch: fixture.campaignBranch,
      targetBranch: fixture.targetBranch,
      expectedTargetCommit: fixture.targetCommit,
      push: {
        enabled: true,
        remote: "origin",
        branch: fixture.remoteBranch,
      },
    },
    approvedPush: { remote: "origin", branch: fixture.remoteBranch },
    prePushVerification: async () => {
      verified = true;
    },
  });
  assert.equal(verified, true);
  assert.equal(result.pushed, true);
});
