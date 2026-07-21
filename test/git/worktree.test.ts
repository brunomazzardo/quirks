import assert from "node:assert/strict";
import test from "node:test";
import { GitWorktreeManager } from "../../src/git/worktree.js";
import { createGitFixture } from "./support/git-fixture.js";

test("creates one isolated worktree per task under app state", async () => {
  const fixture = await createGitFixture();
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1/integration",
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });
  const a = await manager.prepareTaskWorktree("QK-1", fixture.head);
  const b = await manager.prepareTaskWorktree("QK-2", fixture.head);
  assert.notEqual(a.path, b.path);
  assert.match(a.branch, /^quirks\/cmp-git-1\/task\/QK-1$/);
  assert.equal(a.path.startsWith(fixture.root), false);
});

test("rejects wrong base commit for task worktrees", async () => {
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
    () => manager.prepareTaskWorktree("QK-3", fixture.commitWithChange),
    /base commit mismatch/i,
  );
});

test("lists modified files from worktree porcelain status", async () => {
  const fixture = await createGitFixture();
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1/integration",
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });
  const worktree = await manager.prepareTaskWorktree("QK-4", fixture.head);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`${worktree.path}/tracked-edit.txt`, "edit\n", "utf8");
  const modified = await manager.listModifiedFiles(worktree.path);
  assert.equal(modified.includes("tracked-edit.txt"), true);
});

test("reads commit from worktree head", async () => {
  const fixture = await createGitFixture();
  const manager = await GitWorktreeManager.open({
    repositoryRoot: fixture.root,
    repositoryId: fixture.repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1/integration",
    baseCommit: fixture.head,
    stateDir: fixture.stateDir,
  });
  const worktree = await manager.prepareTaskWorktree("QK-5", fixture.head);
  const commit = await manager.readCommit(worktree.path);
  assert.equal(commit, fixture.head);
});
