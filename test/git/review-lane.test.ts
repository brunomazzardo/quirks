import assert from "node:assert/strict";
import test from "node:test";
import { openReviewLane } from "../../src/git/review-lane.js";
import { createGitFixture } from "./support/git-fixture.js";

test("review lane uses a fresh worktree and branch", async () => {
  const fixture = await createGitFixture();
  const lane = await openReviewLane({
    manager: fixture.manager,
    taskId: "QK-9",
    candidateCommit: fixture.commitWithChange,
    baseCommit: fixture.head,
  });
  assert.notEqual(lane.worktreePath, fixture.implementerWorktreePath);
  assert.match(lane.branch, /\/review\//);
});
