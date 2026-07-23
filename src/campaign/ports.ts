import type { ResolvedRoute } from "./routing.js";
import type { RunnerJobResult } from "../runner/types.js";
import type { LandingInput, LandingResult } from "../git/landing.js";

export interface WorktreePort {
  prepareTaskWorktree(taskId: string, baseCommit: string): Promise<{ path: string; branch: string }>;
  listModifiedFiles(path: string): Promise<readonly string[]>;
  readCommit(path: string): Promise<string | undefined>;
}

export interface IntegrationBranchRecovery {
  /**
   * When true a mismatched integration branch is reset to the envelope base
   * (safe only while the campaign has no dispatched jobs); when false the
   * mismatch is a hard error carrying the exact remediation.
   */
  resetOnMismatch: boolean;
  onReset?: (details: { branch: string; fromCommit: string; toCommit: string }) => void | Promise<void>;
}

export interface EnsureIntegrationBranchInput {
  repositoryRoot: string;
  campaignId: string;
  baseCommit: string;
  campaignBranch: string;
  recovery?: IntegrationBranchRecovery;
}

export interface GitWorktreePort extends WorktreePort {
  ensureIntegrationBranch(input: EnsureIntegrationBranchInput): Promise<{ branch: string; commit: string }>;
  prepareReviewWorktree(taskId: string, candidateCommit: string): Promise<{ path: string; branch: string }>;
}

export interface LandingPort {
  mergeCampaignToTarget(input: LandingInput): Promise<LandingResult>;
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
