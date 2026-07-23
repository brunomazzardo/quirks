import { QuirksError } from "../core/errors.js";
import type { EnsureIntegrationBranchInput } from "../campaign/ports.js";
import type { GitWorktreeManager } from "./worktree.js";
import { runGit } from "./argv.js";

export async function ensureCampaignIntegrationBranch(
  manager: GitWorktreeManager,
  input: EnsureIntegrationBranchInput,
): Promise<{ branch: string; commit: string }> {
  return manager.ensureIntegrationBranch(input);
}

export async function validateIntegrationBranchAtCommit(repositoryRoot: string, branch: string, expectedCommit: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, ["rev-parse", branch]);
  if (stdout.trim() !== expectedCommit) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Integration branch at unexpected commit");
  }
}
