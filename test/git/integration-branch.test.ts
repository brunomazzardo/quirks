import assert from "node:assert/strict";
import test from "node:test";
import { ensureCampaignIntegrationBranch, validateIntegrationBranchAtCommit } from "../../src/git/integration-branch.js";
import { GitWorktreeManager } from "../../src/git/worktree.js";
import { createGitFixture } from "./support/git-fixture.js";

test("creates integration branch at base commit", async () => {
  const fixture = await createGitFixture();
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1/integration",
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });
  const result = await ensureCampaignIntegrationBranch(manager, {
    repositoryRoot: fixture.root,
    campaignId: "cmp-git-1",
    baseCommit: fixture.head,
    campaignBranch: "quirks/cmp-git-1/integration",
  });
  assert.equal(result.branch, "quirks/cmp-git-1/integration");
  assert.equal(result.commit, fixture.head);
  await validateIntegrationBranchAtCommit(fixture.root, "quirks/cmp-git-1/integration", fixture.head);
});

test("rejects integration branch base mismatch", async () => {
  const fixture = await createGitFixture();
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1/integration",
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });
  await assert.rejects(
    () => manager.ensureIntegrationBranch({
      repositoryRoot: fixture.root,
      campaignId: "cmp-git-1",
      baseCommit: fixture.commitWithChange,
      campaignBranch: "quirks/cmp-git-1/integration",
    }),
    /base commit mismatch/i,
  );
});

test("recovers existing integration branch idempotently", async () => {
  const fixture = await createGitFixture();
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1/integration",
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });
  const first = await ensureCampaignIntegrationBranch(manager, {
    repositoryRoot: fixture.root,
    campaignId: "cmp-git-1",
    baseCommit: fixture.head,
    campaignBranch: "quirks/cmp-git-1/integration",
  });
  const second = await ensureCampaignIntegrationBranch(manager, {
    repositoryRoot: fixture.root,
    campaignId: "cmp-git-1",
    baseCommit: fixture.head,
    campaignBranch: "quirks/cmp-git-1/integration",
  });
  assert.deepEqual(second, first);
});
