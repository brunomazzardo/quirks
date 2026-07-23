import path from "node:path";
import type { IntegrationBranchRecovery, RunnerPort, WorktreePort } from "./ports.js";
import type { CampaignEnvelope } from "./types.js";
import { QuirksError } from "../core/errors.js";
import { GitWorktreeManager } from "../git/worktree.js";
import { CliRunnerPort } from "../runner/cli-runner-port.js";
import { loadRunnerProfiles } from "../runner/profiles.js";
import type { RunnerProfile } from "../runner/types.js";
import { resolveAppPaths } from "../state/app-paths.js";

export interface CampaignRuntime {
  runner: RunnerPort;
  worktree: WorktreePort;
  profiles: ReadonlyMap<string, RunnerProfile>;
}

export type CreateCampaignRuntimeOptions =
  | {
      mode: "real";
      configDir?: string;
      stateDir?: string;
      /**
       * How to treat an integration branch left at the wrong commit by a
       * failed start. Callers that know whether the campaign has dispatched
       * jobs pass it here; without it a mismatch stays a hard error.
       */
      integrationRecovery?: IntegrationBranchRecovery;
    }
  | {
      mode: "fake";
      runner: RunnerPort;
      worktree: WorktreePort;
    };

function stateDirFor(repositoryId: string, override?: string): string {
  return override ?? process.env.QUIRKS_STATE_DIR ?? resolveAppPaths(repositoryId).root;
}

export async function createCampaignRuntime(
  envelope: CampaignEnvelope,
  repositoryRoot: string,
  options: CreateCampaignRuntimeOptions,
): Promise<CampaignRuntime> {
  if (options.mode === "fake") {
    return {
      runner: options.runner,
      worktree: options.worktree,
      profiles: new Map(),
    };
  }

  const profiles = await loadRunnerProfiles(options.configDir ? { configDir: options.configDir } : {});
  const profileMap = new Map(profiles.map((profile) => [profile.profileId, profile]));
  const runner = new CliRunnerPort(profileMap);
  const stateDir = stateDirFor(envelope.repositoryId, options.stateDir);
  const worktree = await GitWorktreeManager.open({
    repositoryRoot,
    repositoryId: envelope.repositoryId,
    campaignId: envelope.campaignId,
    campaignBranch: envelope.git.campaignBranch,
    baseCommit: envelope.git.baseCommit,
    stateDir,
  });

  await worktree.ensureIntegrationBranch({
    repositoryRoot,
    campaignId: envelope.campaignId,
    baseCommit: envelope.git.baseCommit,
    campaignBranch: envelope.git.campaignBranch,
    ...(options.integrationRecovery ? { recovery: options.integrationRecovery } : {}),
  });

  if (!envelope.git.targetBranch) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Campaign envelope is missing a target branch");
  }

  return { runner, worktree, profiles: profileMap };
}

export function lockPathFor(repositoryId: string): string {
  return path.join(resolveAppPaths(repositoryId).repository, "repository.lock");
}
