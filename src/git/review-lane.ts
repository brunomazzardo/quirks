import type { GitWorktreeManager } from "./worktree.js";
import type { ReviewLane } from "./types.js";

export async function openReviewLane(input: {
  manager: GitWorktreeManager;
  taskId: string;
  candidateCommit: string;
  baseCommit: string;
}): Promise<ReviewLane> {
  const lane = await input.manager.prepareReviewWorktree(input.taskId, input.candidateCommit);
  return {
    worktreePath: lane.path,
    branch: lane.branch,
    candidateCommit: input.candidateCommit,
  };
}
