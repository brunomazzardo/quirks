import { QuirksError } from "../core/errors.js";
import type { GitWorktreeManager } from "./worktree.js";
import { runGit } from "./argv.js";

export async function ensureCampaignIntegrationBranch(manager: GitWorktreeManager, input: {
  repositoryRoot: string;
  campaignId: string;
  baseCommit: string;
  campaignBranch: string;
}): Promise<{ branch: string; commit: string }> {
  return manager.ensureIntegrationBranch(input);
}

export async function validateIntegrationBranchAtCommit(repositoryRoot: string, branch: string, expectedCommit: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, ["rev-parse", branch]);
  if (stdout.trim() !== expectedCommit) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Integration branch at unexpected commit");
  }
}
