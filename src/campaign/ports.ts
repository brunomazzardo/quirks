import type { ResolvedRoute } from "./routing.js";
import type { RunnerJobResult } from "../runner/types.js";

export interface WorktreePort {
  prepareTaskWorktree(taskId: string, baseCommit: string): Promise<{ path: string; branch: string }>;
  listModifiedFiles(path: string): Promise<readonly string[]>;
  readCommit(path: string): Promise<string | undefined>;
}

export interface RunnerPort {
  dispatch(input: {
    jobId: string;
    taskId: string;
    role: "supervisor" | "implementer" | "reviewer";
    route: ResolvedRoute;
    briefPath: string;
    worktreePath: string;
  }): Promise<RunnerJobResult>;
}
