import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cleanupWorktrees } from "../../src/git/cleanup.js";
import { GitWorktreeManager } from "../../src/git/worktree.js";
import { createGitFixture } from "./support/git-fixture.js";

test("cleanup removes registered worktrees idempotently", async () => {
  const fixture = await createGitFixture();
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1/integration",
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });
  await manager.prepareTaskWorktree("QK-10", fixture.head);

  const first = await cleanupWorktrees(manager, "cmp-git-1", { force: true });
  assert.equal(first.removed.length > 0, true);

  const second = await cleanupWorktrees(manager, "cmp-git-1", { force: true });
  assert.deepEqual(second.removed, []);

  const store = JSON.parse(await readFile(manager.storeFilePath, "utf8"));
  assert.deepEqual(store.worktrees, []);
});
