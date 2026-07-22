import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { QuirksError } from "../../src/core/errors.js";
import { mergeCampaignToTarget } from "../../src/git/landing.js";
import { createLandingFixture } from "./support/landing-fixture.js";

const execFileAsync = promisify(execFile);

async function remoteHead(bareRemote: string, branch: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--git-dir", bareRemote, "rev-parse", branch]);
  return stdout.toString().trim();
}

test("push authorization rejects wrong remote", async () => {
  const fixture = await createLandingFixture();
  await assert.rejects(
    () => mergeCampaignToTarget({
      repositoryRoot: fixture.root,
      git: {
        campaignBranch: fixture.campaignBranch,
        targetBranch: fixture.targetBranch,
        expectedTargetCommit: fixture.targetCommit,
        push: { enabled: true, remote: "origin", branch: fixture.remoteBranch },
      },
      approvedPush: { remote: "upstream", branch: fixture.remoteBranch },
    }),
    (error: unknown) => error instanceof QuirksError && /remote or branch/i.test(error.message),
  );
});

test("push authorization rejects wrong branch", async () => {
  const fixture = await createLandingFixture();
  await assert.rejects(
    () => mergeCampaignToTarget({
      repositoryRoot: fixture.root,
      git: {
        campaignBranch: fixture.campaignBranch,
        targetBranch: fixture.targetBranch,
        expectedTargetCommit: fixture.targetCommit,
        push: { enabled: true, remote: "origin", branch: fixture.remoteBranch },
      },
      approvedPush: { remote: "origin", branch: "release" },
    }),
    (error: unknown) => error instanceof QuirksError && /remote or branch/i.test(error.message),
  );
});

test("push authorization rejects enabled push without approved envelope fields", async () => {
  const fixture = await createLandingFixture();
  await assert.rejects(
    () => mergeCampaignToTarget({
      repositoryRoot: fixture.root,
      git: {
        campaignBranch: fixture.campaignBranch,
        targetBranch: fixture.targetBranch,
        expectedTargetCommit: fixture.targetCommit,
        push: { enabled: true },
      },
      approvedPush: { remote: "origin", branch: fixture.remoteBranch },
    }),
    (error: unknown) => error instanceof QuirksError && /remote and branch/i.test(error.message),
  );
});

test("approved push updates only the exact bare remote branch", async () => {
  const fixture = await createLandingFixture();
  const before = await remoteHead(fixture.bareRemote, fixture.remoteBranch);
  const result = await mergeCampaignToTarget({
    repositoryRoot: fixture.root,
    git: {
      campaignBranch: fixture.campaignBranch,
      targetBranch: fixture.targetBranch,
      expectedTargetCommit: fixture.targetCommit,
      push: { enabled: true, remote: "origin", branch: fixture.remoteBranch },
    },
    approvedPush: { remote: "origin", branch: fixture.remoteBranch },
  });
  const after = await remoteHead(fixture.bareRemote, fixture.remoteBranch);
  assert.notEqual(before, after);
  assert.equal(after, result.mergeCommit);
  assert.equal(result.pushRef, `origin/${fixture.remoteBranch}`);
});
