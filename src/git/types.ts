export interface GitWorktreeRecord {
  schemaVersion: 1;
  campaignId: string;
  taskId: string;
  path: string;
  branch: string;
  baseCommit: string;
  createdAt: string;
  role?: "implementer" | "reviewer";
}

export interface GitWorktreeStore {
  schemaVersion: 1;
  campaignId: string;
  integrationBranch: string;
  integrationCommit: string;
  worktrees: GitWorktreeRecord[];
}

export interface ReviewLane {
  worktreePath: string;
  branch: string;
  candidateCommit: string;
}
