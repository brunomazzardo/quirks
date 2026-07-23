import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { QuirksError } from "../../src/core/errors.js";
import { ensureCampaignIntegrationBranch, validateIntegrationBranchAtCommit } from "../../src/git/integration-branch.js";
import { GitWorktreeManager } from "../../src/git/worktree.js";
import { createGitFixture } from "./support/git-fixture.js";

const execFileAsync = promisify(execFile);

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

test("resets a mismatched integration branch to the envelope base when recovery allows it", async () => {
  const fixture = await createGitFixture();
  const branch = "quirks/cmp-git-2/integration";
  await execFileAsync("git", ["-C", fixture.root, "branch", branch, fixture.commitWithChange]);
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-2",
    campaignBranch: branch,
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });

  const resets: Array<{ branch: string; fromCommit: string; toCommit: string }> = [];
  const result = await manager.ensureIntegrationBranch({
    repositoryRoot: fixture.root,
    campaignId: "cmp-git-2",
    baseCommit: fixture.head,
    campaignBranch: branch,
    recovery: {
      resetOnMismatch: true,
      onReset: (details) => {
        resets.push(details);
      },
    },
  });

  assert.deepEqual(result, { branch, commit: fixture.head });
  assert.deepEqual(resets, [{ branch, fromCommit: fixture.commitWithChange, toCommit: fixture.head }]);
  await validateIntegrationBranchAtCommit(fixture.root, branch, fixture.head);
});

test("reports branch, commits, and remediation when a mismatched integration branch cannot be reset", async () => {
  const fixture = await createGitFixture();
  const branch = "quirks/cmp-git-3/integration";
  await execFileAsync("git", ["-C", fixture.root, "branch", branch, fixture.commitWithChange]);
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-3",
    campaignBranch: branch,
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });

  await assert.rejects(
    () => manager.ensureIntegrationBranch({
      repositoryRoot: fixture.root,
      campaignId: "cmp-git-3",
      baseCommit: fixture.head,
      campaignBranch: branch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof QuirksError);
      assert.match(error.message, /INTEGRATION_BRANCH_MISMATCH/);
      assert.ok(error.message.includes(branch), "message must name the branch");
      assert.ok(error.message.includes(fixture.commitWithChange), "message must include the actual commit");
      assert.ok(error.message.includes(fixture.head), "message must include the expected commit");
      assert.ok(
        error.message.includes(`git branch -f ${branch} ${fixture.head}`),
        "message must include the exact remediation",
      );
      assert.equal(error.details["branch"], branch);
      assert.equal(error.details["actualCommit"], fixture.commitWithChange);
      assert.equal(error.details["expectedCommit"], fixture.head);
      return true;
    },
  );
  // The mismatched branch is evidence; a refused reset must not move it.
  await validateIntegrationBranchAtCommit(fixture.root, branch, fixture.commitWithChange);
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
